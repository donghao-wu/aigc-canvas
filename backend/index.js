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
app.use(express.json({ limit: '50mb' }));

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
app.get('/api/models', (req, res) => {
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
// generate/review/extract_assets 用最强模型；outline/prompts 等旧模式保持 plus
const AGENT_MODEL        = 'qwen-max';   // 剧本创作主力
const AGENT_MODEL_FAST   = 'qwen-plus';  // 旧模式兼容
const AGENT_PROMPT = fs.readFileSync(path.join(__dirname, 'script-agent-prompt.txt'), 'utf8');

// ── 新模式独立 system prompt ──────────────────────────────────
// ── Pipeline 模式 Prompts ──────────────────────────────────────
const STORY_BIBLE_PROMPT = `你是专业的短剧故事架构师，负责创作"故事圣经"（Story Bible）。
故事圣经是整部剧的创作宪法，所有集数的编写都必须严格遵守这份文档。

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

const EPISODE_MAP_PROMPT = `你是专业的短剧集数策划师。基于提供的故事圣经，为全集创建详细的集数大纲。

每集用一行输出，格式严格如下（不要多行，不要额外说明）：
第N集《集名》| 情节: [2句话说清楚这集发生什么] | 钩子: [开场如何抓住观众] | 结尾: [留什么悬念或爽点]

要求：
- 集名要有吸引力（2-6字）
- 情节要有起伏，不能平铺直叙
- 每5-8集要有一个大转折点
- 钩子每集都要不同，不能重复套路
- 结尾的悬念/爽点要让观众无法停下来`;

const WRITE_EPISODE_PROMPT = `你是专业的短剧剧本作家。基于故事圣经和集数大纲，创作指定集数的完整剧本。

严格规范：
- 人物性格、背景、口头禅必须与故事圣经完全一致
- 本集情节必须与大纲中的情节描述吻合
- 开场10秒必须有强钩子（与大纲"钩子"字段一致）
- 结尾必须体现大纲"结尾"字段描述的悬念或爽点
- 对白口语化，短句为主，禁止说教式台词
- 每个场景都要可视化，能直接指导拍摄

输出格式：
第X集《集名》

【场景1：地点 · 时间】
（简洁的环境描写，2-3行）
角色名：「台词」
（动作/反应描写）
角色名：「台词」
...

【场景2：地点 · 时间】
...`;

const SUMMARIZE_PROMPT = `请用3句话概括以下剧本集数，要求：
第1句：本集主要情节（发生了什么）
第2句：关键情绪转折（什么时候情绪发生了变化）
第3句：结尾状态（这集结束时各主要角色处于什么状态/位置）
只输出3句话，不要标题，不要序号。`;

const GENERATE_PROMPT = `你是专业的短剧剧本创作者，深谙抖音、快手平台的爆款短剧规律。

## 核心创作原则
- **钩子第一**：每集第一个场景必须有强冲突、反转或悬念，不允许平铺直叙开场
- **节奏铁律**：开场钩子(0-15秒) → 情境建立(15-40秒) → 冲突推进 → 情绪爆发 → 结尾悬念/爽点
- **对白口语化**：台词要短、狠、有个性；单次对话不超过3个来回；多用动作打断节奏
- **每集必须有爽点**：情绪释放、逆袭、反转、狗血——让观众不吐不快地刷下一集
- **结尾必留钩子**：不能有"圆满结局"，每集结尾都要让观众产生"接下来怎样"的强烈欲望

## 输出格式（严格遵守）
---
**《剧名》**
类型 | 风格 | 集数

**人物表**
- 角色名（身份）：一句话性格标签

---
**第X集：集名**
【场景：地点 · 时间】
（动作/环境描写，简洁有力）
人物名：「台词」
（动作/反应描写）
...

---

用中文创作，场景描述控制在3-5行，不要写成小说，要可以直接拍摄。`;

const REVIEW_PROMPT = `你是资深短剧制片人兼剧本编辑，在抖音/快手平台有丰富的爆款操盘经验。你的审稿风格：直接、具体、可操作，不说废话。

## 审稿六维度

1. **钩子强度**（满分20分）：第一集第一个场景能否让陌生观众停下滑动？
2. **节奏密度**（满分20分）：每集冲突频率、情绪起伏、悬念密度是否达标？
3. **人物张力**（满分15分）：主角有没有让人爱/恨/心疼的理由？反派够不够坏？
4. **对白质量**（满分15分）：台词口不口语？有没有"台词病"（说教/解释性台词）？
5. **爽点设计**（满分20分）：每集有没有"啊！"的情绪释放瞬间？
6. **商业评估**（满分10分）：题材赛道、受众清晰度、投流潜力

## 输出格式（严格遵守）

## 综合评分：X/100

## 一句话判断
[这本剧本能不能投？为什么？]

## 亮点（引用原文）
- 「原文片段」→ 好在哪里

## 问题清单
| 问题 | 严重程度 | 影响 |
|------|----------|------|
| 问题描述 | 🔴高/🟡中/🟢低 | 具体影响 |

## 修改建议（附示例）
### 问题1：[问题名]
**原文：** 「...」
**建议改为：** 「...」
**理由：** ...

## 优先行动
1. [最重要的修改，一句话说清楚]
2. [第二重要的修改]`;

const EXTRACT_ASSETS_PROMPT = `你是影视制片的视觉资产总监，任务是从剧本中提取完整的视觉资产表，供AI生图工具直接使用。

## 提取标准

**角色（CHARACTER）**
- 所有有名字、有台词或有特写的人物
- 外貌描述必须足够具体，能让AI生成一致的参考图：年龄范围、性别、发型发色、面部特征、体型、标志性服装和配饰

**场景（SCENE）**
- 所有出现的独立地点（即使是同一建筑的不同区域也分开）
- 描述要可视化：时间段（白天/夜晚/黄昏）、光线、主要视觉元素、空间感

**道具（PROP）**
- 只提取对剧情有作用的道具（推动情节、有特写、或对人物有象征意义的）
- 忽略普通背景道具

## 输出要求

只输出JSON，不要任何前言、解释或markdown代码块。格式：
{"characters":[{"name":"角色名","role":"主角/配角/反派/路人","bio":"人物小传：身份、性格、核心动机（2-4句话）","appearance":"外貌：年龄、性别、发型、发色、面部特征、体型、服装颜色款式、配饰（要详细到可以直接用于生图提示词）"}],"scenes":[{"name":"场景名","description":"详细的视觉描述：地点、时间段、光线、主要视觉元素","atmosphere":"情绪基调，如：冷酷都市/温暖居家/压抑阴暗/繁华商业"}],"props":[{"name":"道具名","description":"外观描述：形状、颜色、材质、尺寸，以及在剧中的作用"}]}`;

app.post('/api/script-agent', authMiddleware, async (req, res) => {
  const { mode, script = '', shots = [], history = [] } = req.body;

  let userContent = '';
  let systemContent = AGENT_PROMPT;

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

  } else if (mode === 'episode_map') {
    const { storyBible = '', episodes = 60 } = req.body;
    systemContent = EPISODE_MAP_PROMPT;
    userContent = `基于以下故事圣经，为全${episodes}集创建集数大纲。每集一行，格式：第N集《集名》| 情节: ... | 钩子: ... | 结尾: ...

===故事圣经===
${storyBible}
===END===

请输出第1集到第${episodes}集，共${episodes}行，不要遗漏任何一集。`;

  } else if (mode === 'write_episode') {
    const { storyBible = '', episodeMapText = '', episodeIndex = 0, currentOutline = '', previousSummaries = [], duration = '3', totalEpisodes = 60 } = req.body;
    const durationNum = parseInt(String(duration), 10) || 3;
    const wordsPerEp = durationNum * 320;
    const epNum = episodeIndex + 1;
    systemContent = WRITE_EPISODE_PROMPT;
    const summarySection = previousSummaries.length > 0
      ? `\n===前情摘要===\n${previousSummaries.map((s, i) => `第${epNum - previousSummaries.length + i}集：${s}`).join('\n')}\n===END===\n`
      : '';
    userContent = `请创作第${epNum}集剧本（共${totalEpisodes}集），约${wordsPerEp}字。

===故事圣经（摘要）===
${storyBible.slice(0, 2000)}
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

  } else if (mode === 'generate') {
    const { genre = '都市', theme = '', episodes = 10, duration = '3', protagonist = '', style = '爽文', requirements = '' } = req.body;
    const durationNum = parseInt(String(duration), 10) || 3;
    // 每分钟约300-350字对白+场景描述
    const wordsPerEp = durationNum * 320;
    systemContent = GENERATE_PROMPT;
    userContent = `请创作一部完整的短剧剧本，要求如下：

类型：${genre}
题材/主题：${theme || '根据类型自行设定'}
集数：${episodes}集
每集时长：约${durationNum}分钟（每集约${wordsPerEp}字）
主角设定：${protagonist || '根据题材自行设计，要有鲜明性格标签'}
风格：${style}
特殊要求：${requirements || '无'}

请从第1集开始，严格按格式完整输出所有${episodes}集剧本。每集开头必须有强钩子，结尾必须留悬念。`;

  } else if (mode === 'review') {
    systemContent = REVIEW_PROMPT;
    userContent = `请对以下短剧剧本进行专业审稿：\n\n${script}`;

  } else if (mode === 'extract_assets') {
    systemContent = EXTRACT_ASSETS_PROMPT;
    userContent = `请从以下剧本中提取完整的视觉资产表，严格按JSON格式输出：\n\n${script}`;

  } else if (mode === 'analyze') {
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

镜头编号全剧连续，输出完整大纲后等待我确认，不要提前生成提示词。

剧本内容：
${script}`;
  } else if (mode === 'prompts') {
    const shotLines = shots.map(s => s.isGroup ? `\n场景：${s.header}` : s.header + (s.details ? '\n' + s.details : '')).join('\n');
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
    userContent = req.body.message || '';
    systemContent = AGENT_PROMPT + '\n\n## 对话模式限制\n在对话中不要直接输出完整的分镜大纲或 Seedance 提示词内容。当用户确认修改完成、希望生成大纲或提示词时，请明确告知：「请点击左侧「生成分镜大纲」按钮，在对话框中继续将无法生成可复制的卡片版本。」';
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
        model: mode === 'summarize_episode' ? 'qwen-turbo'
             : ['generate', 'review', 'extract_assets', 'story_bible', 'episode_map', 'write_episode'].includes(mode) ? AGENT_MODEL
             : AGENT_MODEL_FAST,
        messages,
        stream: true,
        max_tokens: mode === 'write_episode'     ? 8192
                  : mode === 'story_bible'       ? 4096
                  : mode === 'episode_map'       ? 8192
                  : mode === 'generate'          ? 16000
                  : mode === 'summarize_episode' ? 512
                  : mode === 'extract_assets'    ? 4096
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
- 不同地点的同类场景视为不同资产
- 不同外貌的同类人物视为不同角色

### CHARACTER 提示词规则
- 必须是：纯白色背景，单人全身三视图（正面、侧面、背面并排）
- 固定结构：${stylePrefix}, character design sheet, full body three-view reference (front view, side view, back view), pure white background, [详细外观描述], no background, no scene, no props, no other characters, model sheet style

### SCENE 提示词规则
- 必须是：空镜，场景内无任何人物
- 固定结构：${stylePrefix}, wide establishing shot, empty scene, no people, no characters, [详细场景环境描述], [光线与氛围], cinematic composition

### PROP 提示词规则
- 固定结构：${stylePrefix}, product shot, close-up, pure white background, [道具详细描述], no background, no people

## 输出格式（严格遵守）
所有 CHARACTER 先输出，再输出所有 SCENE，最后输出所有 PROP。

===ASSET_START===
TYPE: CHARACTER
NAME: 人物中文名称
DESC: 外观描述（中文，25字以内）
PROMPT: ${stylePrefix}, character design sheet, full body three-view reference (front view, side view, back view), pure white background, [英文外观描述], no background, no scene, no props, model sheet style
===ASSET_END===`;
}

app.post('/api/asset-agent', authMiddleware, async (req, res) => {
  const { promptTexts = [], mode = 'simple', style = '3D', customStyle = '', script = '' } = req.body;
  const stylePrefix  = style === 'custom' ? (customStyle || '3D CGI render') : (STYLE_PREFIXES[style] || STYLE_PREFIXES['3D']);
  const systemPrompt = buildAssetSystemPrompt(mode, stylePrefix);
  const scriptSection = script.trim() ? `## 原始剧本（用于第一步角色形象分析）\n${script.trim()}\n\n` : '';
  const userContent   = `${scriptSection}## 分镜 Seedance 提示词（用于资产提取）\n\n${promptTexts.map((p, i) => `【镜头 ${i + 1}】\n${p}`).join('\n\n---\n\n')}`;
  const messages      = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const response = await axios.post(
      `${DS_CHAT_BASE}/chat/completions`,
      { model: AGENT_MODEL, messages, stream: true, max_tokens: 4096 },
      { headers: { Authorization: `Bearer ${DASHSCOPE_KEY}`, 'Content-Type': 'application/json' }, responseType: 'stream', timeout: 120000 }
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

// ── Pipeline 素材归档 ─────────────────────────────────────────
const PIPELINE_OUTPUT_DIR = path.join(__dirname, 'pipeline-output');
if (!fs.existsSync(PIPELINE_OUTPUT_DIR)) fs.mkdirSync(PIPELINE_OUTPUT_DIR, { recursive: true });

app.post('/api/pipeline/save-manifest', authMiddleware, async (req, res) => {
  try {
    const { projectName = 'untitled', shots = [], assets = [], videos = [] } = req.body;
    const safeName   = String(projectName).replace(/[^a-zA-Z0-9_一-鿿-]/g, '_').slice(0, 40);
    const folderName = `${Date.now()}-${safeName}`;
    const outDir     = path.join(PIPELINE_OUTPUT_DIR, folderName);
    fs.mkdirSync(outDir, { recursive: true });

    const assetsWithFiles = assets.map(a => {
      let file = null;
      if (a.savedId) {
        const img = db.findImage(a.savedId);
        if (img) {
          const src  = path.join(GENERATED_DIR, img.filename);
          const dest = path.join(outDir, img.filename);
          if (fs.existsSync(src)) { fs.copyFileSync(src, dest); file = img.filename; }
        }
      }
      return { type: a.type, name: a.name, prompt: a.prompt, file };
    });

    const manifest = {
      projectName,
      createdAt:  new Date().toISOString(),
      totalShots: shots.length,
      shots,
      assets:  assetsWithFiles,
      videos:  videos.map(v => ({ shotId: v.shotId, prompt: v.prompt, taskId: v.taskId || null, status: v.status, videoUrl: v.videoUrl || null })),
    };

    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`[Pipeline] 归档完成: ${folderName}`);
    res.json({ ok: true, folder: folderName, path: `pipeline-output/${folderName}/manifest.json` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
