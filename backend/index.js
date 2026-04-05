const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

dotenv.config();

const app = express();

// CORS：开发允许 localhost，生产通过环境变量 ALLOWED_ORIGINS 配置
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:4173'];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));

// ── 工具：校验 Project ID（防路径穿透）────────────────────────
function validateId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
}

const API_KEY = process.env.LAOZHANG_API_KEY;
const API_BASE = 'https://api.laozhang.ai';
const JWT_SECRET    = process.env.JWT_SECRET    || 'changeme-secret';
const ADMIN_SECRET  = process.env.ADMIN_SECRET  || 'changeme-admin';

// ── 用户存储 ──────────────────────────────────────────────────
const USERS_FILE = path.join(__dirname, 'users.json');
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ── JWT 鉴权中间件 ─────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId   = payload.userId;
    req.username = payload.username;
    next();
  } catch {
    res.status(401).json({ error: 'Token 已过期，请重新登录' });
  }
}

// ── 登录接口 ──────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  const users = loadUsers();
  const user  = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: '用户名或密码错误' });
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username: user.username });
});

// ── 管理员创建用户 ─────────────────────────────────────────────
app.post('/api/admin/create-user', async (req, res) => {
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return res.status(403).json({ error: '无权限' });
  }
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  const users = loadUsers();
  if (users.find(u => u.username === username)) return res.status(409).json({ error: '用户名已存在' });
  const passwordHash = await bcrypt.hash(password, 10);
  const id = `user_${Date.now()}`;
  users.push({ id, username, passwordHash, createdAt: new Date().toISOString() });
  saveUsers(users);
  // 为该用户创建项目目录
  const dir = path.join(__dirname, 'projects', id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  res.json({ ok: true, id, username });
});

// ── 图片库存储 ─────────────────────────────────────────────────
const GENERATED_DIR = path.join(__dirname, 'generated');
const METADATA_FILE = path.join(GENERATED_DIR, 'metadata.json');
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

function loadMeta() {
  try { return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8')); } catch { return []; }
}
function saveMeta(data) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2));
}
function persistImage(base64, mimeType, prompt, model, refCount) {
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const filename = `${id}.${ext}`;
  fs.writeFileSync(path.join(GENERATED_DIR, filename), Buffer.from(base64, 'base64'));
  const meta = loadMeta();
  meta.unshift({ id, filename, mimeType, prompt, model, refCount, createdAt: Date.now() });
  if (meta.length > 500) meta.splice(500);
  saveMeta(meta);
  return id;
}

// 静态文件服务
app.use('/generated', express.static(GENERATED_DIR));

// ── 中文检测 + 自动翻译（Sora 只接受英文）──────────────────────
async function ensureEnglish(text) {
  if (!/[\u4e00-\u9fff\u3040-\u30ff]/.test(text)) return text; // 无中日文直接返回
  try {
    const res = await axios.post(
      `${API_BASE}/v1/chat/completions`,
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: `Translate this AI video/image prompt to English. Output only the translated text:\n\n${text}` }],
        max_tokens: 300,
      },
      { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    const translated = res.data?.choices?.[0]?.message?.content?.trim();
    if (translated) {
      console.log(`[翻译] "${text.slice(0,40)}" → "${translated.slice(0,60)}"`);
      return translated;
    }
  } catch (e) {
    console.warn('[翻译] 翻译失败，使用原始 prompt:', e.message);
  }
  return text;
}

// ── NanoBanana 生图（支持纯文字 + 多张参考图） ───────────────────
// 走 /v1/chat/completions，响应是 markdown 包裹的 base64
// 宽高比 → 像素尺寸映射
const RATIO_TO_SIZE = {
  '1:1':  { w: 1024, h: 1024 },
  '16:9': { w: 1280, h: 720  },
  '9:16': { w: 720,  h: 1280 },
  '4:3':  { w: 1024, h: 768  },
  '3:4':  { w: 768,  h: 1024 },
  '3:2':  { w: 1200, h: 800  },
  '2:3':  { w: 800,  h: 1200 },
};

async function generateNanoBanana(prompt, model, aspectRatio, imageSize, referenceImages) {
  const content = [];

  // 在 prompt 末尾追加比例提示作为兜底
  const dim = RATIO_TO_SIZE[aspectRatio] || RATIO_TO_SIZE['1:1'];
  const scale = imageSize === '2K' ? 2 : 1;
  const w = dim.w * scale;
  const h = dim.h * scale;
  const promptWithRatio = `${prompt} [aspect ratio: ${aspectRatio}]`;

  content.push({ type: 'text', text: promptWithRatio });

  // 追加所有参考图（image_url data URL 格式）
  for (const img of (referenceImages || [])) {
    if (img?.base64) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType || 'image/jpeg'};base64,${img.base64}` },
      });
    }
  }

  const payload = {
    model,
    messages: [{ role: 'user', content }],
    size: `${w}x${h}`,   // 部分端点支持此参数
  };

  const response = await axios.post(`${API_BASE}/v1/chat/completions`, payload, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });

  const text = response.data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('响应格式异常，未找到内容');

  // 提取 markdown 中的 base64 图片：![...](data:image/xxx;base64,...)
  const match = text.match(/!\[.*?\]\(data:(image\/\w+);base64,([^)]+)\)/);
  if (!match) throw new Error('响应中没有图片数据: ' + text.slice(0, 200));

  return { mimeType: match[1], base64: match[2] };
}

// ── Midjourney 生图 ──────────────────────────────────────────
const MJ_AR_MAP = {
  '1:1': '1:1', '16:9': '16:9', '9:16': '9:16',
  '4:3': '4:3', '3:4': '3:4',  '3:2': '3:2',
};

async function generateMidjourney(prompt, aspectRatio) {
  const ar = MJ_AR_MAP[aspectRatio] || '1:1';
  const fullPrompt = `${prompt} --ar ${ar}`;

  // 1. 提交任务
  const submitRes = await axios.post(
    `${API_BASE}/mj/submit/imagine`,
    { prompt: fullPrompt, base64Array: [], mode: 'relax' },
    { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
  );
  const taskId = submitRes.data?.result;
  if (!taskId) throw new Error('MJ 提交失败: ' + JSON.stringify(submitRes.data));
  console.log(`[MJ] 任务已提交 taskId=${taskId}`);

  // 2. 轮询直到完成（最多等 5 分钟）
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const fetchRes = await axios.get(
      `${API_BASE}/mj/task/${taskId}/fetch`,
      { headers: { Authorization: `Bearer ${API_KEY}` }, timeout: 15000 }
    );
    const { status, imageUrl, failReason } = fetchRes.data || {};
    console.log(`[MJ] 轮询 status=${status}`);
    if (status === 'FAILURE') throw new Error('MJ 生成失败: ' + failReason);
    if (status === 'SUCCESS' && imageUrl) {
      // 下载图片转 base64
      const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const mimeType = imgRes.headers['content-type']?.split(';')[0] || 'image/png';
      const base64 = Buffer.from(imgRes.data).toString('base64');
      return { mimeType, base64 };
    }
  }
  throw new Error('MJ 生成超时（5分钟）');
}

// ── 影像分析：JSON → 自然语言提示词 ────────────────────────────
function buildPromptFromAnalysis(a) {
  const parts = []
  if (a.characters?.length) {
    parts.push(a.characters.map(c => c.description).filter(Boolean).join('，'))
  }
  if (a.setting?.location) parts.push(a.setting.location)
  if (a.setting?.era) parts.push(`${a.setting.era}风格`)
  if (a.lighting?.direction && a.lighting?.tone) {
    parts.push(`${a.lighting.direction}${a.lighting.tone}光线`)
  } else if (a.lighting?.tone) {
    parts.push(`${a.lighting.tone}光线`)
  }
  if (a.composition?.shot_type) parts.push(a.composition.shot_type)
  if (a.style?.aesthetic) parts.push(a.style.aesthetic)
  if (a.style?.color_palette) parts.push(`${a.style.color_palette}色调`)
  if (a.style?.film_grain) parts.push('胶片质感')
  return parts.filter(Boolean).join('，')
}

// ── 图片反向拆解接口 ──────────────────────────────────────────
app.post('/api/analyze-image', authMiddleware, async (req, res) => {
  try {
    const { base64, mimeType = 'image/jpeg' } = req.body
    if (!base64) return res.status(400).json({ error: '缺少图片数据' })

    const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY
    if (!DASHSCOPE_KEY) return res.status(500).json({ error: '未配置 DASHSCOPE_API_KEY' })

    console.log('[分析图片] 调用 qwen3-vl-flash...')

    const response = await axios.post(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        model: 'qwen3-vl-flash',
        messages: [
          {
            role: 'system',
            content: '你是专业的影像提示词分析师。分析图片，严格只返回以下JSON格式，不要包含任何其他文字或markdown代码块：\n{"characters":[{"description":"人物描述","position":"画面位置"}],"setting":{"location":"地点","era":"时代","time_of_day":"时间"},"lighting":{"type":"光源类型","direction":"方向","tone":"色调"},"composition":{"shot_type":"景别","angle":"拍摄角度"},"style":{"aesthetic":"风格描述","color_palette":"主色调","film_grain":false}}\n无法判断的字段填null。'
          },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
              { type: 'text', text: '请分析这张图片的影像要素，返回JSON。' }
            ]
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${DASHSCOPE_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    )

    const rawText = response.data.choices[0].message.content
    console.log('[分析图片] 原始响应:', rawText.slice(0, 200))

    // 提取 JSON（模型有时会包在 ```json ... ``` 中）
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('模型未返回有效JSON')

    const analysis = JSON.parse(jsonMatch[0])
    const reconstructedPrompt = buildPromptFromAnalysis(analysis)

    console.log('[分析图片] 成功，重组提示词:', reconstructedPrompt.slice(0, 100))
    res.json({ analysis, reconstructedPrompt })
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message || '分析失败'
    console.error('[分析图片] 错误:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── 生图接口 ────────────────────────────────────────────────
app.post('/api/generate-image', async (req, res) => {
  try {
    const {
      prompt,
      model = 'gemini-3-pro-image-preview',
      aspectRatio = '1:1',
      imageSize = '1K',
      referenceImages = [],   // [{ base64, mimeType }, ...]
      referenceImage = null,  // 兼容旧单图格式
    } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt 不能为空' });
    }

    console.log(`[生图] model=${model} ratio=${aspectRatio} size=${imageSize}`);
    console.log(`[生图] prompt="${prompt.slice(0, 80)}"`);

    let result;
    if (model === 'midjourney') {
      result = await generateMidjourney(prompt.trim(), aspectRatio);
    } else {
      // 合并：新多图 + 旧单图兼容
      const allRefs = referenceImages.length > 0
        ? referenceImages
        : (referenceImage?.base64 ? [referenceImage] : []);
      console.log(`[生图] 参考图=${allRefs.length}张`);
      result = await generateNanoBanana(prompt.trim(), model, aspectRatio, imageSize, allRefs);
    }

    console.log(`[生图] 成功，mime=${result.mimeType}`);
    const savedId = persistImage(result.base64, result.mimeType, prompt.trim(), model, 0);
    res.json({ base64: result.base64, mimeType: result.mimeType, savedId });

  } catch (error) {
    const errMsg =
      error.response?.data?.error?.message ||
      JSON.stringify(error.response?.data?.error) ||
      error.message;
    console.error(`[生图] 失败: ${errMsg}`);
    res.status(500).json({ error: errMsg });
  }
});

// Sora 模型变体 → size / seconds 映射
// sora_video2-xxx 是前端显示用的选项 ID，实际 API 统一用 sora-2
const SORA_CONFIG = {
  'sora_video2':               { size: '704x1280',  seconds: '10' },
  'sora_video2-landscape':     { size: '1280x704',  seconds: '10' },
  'sora_video2-15s':           { size: '704x1280',  seconds: '15' },
  'sora_video2-landscape-15s': { size: '1280x704',  seconds: '15' },
};

// ── 视频生成接口 ─────────────────────────────────────────────
app.post('/api/generate-video', async (req, res) => {
  try {
    const { prompt, model = 'sora_video2' } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt 不能为空' });
    }

    console.log(`[生视频] model=${model} prompt="${prompt.slice(0, 60)}"`);

    {
      // ── Sora 2 ───────────────────────────────────────────
      // Sora 只支持英文，自动翻译中文 prompt
      const englishPrompt = await ensureEnglish(prompt.trim());
      const cfg = SORA_CONFIG[model] || { size: '1280x704', seconds: '10' };

      // 最多重试 3 次（老张服务端偶发 "Unable to process request"）
      let lastErr;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await axios.post(
            `${API_BASE}/v1/videos`,
            { model: 'sora-2', prompt: englishPrompt, size: cfg.size, seconds: cfg.seconds },
            { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
          );
          const data = response.data;
          if (!data?.id) throw new Error('未获取到任务ID：' + JSON.stringify(data));
          console.log(`[生视频] Sora 任务已提交(第${attempt}次): ${data.id} (${cfg.size}, ${cfg.seconds}s)`);
          return res.json({ taskId: data.id, type: 'sora' });
        } catch (e) {
          lastErr = e;
          const msg = e.response?.data?.error?.message || e.message || '';
          console.warn(`[生视频] Sora 第${attempt}次提交失败: ${msg}`);
          if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      }
      throw lastErr;
    }

  } catch (error) {
    const errMsg =
      error.response?.data?.error?.message ||
      JSON.stringify(error.response?.data) ||
      error.message;
    console.error(`[生视频] 提交失败: ${errMsg}`);
    res.status(500).json({ error: errMsg });
  }
});

// ── 视频状态查询 ─────────────────────────────────────────────
// GET /api/video-status?type=sora&taskId=video_xxx
// GET /api/video-status?type=veo&taskId=veo3:xxx
app.get('/api/video-status', async (req, res) => {
  try {
    const { type, taskId } = req.query;

    if (!type || !taskId) {
      return res.status(400).json({ error: 'type 和 taskId 不能为空' });
    }

    if (false) {
      // Veo 占位
    } else {
      // ── Sora 状态 ────────────────────────────────────────
      const response = await axios.get(
        `${API_BASE}/v1/videos/${taskId}`,
        {
          headers: { Authorization: `Bearer ${API_KEY}` },
          timeout: 15000,
        }
      );

      const data = response.data;
      // status: 'submitted' | 'in_progress' | 'completed' | 'failed'
      // 优先用直链（video_url / result_url / url），无需代理
      const videoUrl = data.status === 'completed'
        ? (data.video_url || data.result_url || data.url || `/api/video-proxy/${taskId}`)
        : null;

      res.json({
        status: data.status,
        videoUrl,
        progress: data.progress ?? null,
      });
    }

  } catch (error) {
    const errMsg =
      error.response?.data?.error?.message ||
      error.message;
    console.error(`[视频状态] 查询失败: ${errMsg}`);
    res.status(500).json({ error: errMsg });
  }
});

// ── Sora 视频代理（浏览器无法直接带 API Key 访问）───────────────
app.get('/api/video-proxy/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    console.log(`[视频代理] 下载 taskId=${taskId}`);

    const response = await axios.get(
      `${API_BASE}/v1/videos/${taskId}/content`,
      {
        headers: { Authorization: `Bearer ${API_KEY}` },
        responseType: 'stream',
        timeout: 120000,
      }
    );

    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="sora-${taskId}.mp4"`);
    // 支持视频范围请求（让 <video> 标签能正常播放）
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    response.data.pipe(res);

  } catch (error) {
    console.error(`[视频代理] 失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ── 模型列表 ─────────────────────────────────────────────────
app.get('/api/models', (req, res) => {
  res.json({
    image: [
      { id: 'gemini-3-pro-image-preview',     name: 'NanoBanana Pro', desc: '最高质量' },
      { id: 'gemini-3.1-flash-image-preview', name: 'NanoBanana 2',   desc: '速度快'   },
      { id: 'gemini-2.5-flash-image',         name: 'NanoBanana',     desc: '均衡'     },
    ],
    video: [
      { id: 'sora_video2',               name: 'Sora 2 竖屏',    desc: '10s', group: 'Sora 2' },
      { id: 'sora_video2-landscape',     name: 'Sora 2 横屏',    desc: '10s', group: 'Sora 2' },
      { id: 'sora_video2-15s',           name: 'Sora 2 竖屏 长', desc: '15s', group: 'Sora 2' },
      { id: 'sora_video2-landscape-15s', name: 'Sora 2 横屏 长', desc: '15s', group: 'Sora 2' },
    ],
  });
});

// ── 图片库接口 ────────────────────────────────────────────────
app.get('/api/gallery', (req, res) => {
  const meta = loadMeta();
  res.json(meta.map(m => ({
    id: m.id,
    url: `/generated/${m.filename}`,
    prompt: m.prompt,
    model: m.model,
    refCount: m.refCount || 0,
    createdAt: m.createdAt,
  })));
});

app.delete('/api/gallery/:id', (req, res) => {
  try {
    let meta = loadMeta();
    const item = meta.find(m => m.id === req.params.id);
    if (item) {
      const fp = path.join(GENERATED_DIR, item.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      meta = meta.filter(m => m.id !== req.params.id);
      saveMeta(meta);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Gallery delete error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── 项目存储（按用户隔离） ────────────────────────────────────
const PROJECTS_ROOT = path.join(__dirname, 'projects');
if (!fs.existsSync(PROJECTS_ROOT)) fs.mkdirSync(PROJECTS_ROOT, { recursive: true });

function getUserProjectsDir(userId) {
  const dir = path.join(PROJECTS_ROOT, userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

app.get('/api/projects', authMiddleware, (req, res) => {
  try {
    const dir = getUserProjectsDir(req.userId);
    const list = fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return { id: d.id, name: d.name, createdAt: d.createdAt, updatedAt: d.updatedAt, nodeCount: (d.nodes || []).length };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/projects', authMiddleware, (req, res) => {
  const dir = getUserProjectsDir(req.userId);
  const id  = `proj_${Date.now()}`;
  const now = new Date().toISOString();
  const project = { id, name: req.body.name || '未命名项目', createdAt: now, updatedAt: now, nodes: [], edges: [] };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(project));
  res.json({ id: project.id, name: project.name, createdAt: now, updatedAt: now, nodeCount: 0 });
});

app.get('/api/projects/:id', authMiddleware, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const fp = path.join(getUserProjectsDir(req.userId), `${req.params.id}.json`);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
});

app.put('/api/projects/:id', authMiddleware, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const fp = path.join(getUserProjectsDir(req.userId), `${req.params.id}.json`);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  const existing = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const updated = { ...existing, name: req.body.name ?? existing.name, nodes: req.body.nodes ?? existing.nodes, edges: req.body.edges ?? existing.edges, workbench: req.body.workbench ?? existing.workbench ?? null, updatedAt: new Date().toISOString() };
  fs.writeFileSync(fp, JSON.stringify(updated));
  res.json({ id: updated.id, name: updated.name, updatedAt: updated.updatedAt });
});

app.delete('/api/projects/:id', authMiddleware, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const fp = path.join(getUserProjectsDir(req.userId), `${req.params.id}.json`);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ ok: true });
});

// ── 剧本 Agent (SiliconFlow · MiniMax M1) ───────────────────
const SILICON_API_KEY = process.env.SILICON_API_KEY;
const SILICON_BASE    = 'https://api.siliconflow.cn/v1';
const AGENT_MODEL     = 'Pro/deepseek-ai/DeepSeek-V3.2';
const AGENT_PROMPT    = fs.readFileSync(path.join(__dirname, 'script-agent-prompt.txt'), 'utf8');

app.post('/api/script-agent', async (req, res) => {
  const { mode, script = '', shots = [], history = [] } = req.body;

  // 根据模式构造 user 消息
  let userContent = '';
  if (mode === 'analyze') {
    userContent = `【模式A · 剧本分析】请分析以下剧本的节奏结构和问题：\n\n${script}`;
  } else if (mode === 'outline') {
    const minShots = Math.max(30, Math.ceil(script.length / 35));
    userContent = `【模式B · 分镜大纲】请为以下剧本生成完整的分镜大纲，总镜头数不少于 ${minShots} 个。

每个镜头一行，格式固定为四个字段：
镜头 XX | 地点 | 景别 | 角度/运动 — 叙事作用

说明：
- 第二字段是地点（2-5个字，如：院子、室内、走廊、窗边）
- 同一场景内多个镜头地点字段填相同文字
- 每个对话/情绪场景至少6-8个镜头（正打+反打+关系镜头+反应特写）
- 不要在镜头行下面加"画面："或"叙事目的："等额外说明

示例：
镜头 01 | 院子 | ELS | 俯视·固定 — 建立深夜院子全景
镜头 02 | 院子 | LS | 平视·固定 — 王三走进院子
镜头 03 | 院子 | MCU | 正面·静止 — 王三皱眉说话
镜头 04 | 院子 | ECU | 平视·极缓慢推进 — 王三表情特写
镜头 05 | 院子 | MCU | 仰视·静止 — 婆婆探头
镜头 06 | 室内 | MS | 正面·固定 — 王三走进屋
镜头 07 | 室内 | MCU | 正面·静止 — 王三说话
镜头 08 | 室内 | MCU | 反面·静止 — 婆婆回应
镜头 09 | 室内 | CU | 平视·静止 — 婆婆表情特写
镜头 10 | 室内 | MS | 侧面·固定 — 两人关系镜头
...

镜头编号全剧连续，输出完整大纲后等待我确认，不要提前生成提示词。

剧本内容：
${script}`;
  } else if (mode === 'prompts') {
    const shotLines = shots
      .map(s => s.isGroup ? `\n场景：${s.header}` : s.header + (s.details ? '\n' + s.details : ''))
      .join('\n');
    userContent = `【模式B · 完整分镜】已确认的分镜大纲如下，请为每个镜头生成完整的 Seedance 提示词。

重要要求：
- 台词/旁白字段必须填写剧本原文台词，禁止写「无」（除非该镜头真的无台词）
- 台词必须完整引用，不得缩写或省略
- 严格按 B6 模板格式逐条输出

已确认大纲：
${shotLines}

原始剧本参考：
${script}`;
  } else if (mode === 'chat') {
    // 自由对话（用户在分析后继续追问）
    userContent = req.body.message || '';
  }

  // chat 模式追加约束：不在对话中直接生成大纲/提示词
  const systemContent = mode === 'chat'
    ? AGENT_PROMPT + '\n\n## 对话模式限制\n在对话中不要直接输出完整的分镜大纲或 Seedance 提示词内容。当用户确认修改完成、希望生成大纲或提示词时，请明确告知：「请点击左侧「生成分镜大纲」按钮，在对话框中继续将无法生成可复制的卡片版本。」'
    : AGENT_PROMPT;

  const messages = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: userContent },
  ];

  // SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const response = await axios.post(
      `${SILICON_BASE}/chat/completions`,
      { model: AGENT_MODEL, messages, stream: true, max_tokens: 8192 },
      {
        headers: { Authorization: `Bearer ${SILICON_API_KEY}`, 'Content-Type': 'application/json' },
        responseType: 'stream',
        timeout: 120000,
      }
    );

    let buffer = '';
    response.data.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留不完整的最后一行

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
        try {
          const parsed = JSON.parse(data);
          const text = parsed.choices?.[0]?.delta?.content;
          if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
        } catch {}
      }
    });

    response.data.on('end', () => { res.write('data: [DONE]\n\n'); res.end(); });
    response.data.on('error', err => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── 资产 Agent ────────────────────────────────────────────────
const STYLE_PREFIXES = {
  '2D':   '2D animation style, flat illustration, clean linework, vector art',
  '3D':   '3D CGI render, Unreal Engine 5, physically based rendering, cinematic lighting, ultra-detailed',
  '仿真人': 'photorealistic, hyperrealistic, 8K photography, cinematic, ultra-detailed',
};

function buildAssetSystemPrompt(mode, stylePrefix) {
  const assetTypes = mode === 'simple'
    ? `简单模式：只提取以下两类\n- CHARACTER（角色）：出现的主要人物\n- SCENE（场景）：主要发生的地点环境`
    : `详细模式：提取以下三类\n- CHARACTER（角色）：所有出现的人物\n- SCENE（场景）：所有独立的地点环境\n- PROP（道具）：重要的道具/物品`;

  return `你是专业影视视觉资产分析师。你的任务分两步完成。

## 第一步：精读剧本，提取角色形象
在生成任何提示词之前，先从剧本原文中仔细提取每个角色的：
- 年龄、性别、体型
- 面部特征（肤色、发型、发色、五官）
- 服装（颜色、款式、材质、配饰）
- 气质与特征标签
如果剧本中没有明确描述某个特征，根据剧本背景合理推断，但不要凭空捏造与剧情无关的特征。

## 第二步：提取资产并生成提示词

### 资产识别规则
${assetTypes}

### 去重规则（精确执行）
- 只有名称完全相同或极度相似的资产才合并
- 不同地点的同类场景视为不同资产（"加州机房"和"旧金山机房"是两个资产）
- 不同外貌的同类人物视为不同角色
- 宁可多一条记录，也不能把不同资产合并

### CHARACTER 提示词规则（严格遵守）
- 必须是：纯白色背景，单人全身三视图（正面、侧面、背面并排）
- 固定结构：${stylePrefix}, character design sheet, full body three-view reference (front view, side view, back view), pure white background, [详细外观描述], no background, no scene, no props, no other characters, model sheet style
- 外观描述必须来源于第一步的角色分析，做到精确具体
- 禁止出现任何场景、环境、背景元素

### SCENE 提示词规则（严格遵守）
- 必须是：空镜，场景内无任何人物
- 固定结构：${stylePrefix}, wide establishing shot, empty scene, no people, no characters, [详细场景环境描述], [光线与氛围], cinematic composition
- 禁止在场景提示词中出现任何人物、角色、人影

### PROP 提示词规则
- 固定结构：${stylePrefix}, product shot, close-up, pure white background, [道具详细描述], no background, no people

### 通用规则
- 语言：英文
- 禁止包含任何 Midjourney 参数（--style, --stylize 等）
- 风格前缀必须出现在每条提示词最前端，完整复制

## 输出格式（严格遵守，不输出任何其他内容）
所有 CHARACTER 先输出，再输出所有 SCENE，最后输出所有 PROP。

===ASSET_START===
TYPE: CHARACTER
NAME: 人物中文名称
DESC: 外观描述（中文，25字以内，基于剧本分析）
PROMPT: ${stylePrefix}, character design sheet, full body three-view reference (front view, side view, back view), pure white background, [英文外观描述], no background, no scene, no props, model sheet style
===ASSET_END===`;
}

app.post('/api/asset-agent', async (req, res) => {
  const { promptTexts = [], mode = 'simple', style = '3D', customStyle = '', script = '' } = req.body;
  const stylePrefix = style === 'custom' ? (customStyle || '3D CGI render') : (STYLE_PREFIXES[style] || STYLE_PREFIXES['3D']);
  const systemPrompt = buildAssetSystemPrompt(mode, stylePrefix);
  const scriptSection = script.trim()
    ? `## 原始剧本（用于第一步角色形象分析）\n${script.trim()}\n\n`
    : '';
  const userContent = `${scriptSection}## 分镜 Seedance 提示词（用于资产提取）\n\n${promptTexts.map((p, i) => `【镜头 ${i + 1}】\n${p}`).join('\n\n---\n\n')}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const response = await axios.post(
      `${SILICON_BASE}/chat/completions`,
      { model: AGENT_MODEL, messages, stream: true, max_tokens: 4096 },
      {
        headers: { Authorization: `Bearer ${SILICON_API_KEY}`, 'Content-Type': 'application/json' },
        responseType: 'stream', timeout: 120000,
      }
    );

    let buf = '';
    response.data.on('data', chunk => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
        try {
          const parsed = JSON.parse(data);
          const text = parsed.choices?.[0]?.delta?.content;
          if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
        } catch {}
      }
    });
    response.data.on('end', () => { res.write('data: [DONE]\n\n'); res.end(); });
    response.data.on('error', err => { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── 健康检查 ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ AIGC 后端运行在 http://localhost:${PORT}`);
  console.log(`   API Key: ${API_KEY ? API_KEY.slice(0, 10) + '...' : '❌ 未设置！'}`);
});
