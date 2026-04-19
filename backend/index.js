const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

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

const DASHSCOPE_KEY  = process.env.DASHSCOPE_API_KEY;
const DS_CHAT_BASE   = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DS_API_BASE    = 'https://dashscope.aliyuncs.com/api/v1';
const JWT_SECRET     = process.env.JWT_SECRET    || 'changeme-secret';
const ADMIN_SECRET   = process.env.ADMIN_SECRET  || 'changeme-admin';

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

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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
app.use('/uploads', express.static(UPLOADS_DIR));

// ── 图片上传配置 ─────────────────────────────────────────────
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ts = Date.now();
      const extByMime = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
      const ext = extByMime[file.mimetype] ?? '.bin';
      const base = file.originalname
        .replace(/\.[^/.]+$/, '')           // strip extension
        .replace(/[^a-zA-Z0-9_-]/g, '_')   // sanitize
        .slice(0, 64);                       // limit length
      cb(null, `upload-${ts}-${base}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('不支持的文件类型，请上传 jpg/png/webp/gif'));
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// ── 中文检测 + 自动翻译（WAN 视频生成推荐英文）───────────────────
async function ensureEnglish(text) {
  if (!/[\u4e00-\u9fff\u3040-\u30ff]/.test(text)) return text;
  try {
    const res = await axios.post(
      `${DS_CHAT_BASE}/chat/completions`,
      {
        model: 'qwen-turbo',
        messages: [{ role: 'user', content: `Translate this AI video/image prompt to English. Output only the translated text:\n\n${text}` }],
        max_tokens: 300,
      },
      { headers: { Authorization: `Bearer ${DASHSCOPE_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 }
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

// ── Wanx 文生图（DashScope 异步任务）──────────────────────────
const WANX_SIZE_MAP = {
  '1:1':  '1024*1024',
  '16:9': '1280*720',
  '9:16': '720*1280',
  '4:3':  '1024*768',
  '3:4':  '768*1024',
  '3:2':  '1200*800',
  '2:3':  '800*1200',
};

async function generateWanx(prompt, model, aspectRatio) {
  const size = WANX_SIZE_MAP[aspectRatio] || '1024*1024';
  const wanxModel = model || 'wanx2.1-t2i-turbo';

  // 1. 提交任务
  const submitRes = await axios.post(
    `${DS_API_BASE}/services/aigc/text2image/image-synthesis`,
    { model: wanxModel, input: { prompt }, parameters: { size, n: 1 } },
    {
      headers: {
        Authorization: `Bearer ${DASHSCOPE_KEY}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      timeout: 30000,
    }
  );
  const taskId = submitRes.data?.output?.task_id;
  if (!taskId) throw new Error('Wanx 任务提交失败: ' + JSON.stringify(submitRes.data));
  console.log(`[Wanx] 任务已提交 taskId=${taskId}`);

  // 2. 轮询（最多等 5 分钟）
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    const pollRes = await axios.get(
      `${DS_API_BASE}/tasks/${taskId}`,
      { headers: { Authorization: `Bearer ${DASHSCOPE_KEY}` }, timeout: 15000 }
    );
    const { task_status, results, message } = pollRes.data?.output || {};
    console.log(`[Wanx] 轮询 status=${task_status}`);
    if (task_status === 'FAILED') throw new Error('Wanx 生成失败: ' + (message || ''));
    if (task_status === 'SUCCEEDED' && results?.[0]?.url) {
      const imgRes = await axios.get(results[0].url, { responseType: 'arraybuffer', timeout: 30000 });
      const mimeType = imgRes.headers['content-type']?.split(';')[0] || 'image/png';
      const base64 = Buffer.from(imgRes.data).toString('base64');
      return { mimeType, base64 };
    }
  }
  throw new Error('Wanx 生成超时（5分钟）');
}

// ── 影像分析：JSON → 自然语言提示词 ────────────────────────────
function buildPromptFromAnalysis(a) {
  const parts = [];
  // 人物
  if (a.characters?.length) {
    parts.push(a.characters.map(c => c.description).filter(Boolean).join('，'));
  }
  // 场景
  if (a.setting?.location) parts.push(a.setting.location);
  if (a.setting?.time_of_day) parts.push(a.setting.time_of_day);
  if (a.setting?.era) parts.push(`${a.setting.era}风格`);
  // 光线
  if (a.lighting?.quality) parts.push(`${a.lighting.quality}`);
  if (a.lighting?.direction && a.lighting?.tone) {
    parts.push(`${a.lighting.direction}${a.lighting.tone}光线`);
  } else if (a.lighting?.tone) {
    parts.push(`${a.lighting.tone}光线`);
  }
  // 构图 & 镜头
  if (a.composition?.shot_type) parts.push(a.composition.shot_type);
  if (a.composition?.depth_of_field) parts.push(a.composition.depth_of_field);
  if (a.camera?.lens) parts.push(a.camera.lens);
  if (a.camera?.bokeh) parts.push(a.camera.bokeh);
  // 色彩
  if (a.color?.grade) parts.push(a.color.grade);
  if (a.color?.palette) parts.push(`${a.color.palette}色调`);
  if (a.color?.temperature) parts.push(`${a.color.temperature}色温`);
  // 氛围（最关键：情绪基调 + 英文关键词直接进提示词）
  if (a.atmosphere?.mood) parts.push(a.atmosphere.mood);
  if (a.atmosphere?.keywords?.length) {
    parts.push(a.atmosphere.keywords.filter(Boolean).join(', '));
  }
  // 风格 & 后期
  if (a.style?.aesthetic) parts.push(a.style.aesthetic);
  if (a.post_processing?.style) parts.push(a.post_processing.style);
  if (a.post_processing?.effects) parts.push(a.post_processing.effects);
  if (a.style?.film_grain) parts.push('film grain, 胶片质感');
  return parts.filter(Boolean).join('，');
}

// ── 图片反向拆解接口 ──────────────────────────────────────────
app.post('/api/analyze-image', authMiddleware, async (req, res) => {
  try {
    const { base64, mimeType = 'image/jpeg' } = req.body;
    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const safeMime = ALLOWED_MIME.includes(mimeType) ? mimeType : 'image/jpeg';
    if (!base64) return res.status(400).json({ error: '缺少图片数据' });

    if (!DASHSCOPE_KEY) return res.status(500).json({ error: '未配置 DASHSCOPE_API_KEY' });

    console.log('[分析图片] 调用 qwen3-vl-flash...');

    const response = await axios.post(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        model: 'qwen3-vl-flash',
        messages: [
          {
            role: 'system',
            content: '你是专业的AIGC影像提示词分析师。你的目标是帮助用户精准复刻图片的氛围感，尤其关注"为什么这张图有这种感觉"。除了基础元素，重点分析：色彩分级、情绪基调、镜头语言和后期风格。\n\n严格只返回以下JSON格式，不要包含任何其他文字或markdown代码块：\n{"characters":[{"description":"人物外貌、服装、表情的详细描述","position":"画面位置"}],"setting":{"location":"具体地点环境","era":"时代背景","time_of_day":"时间段"},"lighting":{"type":"光源类型","direction":"光线方向","tone":"光线色调","quality":"柔光/硬光/漫射"},"composition":{"shot_type":"景别","angle":"拍摄角度","depth_of_field":"强虚化/浅景深/清晰"},"color":{"palette":"具体主色调，如莫兰迪灰绿+米白","grade":"色彩分级风格，如青橙调/复古胶片/高对比冷调","temperature":"暖/冷/中性"},"atmosphere":{"mood":"情绪基调，如孤独忧郁/温暖治愈/紧张压抑","keywords":["3-5个最能描述氛围的英文词，如cinematic/melancholic/ethereal"]},"camera":{"lens":"镜头类型，如85mm人像/24mm广角/长焦压缩","bokeh":"强虚化/浅景深背景虚化/前景清晰"},"post_processing":{"style":"后期风格，如胶片颗粒/数字锐化/模拟褪色","effects":"特效，如漏光/色散/暗角"},"style":{"aesthetic":"整体美学风格的详细描述","film_grain":false}}\n无法判断的字段填null。'
          },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${safeMime};base64,${base64}` } },
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
    );

    const rawText = response.data?.choices?.[0]?.message?.content;
    if (!rawText) throw new Error('模型返回了空响应');
    console.log('[分析图片] 原始响应:', rawText.slice(0, 200));

    // 提取 JSON（模型有时会包在 ```json ... ``` 中）
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('模型未返回有效JSON');

    let analysis;
    try {
      analysis = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('模型返回的JSON格式无效，无法解析');
    }
    const reconstructedPrompt = buildPromptFromAnalysis(analysis);

    console.log('[分析图片] 成功，重组提示词:', reconstructedPrompt.slice(0, 100));
    res.json({ analysis, reconstructedPrompt });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message || '分析失败';
    console.error('[分析图片] 错误:', msg);
    res.status(500).json({ error: msg });
  }
});

// ── 生图接口 ────────────────────────────────────────────────
app.post('/api/generate-image', authMiddleware, async (req, res) => {
  try {
    const {
      prompt,
      model = 'wanx2.1-t2i-turbo',
      aspectRatio = '1:1',
    } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt 不能为空' });
    }
    if (!DASHSCOPE_KEY) return res.status(500).json({ error: '未配置 DASHSCOPE_API_KEY' });

    console.log(`[生图] model=${model} ratio=${aspectRatio}`);
    console.log(`[生图] prompt="${prompt.slice(0, 80)}"`);

    let result;
    result = await generateWanx(prompt.trim(), model, aspectRatio);

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

// WAN 模型变体 → size 映射
const WAN_CONFIG = {
  'wan_portrait':  { size: '720*1280',  model: 'wan2.1-t2v-turbo' },
  'wan_landscape': { size: '1280*720',  model: 'wan2.1-t2v-turbo' },
  'wan_square':    { size: '960*960',   model: 'wan2.1-t2v-turbo' },
};

// ── 视频生成接口 ─────────────────────────────────────────────
app.post('/api/generate-video', authMiddleware, async (req, res) => {
  try {
    const { prompt, model = 'wan_landscape' } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt 不能为空' });
    }
    if (!DASHSCOPE_KEY) return res.status(500).json({ error: '未配置 DASHSCOPE_API_KEY' });

    console.log(`[生视频] model=${model} prompt="${prompt.slice(0, 60)}"`);

    const englishPrompt = await ensureEnglish(prompt.trim());
    const cfg = WAN_CONFIG[model] || WAN_CONFIG['wan_landscape'];

    const response = await axios.post(
      `${DS_API_BASE}/services/aigc/video-generation/video-synthesis`,
      { model: cfg.model, input: { text: englishPrompt }, parameters: { size: cfg.size } },
      {
        headers: {
          Authorization: `Bearer ${DASHSCOPE_KEY}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        timeout: 30000,
      }
    );
    const taskId = response.data?.output?.task_id;
    if (!taskId) throw new Error('未获取到任务ID：' + JSON.stringify(response.data));
    console.log(`[生视频] WAN 任务已提交: ${taskId} (${cfg.size})`);
    return res.json({ taskId, type: 'wan' });

  } catch (error) {
    const errMsg =
      error.response?.data?.message ||
      error.response?.data?.error?.message ||
      JSON.stringify(error.response?.data) ||
      error.message;
    console.error(`[生视频] 提交失败: ${errMsg}`);
    res.status(500).json({ error: errMsg });
  }
});

// ── 视频状态查询 ─────────────────────────────────────────────
// GET /api/video-status?taskId=xxx
const WAN_STATUS_MAP = {
  'PENDING':   'submitted',
  'RUNNING':   'in_progress',
  'SUCCEEDED': 'completed',
  'FAILED':    'failed',
};

app.get('/api/video-status', authMiddleware, async (req, res) => {
  try {
    const { taskId } = req.query;
    if (!taskId) return res.status(400).json({ error: 'taskId 不能为空' });

    const response = await axios.get(
      `${DS_API_BASE}/tasks/${taskId}`,
      { headers: { Authorization: `Bearer ${DASHSCOPE_KEY}` }, timeout: 15000 }
    );

    const output = response.data?.output || {};
    const status = WAN_STATUS_MAP[output.task_status] || output.task_status;
    const videoUrl = status === 'completed' ? `/api/video-proxy/${taskId}` : null;

    res.json({ status, videoUrl, progress: null });

  } catch (error) {
    const errMsg = error.response?.data?.message || error.message;
    console.error(`[视频状态] 查询失败: ${errMsg}`);
    res.status(500).json({ error: errMsg });
  }
});

// ── WAN 视频代理（代理 DashScope 临时链接）──────────────────────
app.get('/api/video-proxy/:taskId', authMiddleware, async (req, res) => {
  try {
    const { taskId } = req.params;
    console.log(`[视频代理] taskId=${taskId}`);

    // 先查任务获取视频 URL
    const pollRes = await axios.get(
      `${DS_API_BASE}/tasks/${taskId}`,
      { headers: { Authorization: `Bearer ${DASHSCOPE_KEY}` }, timeout: 15000 }
    );
    const videoUrl = pollRes.data?.output?.video_url;
    if (!videoUrl) return res.status(404).json({ error: '视频未就绪' });

    const response = await axios.get(videoUrl, { responseType: 'stream', timeout: 120000 });
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="wan-${taskId}.mp4"`);
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
      { id: 'wanx2.1-t2i-turbo', name: 'Wanx 2.1 Turbo', desc: '速度快'  },
      { id: 'wanx2.1-t2i-plus',  name: 'Wanx 2.1 Plus',  desc: '高质量'  },
    ],
    video: [
      { id: 'wan_landscape', name: 'WAN 2.1 横屏', desc: '1280×720',  group: 'WAN 2.1' },
      { id: 'wan_portrait',  name: 'WAN 2.1 竖屏', desc: '720×1280',  group: 'WAN 2.1' },
      { id: 'wan_square',    name: 'WAN 2.1 方形', desc: '960×960',   group: 'WAN 2.1' },
    ],
  });
});

// ── 图片上传接口 ──────────────────────────────────────────────
app.post('/api/upload', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '没有收到文件' });
  const url = `/uploads/${req.file.filename}`;
  const timestamp = Date.now();
  res.json({ url, filename: req.file.filename, timestamp });
});

app.delete('/api/upload/:filename', authMiddleware, (req, res) => {
  const { filename } = req.params;
  // Basic safety: prevent path traversal
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return res.status(400).json({ error: '无效文件名' });
  }
  const filePath = path.join(UPLOADS_DIR, filename);
  // Defense in depth: verify resolved path is within uploads dir
  if (!filePath.startsWith(UPLOADS_DIR + path.sep) && filePath !== UPLOADS_DIR) {
    return res.status(400).json({ error: '无效文件名' });
  }
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败' });
  }
});

// ── 图片库接口 ────────────────────────────────────────────────
app.get('/api/gallery', authMiddleware, (req, res) => {
  // Generated images from metadata
  const meta = loadMeta();
  const generated = meta.map(m => ({
    id: m.id,
    url: `/generated/${m.filename}`,
    prompt: m.prompt,
    model: m.model,
    refCount: m.refCount || 0,
    createdAt: m.createdAt,
    source: 'generated',
  }));

  // Uploaded images from uploads/ directory
  let uploaded = [];
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    uploaded = files
      .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
      .map(filename => {
        // Extract timestamp from filename: upload-{timestamp}-{name}
        const match = filename.match(/^upload-(\d+)-/);
        const createdAt = match ? parseInt(match[1], 10) : 0;
        return {
          id: `upload_${filename}`,
          url: `/uploads/${filename}`,
          prompt: '',
          model: '',
          refCount: 0,
          createdAt,
          source: 'uploaded',
        };
      });
  } catch (e) {
    // uploads dir may not exist yet, ignore
  }

  // Merge and sort by createdAt descending
  const all = [...generated, ...uploaded].sort((a, b) => b.createdAt - a.createdAt);
  res.json(all);
});

app.delete('/api/gallery/:id', authMiddleware, (req, res) => {
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

// ── 剧本 Agent (DashScope · Qwen) ────────────────────────────
const AGENT_MODEL  = 'qwen-plus';
const AGENT_PROMPT = fs.readFileSync(path.join(__dirname, 'script-agent-prompt.txt'), 'utf8');

app.post('/api/script-agent', authMiddleware, async (req, res) => {
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
      `${DS_CHAT_BASE}/chat/completions`,
      { model: AGENT_MODEL, messages, stream: true, max_tokens: 8192 },
      {
        headers: { Authorization: `Bearer ${DASHSCOPE_KEY}`, 'Content-Type': 'application/json' },
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

app.post('/api/asset-agent', authMiddleware, async (req, res) => {
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
      `${DS_CHAT_BASE}/chat/completions`,
      { model: AGENT_MODEL, messages, stream: true, max_tokens: 4096 },
      {
        headers: { Authorization: `Bearer ${DASHSCOPE_KEY}`, 'Content-Type': 'application/json' },
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

// ── 全局错误处理（multer 上传错误等）─────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '文件不能超过 20MB' });
  }
  if (err instanceof multer.MulterError || (err && err.message && !err.status)) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ AIGC 后端运行在 http://localhost:${PORT}`);
  console.log(`   DashScope Key: ${DASHSCOPE_KEY ? DASHSCOPE_KEY.slice(0, 10) + '...' : '❌ 未设置！'}`);
});
