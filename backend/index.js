const express = require('express');
const cors    = require('cors');
const dotenv  = require('dotenv');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const multer  = require('multer');

dotenv.config();

const db      = require('./db');
const storage = require('./storage');

const app = express();

// CORS
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
// JSON body limit: 10mb covers 60-episode scripts; 50mb was unnecessary attack surface
app.use(express.json({ limit: '10mb' }));

// ── 工具 ──────────────────────────────────────────────────────
function validateId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
}

const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY;
const DS_CHAT_BASE  = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DS_API_BASE   = 'https://dashscope.aliyuncs.com/api/v1';
const JWT_SECRET    = process.env.JWT_SECRET  || 'changeme-secret';
const ADMIN_SECRET  = process.env.ADMIN_SECRET || 'changeme-admin';

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

// ── 一次性数据迁移（JSON → SQLite）────────────────────────────
// Runs at startup. Safe to re-run — skips records that already exist.
function migrateFromJson() {
  // users.json
  const usersFile = path.join(__dirname, 'users.json');
  if (fs.existsSync(usersFile)) {
    try {
      const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
      let migrated = 0;
      for (const u of users) {
        if (!db.findUserByUsername(u.username)) {
          db.createUser(u.id, u.username, u.passwordHash, u.isAdmin || false);
          migrated++;
        }
      }
      if (migrated > 0) console.log(`[迁移] users.json → SQLite: ${migrated} 用户`);
    } catch (e) {
      console.warn('[迁移] users.json 迁移失败:', e.message);
    }
  }

  // metadata.json
  const metaFile = path.join(__dirname, 'generated', 'metadata.json');
  if (fs.existsSync(metaFile)) {
    try {
      const images = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      let migrated = 0;
      for (const m of images) {
        if (!db.findImage(m.id)) {
          const localUrl = `/generated/${m.filename}`;
          db.persistImageRecord(m.id, m.filename, m.mimeType || 'image/png', m.prompt || '', m.model || '', localUrl);
          migrated++;
        }
      }
      if (migrated > 0) console.log(`[迁移] metadata.json → SQLite: ${migrated} 图片`);
    } catch (e) {
      console.warn('[迁移] metadata.json 迁移失败:', e.message);
    }
  }
}

migrateFromJson();

// ── 静态文件 ──────────────────────────────────────────────────
const GENERATED_DIR = storage.GENERATED_DIR;
const UPLOADS_DIR   = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use('/generated', express.static(GENERATED_DIR));
app.use('/uploads',   express.static(UPLOADS_DIR));

// ── 图片上传 (multer) ─────────────────────────────────────────
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename:    (_req, file, cb) => {
      const ts = Date.now();
      const extByMime = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
      const ext  = extByMime[file.mimetype] ?? '.bin';
      const base = file.originalname.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
      cb(null, `upload-${ts}-${base}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('不支持的文件类型，请上传 jpg/png/webp/gif'));
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ── 注册 Router 模块 ──────────────────────────────────────────
const authRouter    = require('./routes/auth');
const galleryRouter = require('./routes/gallery');
const assetsRouter  = require('./routes/assets');

// auth routes mount at both /api/auth/* and /api/admin/* (router handles both internally)
app.use('/api/auth',  authRouter);
app.use('/api/admin', authRouter);
app.use('/api/gallery', authMiddleware, galleryRouter);
app.use('/api/assets',  authMiddleware, assetsRouter);

// ── 中文检测 + 自动翻译 ───────────────────────────────────────
async function ensureEnglish(text) {
  if (!/[一-鿿぀-ヿ]/.test(text)) return text;
  try {
    const res = await axios.post(
      `${DS_CHAT_BASE}/chat/completions`,
      { model: 'qwen-turbo', messages: [{ role: 'user', content: `Translate this AI video/image prompt to English. Output only the translated text:\n\n${text}` }], max_tokens: 300 },
      { headers: { Authorization: `Bearer ${DASHSCOPE_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    const translated = res.data?.choices?.[0]?.message?.content?.trim();
    if (translated) { console.log(`[翻译] "${text.slice(0,40)}" → "${translated.slice(0,60)}"`); return translated; }
  } catch (e) { console.warn('[翻译] 失败，使用原始 prompt:', e.message); }
  return text;
}

// ── Wanx 文生图 ───────────────────────────────────────────────
const WANX_SIZE_MAP = { '1:1': '1024*1024', '16:9': '1280*720', '9:16': '720*1280', '4:3': '1024*768', '3:4': '768*1024', '3:2': '1200*800', '2:3': '800*1200' };

async function generateWanx(prompt, model, aspectRatio) {
  const size = WANX_SIZE_MAP[aspectRatio] || '1024*1024';
  const wanxModel = model || 'wanx2.1-t2i-turbo';

  const submitRes = await axios.post(
    `${DS_API_BASE}/services/aigc/text2image/image-synthesis`,
    { model: wanxModel, input: { prompt }, parameters: { size, n: 1 } },
    { headers: { Authorization: `Bearer ${DASHSCOPE_KEY}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' }, timeout: 30000 }
  );
  const taskId = submitRes.data?.output?.task_id;
  if (!taskId) throw new Error('Wanx 任务提交失败: ' + JSON.stringify(submitRes.data));
  console.log(`[Wanx] 任务已提交 taskId=${taskId}`);

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    const pollRes = await axios.get(`${DS_API_BASE}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${DASHSCOPE_KEY}` }, timeout: 15000 });
    const { task_status, results, message } = pollRes.data?.output || {};
    console.log(`[Wanx] 轮询 status=${task_status}`);
    if (task_status === 'FAILED') throw new Error('Wanx 生成失败: ' + (message || ''));
    if (task_status === 'SUCCEEDED' && results?.[0]?.url) {
      const imgRes = await axios.get(results[0].url, { responseType: 'arraybuffer', timeout: 30000 });
      const mimeType = imgRes.headers['content-type']?.split(';')[0] || 'image/png';
      const base64   = Buffer.from(imgRes.data).toString('base64');
      return { mimeType, base64 };
    }
  }
  throw new Error('Wanx 生成超时（5分钟）');
}

// ── 影像分析 ──────────────────────────────────────────────────
function buildPromptFromAnalysis(a) {
  const parts = [];
  if (a.characters?.length) parts.push(a.characters.map(c => c.description).filter(Boolean).join('，'));
  if (a.setting?.location) parts.push(a.setting.location);
  if (a.setting?.time_of_day) parts.push(a.setting.time_of_day);
  if (a.setting?.era) parts.push(`${a.setting.era}风格`);
  if (a.lighting?.quality) parts.push(a.lighting.quality);
  if (a.lighting?.direction && a.lighting?.tone) parts.push(`${a.lighting.direction}${a.lighting.tone}光线`);
  else if (a.lighting?.tone) parts.push(`${a.lighting.tone}光线`);
  if (a.composition?.shot_type) parts.push(a.composition.shot_type);
  if (a.composition?.depth_of_field) parts.push(a.composition.depth_of_field);
  if (a.camera?.lens) parts.push(a.camera.lens);
  if (a.camera?.bokeh) parts.push(a.camera.bokeh);
  if (a.color?.grade) parts.push(a.color.grade);
  if (a.color?.palette) parts.push(`${a.color.palette}色调`);
  if (a.color?.temperature) parts.push(`${a.color.temperature}色温`);
  if (a.atmosphere?.mood) parts.push(a.atmosphere.mood);
  if (a.atmosphere?.keywords?.length) parts.push(a.atmosphere.keywords.filter(Boolean).join(', '));
  if (a.style?.aesthetic) parts.push(a.style.aesthetic);
  if (a.post_processing?.style) parts.push(a.post_processing.style);
  if (a.post_processing?.effects) parts.push(a.post_processing.effects);
  if (a.style?.film_grain) parts.push('film grain, 胶片质感');
  return parts.filter(Boolean).join('，');
}

// POST /api/analyze-image
app.post('/api/analyze-image', authMiddleware, async (req, res) => {
  try {
    const { base64, mimeType = 'image/jpeg' } = req.body;
    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const safeMime = ALLOWED_MIME.includes(mimeType) ? mimeType : 'image/jpeg';
    if (!base64) return res.status(400).json({ error: '缺少图片数据' });
    if (!DASHSCOPE_KEY) return res.status(500).json({ error: '未配置 DASHSCOPE_API_KEY' });

    const response = await axios.post(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        model: 'qwen3-vl-flash',
        messages: [
          { role: 'system', content: '你是专业的AIGC影像提示词分析师。你的目标是帮助用户精准复刻图片的氛围感，尤其关注"为什么这张图有这种感觉"。除了基础元素，重点分析：色彩分级、情绪基调、镜头语言和后期风格。\n\n严格只返回以下JSON格式，不要包含任何其他文字或markdown代码块：\n{"characters":[{"description":"人物外貌、服装、表情的详细描述","position":"画面位置"}],"setting":{"location":"具体地点环境","era":"时代背景","time_of_day":"时间段"},"lighting":{"type":"光源类型","direction":"光线方向","tone":"光线色调","quality":"柔光/硬光/漫射"},"composition":{"shot_type":"景别","angle":"拍摄角度","depth_of_field":"强虚化/浅景深/清晰"},"color":{"palette":"具体主色调，如莫兰迪灰绿+米白","grade":"色彩分级风格，如青橙调/复古胶片/高对比冷调","temperature":"暖/冷/中性"},"atmosphere":{"mood":"情绪基调，如孤独忧郁/温暖治愈/紧张压抑","keywords":["3-5个最能描述氛围的英文词，如cinematic/melancholic/ethereal"]},"camera":{"lens":"镜头类型，如85mm人像/24mm广角/长焦压缩","bokeh":"强虚化/浅景深背景虚化/前景清晰"},"post_processing":{"style":"后期风格，如胶片颗粒/数字锐化/模拟褪色","effects":"特效，如漏光/色散/暗角"},"style":{"aesthetic":"整体美学风格的详细描述","film_grain":false}}\n无法判断的字段填null。' },
          { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${safeMime};base64,${base64}` } }, { type: 'text', text: '请分析这张图片的影像要素，返回JSON。' }] }
        ]
      },
      { headers: { Authorization: `Bearer ${DASHSCOPE_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const rawText = response.data?.choices?.[0]?.message?.content;
    if (!rawText) throw new Error('模型返回了空响应');
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('模型未返回有效JSON');
    let analysis;
    try { analysis = JSON.parse(jsonMatch[0]); } catch { throw new Error('模型返回的JSON格式无效'); }
    const reconstructedPrompt = buildPromptFromAnalysis(analysis);
    res.json({ analysis, reconstructedPrompt });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.error?.message || err.message || '分析失败' });
  }
});

// ── 生图接口 ─────────────────────────────────────────────────
app.post('/api/generate-image', authMiddleware, async (req, res) => {
  try {
    const { prompt, model = 'wanx2.1-t2i-turbo', aspectRatio = '1:1' } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: 'prompt 不能为空' });
    if (!DASHSCOPE_KEY)  return res.status(500).json({ error: '未配置 DASHSCOPE_API_KEY' });

    console.log(`[生图] model=${model} ratio=${aspectRatio} prompt="${prompt.slice(0, 80)}"`);
    const result = await generateWanx(prompt.trim(), model, aspectRatio);

    // persist via storage (local or OSS) + record in DB
    const id  = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
    const imageUrl = await storage.uploadImageBase64(result.base64, result.mimeType, id);
    db.persistImageRecord(id, `${id}.${ext}`, result.mimeType, prompt.trim(), model, imageUrl);

    console.log(`[生图] 成功 savedId=${id}`);
    res.json({ base64: result.base64, mimeType: result.mimeType, savedId: id, imageUrl });
  } catch (error) {
    const errMsg = error.response?.data?.error?.message || JSON.stringify(error.response?.data?.error) || error.message;
    console.error(`[生图] 失败: ${errMsg}`);
    res.status(500).json({ error: errMsg });
  }
});

// ── 视频生成 ──────────────────────────────────────────────────
const WAN_CONFIG = {
  'wan_portrait':  { size: '720*1280',  model: 'wan2.1-t2v-turbo' },
  'wan_landscape': { size: '1280*720',  model: 'wan2.1-t2v-turbo' },
  'wan_square':    { size: '960*960',   model: 'wan2.1-t2v-turbo' },
};

app.post('/api/generate-video', authMiddleware, async (req, res) => {
  try {
    const { prompt, model = 'wan_landscape' } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: 'prompt 不能为空' });
    if (!DASHSCOPE_KEY)  return res.status(500).json({ error: '未配置 DASHSCOPE_API_KEY' });

    const englishPrompt = await ensureEnglish(prompt.trim());
    const cfg = WAN_CONFIG[model] || WAN_CONFIG['wan_landscape'];

    const response = await axios.post(
      `${DS_API_BASE}/services/aigc/video-generation/video-synthesis`,
      { model: cfg.model, input: { text: englishPrompt }, parameters: { size: cfg.size } },
      { headers: { Authorization: `Bearer ${DASHSCOPE_KEY}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' }, timeout: 30000 }
    );
    const taskId = response.data?.output?.task_id;
    if (!taskId) throw new Error('未获取到任务ID：' + JSON.stringify(response.data));
    console.log(`[生视频] WAN 任务已提交: ${taskId} (${cfg.size})`);
    return res.json({ taskId, type: 'wan' });
  } catch (error) {
    const errMsg = error.response?.data?.message || error.response?.data?.error?.message || JSON.stringify(error.response?.data) || error.message;
    console.error(`[生视频] 提交失败: ${errMsg}`);
    res.status(500).json({ error: errMsg });
  }
});

// GET /api/video-status?taskId=xxx
const WAN_STATUS_MAP = { 'PENDING': 'submitted', 'RUNNING': 'in_progress', 'SUCCEEDED': 'completed', 'FAILED': 'failed' };

app.get('/api/video-status', authMiddleware, async (req, res) => {
  try {
    const { taskId } = req.query;
    if (!taskId) return res.status(400).json({ error: 'taskId 不能为空' });
    const response = await axios.get(`${DS_API_BASE}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${DASHSCOPE_KEY}` }, timeout: 15000 });
    const output   = response.data?.output || {};
    const status   = WAN_STATUS_MAP[output.task_status] || output.task_status;
    res.json({ status, videoUrl: status === 'completed' ? `/api/video-proxy/${taskId}` : null, progress: null });
  } catch (error) {
    res.status(500).json({ error: error.response?.data?.message || error.message });
  }
});

// GET /api/video-proxy/:taskId
app.get('/api/video-proxy/:taskId', authMiddleware, async (req, res) => {
  try {
    const pollRes  = await axios.get(`${DS_API_BASE}/tasks/${req.params.taskId}`, { headers: { Authorization: `Bearer ${DASHSCOPE_KEY}` }, timeout: 15000 });
    const videoUrl = pollRes.data?.output?.video_url;
    if (!videoUrl) return res.status(404).json({ error: '视频未就绪' });
    const response = await axios.get(videoUrl, { responseType: 'stream', timeout: 120000 });
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="wan-${req.params.taskId}.mp4"`);
    if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
    response.data.pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/models
app.get('/api/models', authMiddleware, (req, res) => {
  res.json({
    image: [
      { id: 'wanx2.1-t2i-turbo', name: 'Wanx 2.1 Turbo', desc: '速度快' },
      { id: 'wanx2.1-t2i-plus',  name: 'Wanx 2.1 Plus',  desc: '高质量' },
    ],
    video: [
      { id: 'wan_landscape', name: 'WAN 2.1 横屏', desc: '1280×720', group: 'WAN 2.1' },
      { id: 'wan_portrait',  name: 'WAN 2.1 竖屏', desc: '720×1280', group: 'WAN 2.1' },
      { id: 'wan_square',    name: 'WAN 2.1 方形', desc: '960×960',  group: 'WAN 2.1' },
    ],
  });
});

// ── 图片上传接口 ──────────────────────────────────────────────
app.post('/api/upload', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '没有收到文件' });
  res.json({ url: `/uploads/${req.file.filename}`, filename: req.file.filename, timestamp: Date.now() });
});

app.delete('/api/upload/:filename', authMiddleware, (req, res) => {
  const { filename } = req.params;
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return res.status(400).json({ error: '无效文件名' });
  }
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!filePath.startsWith(UPLOADS_DIR + path.sep) && filePath !== UPLOADS_DIR) {
    return res.status(400).json({ error: '无效文件名' });
  }
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: '删除失败' }); }
});

// ── 项目存储 ──────────────────────────────────────────────────
const PROJECTS_ROOT = path.join(__dirname, 'projects');
if (!fs.existsSync(PROJECTS_ROOT)) fs.mkdirSync(PROJECTS_ROOT, { recursive: true });

function getUserProjectsDir(userId) {
  const dir = path.join(PROJECTS_ROOT, userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

app.get('/api/projects', authMiddleware, (req, res) => {
  try {
    const list = fs.readdirSync(getUserProjectsDir(req.userId))
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(getUserProjectsDir(req.userId), f), 'utf8'));
          return { id: d.id, name: d.name, createdAt: d.createdAt, updatedAt: d.updatedAt, nodeCount: (d.nodes || []).length };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/projects', authMiddleware, (req, res) => {
  const id  = `proj_${Date.now()}`;
  const now = new Date().toISOString();
  const project = { id, name: req.body.name || '未命名项目', createdAt: now, updatedAt: now, nodes: [], edges: [] };
  fs.writeFileSync(path.join(getUserProjectsDir(req.userId), `${id}.json`), JSON.stringify(project));
  res.json({ id, name: project.name, createdAt: now, updatedAt: now, nodeCount: 0 });
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
  const updated  = { ...existing, name: req.body.name ?? existing.name, nodes: req.body.nodes ?? existing.nodes, edges: req.body.edges ?? existing.edges, workbench: req.body.workbench ?? existing.workbench ?? null, updatedAt: new Date().toISOString() };
  fs.writeFileSync(fp, JSON.stringify(updated));
  res.json({ id: updated.id, name: updated.name, updatedAt: updated.updatedAt });
});

app.delete('/api/projects/:id', authMiddleware, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const fp = path.join(getUserProjectsDir(req.userId), `${req.params.id}.json`);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ ok: true });
});

// ── 剧本 Agent ────────────────────────────────────────────────
const AGENT_MODEL = 'qwen-max';   // 剧本创作主力（qwen-turbo 用于摘要）

// ── 剧本创作 system prompts ───────────────────────────────────
const STORY_BIBLE_PROMPT = `你是专业的短剧故事架构师，负责创作"故事圣经"（Story Bible）。
故事圣经是整部剧的创作宪法，所有集数的编写都必须严格遵守这份文档。

## 节拍铁律（规划主线冲突架构时必须满足，不得偏离）

1. 第1-3集：每集必须设置**双钩子**（开场钩子 + 结尾悬念，两者不能是同一个）
2. 第4集：完成主角人物弧光起步——性格或处境发生第一次真实的改变
3. 第8集：必须埋设一条**长线钩子**，影响力须覆盖后续10集以上
4. 第9-14集、16-24集、32-39集：每集保证1-2个小反转；每连续3-5集内设置1个大反转
5. 第5-7集、25-29集埋设的所有伏笔，必须在第40-49集对应收束
6. 第30集：全剧前半段**最大反转**，颠覆观众对主线走向的认知
7. 第32-39集：主角完成持续成长升级（能力、资源或格局的质变）
8. 第55-58集：每集结尾必须设置**强钩子**，将全剧推向终局对决
9. 第55-58集：主角完成终极蜕变
10. 全剧冲突递进逻辑必须严格遵循：局部打脸 → 击败中反派 → 阶段性对抗 → 终极危机 → 终极对决
11. **第${'{TOTAL}'}集（大结局）铁律**：全部伏笔收束、主线人物圆满落定；主角弧光与关系以落定感收束；**禁止**开放式悬念、续集钩子、未解之谜或「第二季见」式结尾

（注：以上集数节点以60集为基准；总集数不同时，等比例调整各节点位置）

输出格式（严格遵守，用中文）：

# 《剧名》故事圣经

## 定位
- **一句话卖点**：（能直接用于短视频投放的广告语）
- **核心情绪钩子**：（观众为什么要追完60集？）
- **目标受众**：

## 世界观与背景
（3-5句话，具体到可以拍摄的场景环境）

## 人物图谱

### 主角：姓名
- 年龄、职业、外貌标签
- 核心性格（3个词）
- 核心动机：他/她最想要什么？
- 核心伤痛：什么造就了现在的他/她？
- 成长弧：从第1集到结局，发生了什么根本性转变？
- 标志性行为/口头禅

### 反派：姓名
- 身份背景
- 动机（必须有自己的逻辑，不能只是"坏"）
- 与主角的根本冲突

### 重要配角（每人3-4行）

## 主线冲突架构（${'{TOTAL}'}集）

| 阶段 | 集数范围 | 核心事件 | 情绪基调 |
|------|----------|----------|----------|
| 开篇钩子 | 1-5集 | | 冲击/悬疑 |
| 矛盾建立 | 6-15集 | | |
| 第一转折 | 约第15集 | | |
| 发展深化 | 16-30集 | | |
| 中点高潮 | 约第30集 | | |
| 势力反转 | 31-45集 | | |
| 第二转折 | 约第45集 | | |
| 冲向结局 | 46-55集 | | |
| 高潮决战 | 56-58集 | | |
| 收尾 | 59-${'{TOTAL}'}集 | | |

## 情感节奏设计
- **哭点**：（哪几集、什么情节让观众落泪）
- **爽点**：（哪几集、什么反转让观众拍案叫绝）
- **恨点**：（哪几集、什么情节让观众恨得咬牙切齿）

## 创作规范
- 对白风格：
- 禁忌（绝不能出现的情节/行为）：`;

const EPISODE_MAP_PROMPT = `你是专业的短剧集数策划师。以「角色小传」为主要依据设计每集的冲突、人物行为与关系变化；「故事圣经」作为世界观与主线参考，确保分集内容与已定人设、故事线一致。

每集用一行输出，格式严格如下（不要多行，不要额外说明）：
第N集《集名》| 情节: [2句话说清楚这集发生什么] | 钩子: [开场如何抓住观众] | 结尾: [留什么悬念或爽点]

要求：
- 集名要有吸引力（2-6字）
- 情节要有起伏，不能平铺直叙，人物行为必须符合角色小传中的性格与动机
- 严格遵守故事圣经中的节拍铁律（双钩子、大反转、伏笔收束节点等）
- 钩子每集都要不同，不能重复套路
- 结尾的悬念/爽点要让观众无法停下来
- **最后一集（大结局）**：结尾字段须写明伏笔全部收束与圆满落定，禁止「未完悬念」或「续集向」表述`;

const WRITE_EPISODE_PROMPT = `你是专业的短剧剧本作家。基于角色小传、故事圣经和集数大纲，创作指定集数的完整剧本。

【内容铁律】
- 人物性格、背景、口头禅必须与角色小传和故事圣经完全一致，不得擅改人设
- 本集情节必须与大纲中的情节描述吻合，禁止编写大纲未写明的关键事件
- 开场必须有强钩子（与大纲"钩子"字段一致）
- 结尾必须体现大纲"结尾"字段描述的悬念或爽点

【场景规范】
- 单集最多 3 个场景
- 每个场景第一行格式：集号-场号 场景名 内/外 日/夜（如：1-1 许家客厅 内 日）
- 场景名须固定统一，同一物理空间全剧使用完全相同的名称
- 第二行固定为：出场角色：XXX、YYY（列出本场出现的角色）

【△行规则（动作行）】
- 所有肢体动作、走位、关键物件操作，必须以「△」开头独立成行
- △行禁止写：天气、光线、气味、氛围、陈设格调、街景等环境描写——环境信息必须从对白里透出来
- △行单条不超过 60 字，用大白话，一步一句写清「谁做了什么」
- △行总字数不超过该场景总字数的 14%；禁止用重复站位描写堆砌△
- 动作戏（打斗/追逐/撕扯）须极其简单，只用最常见词和短句，禁止复杂套招与华丽修辞

【分行铁律（强制）】
除场号行、「第N集」标题、出场角色行外，正文每一行只能是以下两种之一，无第三种：
1. 以「△」开头的可见动作/走位行
2. 「人名：台词」或「人名（情绪词）：台词」的对白行
禁止「人名+动作+：」混写在一行（如「冷姒伸手指着图：这是……」须拆成△行+人名：）
禁止无△开头的纯动作段落单独成行

【对白规则】
- 禁止同一角色连续两行对白，中间必须插入他人接话或短△
- 单行台词（冒号后正文）约 50 字（±10 字可接受），避免口水和同义反复
- 括号情绪词只能用以下词表中的一个词，无贴切词则不加括号：
  慌、惊讶、愁、委屈、冷、怒、喜、哭、笑、疑、紧张、轻松、坚定、绝望、讽刺
- 内心独白用「人名(OS)：台词」，画外音用「人名(VO)：台词」

【集末铁律】
每集最后一条有内容的正文行，必须是「人名：台词」或「人名（情绪词）：台词」对白行；
禁止以△行或(OS)行收尾；若有(OS)，其后必须再跟至少一句对口对白。

【示例格式】
第3集 玉佩之谜

3-1 许家别墅 内 日
出场角色：许彤、张妈
△ 许彤攥着玉佩坐在床上，张妈站在门边
许彤：（慌）张妈！你快过来看！
△ 张妈快步走到床边，两人面对面
张妈：（惊讶）小姐，怎么了？
△ 许彤把玉佩递向张妈
许彤：这是不是妈生前戴的那个？
张妈：对，这是夫人的玉佩，怎么会在你这儿？
许彤：（委屈）我也不知道，刚才醒来就攥着它。
△ 张妈退后半步，嘴唇发抖
张妈：（愁）老爷他……他出事了。
许彤：张妈，现在就带我去见爸，这事不能拖。`;

const SUMMARIZE_PROMPT = `请用3句话概括以下剧本集数，要求：
第1句：本集主要情节（发生了什么）
第2句：关键情绪转折（什么时候情绪发生了变化）
第3句：结尾状态（这集结束时各主要角色处于什么状态/位置）
只输出3句话，不要标题，不要序号。`;

const CHARACTER_BIOS_PROMPT = `你是一位短剧策划与人物小传作者。请根据提供的「故事圣经」，列出全部主要角色以及对主线、核心矛盾有推动作用的关键配角，不得人为限制人数。

【人数与覆盖（必须遵守）】
- 必须逐一覆盖故事圣经中出现的具名主要人物与核心反派、关键配角，不得遗漏
- 人数一般 4～8 人；题材人物少时不少于 3 人，人物极多可略超但须精炼，勿堆砌龙套

【禁止使用的格式（必须遵守）】
- 不要使用 Markdown：禁止 # / ## 标题、** 加粗、--- 横线、项目符号列表（-/*/•）
- 角色之间只空一行，下一位必须以「姓名：」开头
- 每行字段格式严格为「字段名：正文」，冒号必须是中文全角「：」；行首不要加 #、*、-

【篇幅】每位角色「背景故事」「主要事件」「人物关系」三字段正文合计 150～280 字（人数多取区间下限，人数少可接近上限）；「性格」字段 1-2 句即可，不计入上述字数

【内容要求】
- 背景故事：出身、成长经历、性格成因、与故事世界观相关的过往，让读者理解「这个人何以成为现在的人」
- 主要事件：结合故事圣经，写出该角色在剧中牵涉的关键情节、转折、抉择与目标（可含阶段性情节点，须可落地写戏）
- 人物关系：明确写出与其他主要角色（至少 2-3 人）的关联——对立/同盟/情感线/利益捆绑/师徒/亲情等，须点名对方是谁、关系如何演变或张力何在

【固定输出格式】每位角色均按以下顺序输出 7 行字段（长正文可在字段内换行，续行不得再以字段名起头）：

姓名：
年龄：
对标演员：（填写气质相符的知名演员，方便选角参考）
性格：
背景故事：
主要事件：
人物关系：

第 1 位写完后空一行，再写第 2 位，依此类推，直至全部主要角色写完。`;

app.post('/api/script-agent', authMiddleware, async (req, res) => {
  const { mode, history = [] } = req.body;

  let userContent = '';
  let systemContent = '';

  if (mode === 'story_bible') {
    const { genre = '都市', theme = '', episodes = 60, duration = '3', protagonist = '', style = '爽文', requirements = '' } = req.body;
    systemContent = STORY_BIBLE_PROMPT.replace(/\$\{TOTAL\}/g, episodes).replace(/\$\{'{TOTAL}'\}/g, episodes);
    userContent = `请为以下短剧创作完整的故事圣经：

类型：${genre}
风格：${style}
题材/主题：${theme || '根据类型自行设定'}
总集数：${episodes}集（每集约${parseInt(String(duration), 10) || 3}分钟）
主角设定：${protagonist || '根据题材自行设计，需有鲜明性格标签'}
特殊要求：${requirements || '无'}

请严格按照模板格式输出完整故事圣经。`;

  } else if (mode === 'character_bios') {
    const { storyBible = '' } = req.body;
    systemContent = CHARACTER_BIOS_PROMPT;
    userContent = `请根据以下故事圣经，生成全部主要角色的完整角色小传：

===故事圣经===
${storyBible}
===END===`;

  } else if (mode === 'episode_map') {
    const { storyBible = '', characterBios = '', episodes = 60 } = req.body;
    systemContent = EPISODE_MAP_PROMPT;
    const biosSection = characterBios
      ? `===角色小传（主要依据）===\n${characterBios}\n===END===\n\n`
      : '';
    userContent = `以角色小传为主要依据，结合故事圣经，为全${episodes}集创建集数大纲。每集一行，格式：第N集《集名》| 情节: ... | 钩子: ... | 结尾: ...

${biosSection}===故事圣经（世界观参考）===
${storyBible}
===END===

请输出第1集到第${episodes}集，共${episodes}行，不要遗漏任何一集。`;

  } else if (mode === 'write_episode') {
    const { storyBible = '', characterBios = '', episodeMapText = '', episodeIndex = 0, currentOutline = '', previousSummaries = [], duration = '3', totalEpisodes = 60 } = req.body;
    const durationNum = parseInt(String(duration), 10) || 3;
    const wordsPerEp = durationNum * 320;
    const epNum = episodeIndex + 1;
    systemContent = WRITE_EPISODE_PROMPT;
    const summarySection = previousSummaries.length > 0
      ? `\n===前情摘要===\n${previousSummaries.map((s, i) => `第${epNum - previousSummaries.length + i}集：${s}`).join('\n')}\n===END===\n`
      : '';
    const biosSection = characterBios
      ? `\n===角色小传（人设依据）===\n${characterBios.slice(0, 2000)}\n===END===\n`
      : '';
    userContent = `请创作第${epNum}集剧本（共${totalEpisodes}集），约${wordsPerEp}字。
${biosSection}
===故事圣经（摘要）===
${storyBible.slice(0, 1500)}
===END===

===本集大纲===
${currentOutline}
===END===
${summarySection}
===集数总表（供参考）===
${episodeMapText.slice(0, 1500)}
===END===

现在请创作第${epNum}集的完整剧本：`;

  } else if (mode === 'summarize_episode') {
    const { episodeContent = '', episodeIndex = 0 } = req.body;
    systemContent = SUMMARIZE_PROMPT;
    userContent = `第${episodeIndex + 1}集剧本：\n\n${episodeContent.slice(0, 3000)}`;

  } else {
    return res.status(400).json({ error: `未知 mode: ${mode}` });
  }

  const messages = [{ role: 'system', content: systemContent }, ...history, { role: 'user', content: userContent }];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const response = await axios.post(
      `${DS_CHAT_BASE}/chat/completions`,
      {
        model: mode === 'summarize_episode' ? 'qwen-turbo' : AGENT_MODEL,
        messages,
        stream: true,
        max_tokens: mode === 'write_episode'     ? 8192
                  : mode === 'story_bible'       ? 4096
                  : mode === 'episode_map'       ? 8192
                  : mode === 'character_bios'    ? 4096
                  : mode === 'summarize_episode' ? 512
                  : 8192,
      },
      { headers: { Authorization: `Bearer ${DASHSCOPE_KEY}`, 'Content-Type': 'application/json' }, responseType: 'stream', timeout: 300000 }
    );

    let buffer = '';
    response.data.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
        try {
          const parsed = JSON.parse(data);
          const text   = parsed.choices?.[0]?.delta?.content;
          if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
        } catch {}
      }
    });
    response.data.on('end',   () => { res.write('data: [DONE]\n\n'); res.end(); });
    response.data.on('error', err => { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── 剧本数据存储 ──────────────────────────────────────────────
app.get('/api/projects/:id/script', authMiddleware, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const fp = path.join(getUserProjectsDir(req.userId), `${req.params.id}_script.json`);
  if (!fs.existsSync(fp)) return res.json({ params: null, storyBible: '', episodeMap: [], episodes: [] });
  res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
});

app.put('/api/projects/:id/script', authMiddleware, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const fp = path.join(getUserProjectsDir(req.userId), `${req.params.id}_script.json`);
  fs.writeFileSync(fp, JSON.stringify({ ...req.body, updatedAt: new Date().toISOString() }));
  res.json({ ok: true });
});


// ── 健康检查 ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── 全局错误处理 ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '文件不能超过 20MB' });
  }
  if (err instanceof multer.MulterError || (err?.message && !err.status)) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ AIGC 后端运行在 http://localhost:${PORT}`);
  console.log(`   DashScope Key: ${DASHSCOPE_KEY ? DASHSCOPE_KEY.slice(0, 10) + '...' : '❌ 未设置！'}`);
  console.log(`   Storage driver: ${process.env.STORAGE_DRIVER || 'local'}`);
});
