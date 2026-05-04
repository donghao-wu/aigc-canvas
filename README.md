# 壹镜 · AIGC Canvas

漫剧制作团队的 AI 全流程内部工具。从剧本生成到视觉资产管理，覆盖短剧制作的核心环节。

---

## 产品定位

替代漫剧公司现有的碎片化工作流（豆包 Agent 剧本 → 手动编辑 → Liblib 生图 → 第三方视频平台），提供统一的内部 AIGC 平台。

**核心模块：**
- **剧本模块** — AI 六步 Pipeline 生成完整短剧剧本（支持 60 集以上），含故事圣经、角色小传、资产登记、集数大纲、逐集生成、自动摘要
- **资产库** — 角色/场景/道具资产库，支持 Character DNA、多视角提示词和单角度重生图
- **生图模块** — ReactFlow 画布，支持文生图、参考图生图、图片分析和视频生成
- **项目仪表盘** — 汇总项目、资产、图片、Token 和估算成本，显示流水线进度

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite + ReactFlow + TailwindCSS |
| 后端 | Node.js + Express |
| 数据库 | SQLite（better-sqlite3，WAL 模式） |
| AI 模型 | 阿里云 DashScope — Qwen-Max（剧本）/ Wanx 2.1（生图）/ WAN（视频）|
| 存储 | 本地文件系统 / 阿里云 OSS（可切换） |
| 认证 | JWT（30天有效期）|

---

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/donghao-wu/aigc-canvas.git
cd aigc-canvas
```

### 2. 安装依赖

```bash
# 后端
cd backend && npm install

# 前端
cd ../frontend && npm install
```

### 3. 配置环境变量

```bash
cd backend
cp .env.example .env
```

编辑 `.env`，填入必填项：

```env
# 必填：阿里云百炼平台 API Key
# 获取地址：https://bailian.console.aliyun.com/ → API Key 管理
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# JWT 签名密钥（生产环境用 openssl rand -base64 32 生成）
JWT_SECRET=your-jwt-secret-change-in-production

# 管理员操作密钥（用于创建用户的接口鉴权）
ADMIN_SECRET=your-admin-secret-change-in-production

# 存储驱动：local（开发）或 oss（生产）
STORAGE_DRIVER=local
```

OSS 配置（生产环境）：

```env
STORAGE_DRIVER=oss
OSS_REGION=oss-cn-beijing
OSS_BUCKET=your-bucket-name
OSS_ACCESS_KEY_ID=your-access-key-id
OSS_ACCESS_KEY_SECRET=your-access-key-secret
```

### 4. 创建第一个用户

```bash
# 后端运行中时执行
curl -X POST http://localhost:3001/api/admin/create-user \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: your-admin-secret-change-in-production" \
  -d '{"username":"admin","password":"your-password"}'
```

### 5. 启动

```bash
# 终端 1：后端
cd backend && npm start
# → 运行在 http://localhost:3001

# 终端 2：前端开发服务器
cd frontend && npm run dev
# → 运行在 http://localhost:5173
```

---

## 项目结构

```
aigc-canvas/
├── backend/
│   ├── index.js                 # Express 入口，核心路由
│   ├── db.js                    # SQLite 数据层（用户/项目/协作/统计/图片/资产）
│   ├── migrate.js               # JSON 项目数据 → SQLite 迁移脚本
│   ├── storage.js               # 存储抽象层（local/OSS 切换）
│   ├── routes/
│   │   ├── auth.js              # 登录 / 用户管理
│   │   ├── gallery.js           # 图片库
│   │   └── assets.js            # 视觉资产 CRUD
│   ├── projects/                # 旧版 JSON 项目数据（gitignore，仅迁移用）
│   ├── data/                    # SQLite 数据库（gitignore）
│   ├── generated/               # 本地生成图片（gitignore）
│   └── .env.example             # 环境变量模板
│
└── frontend/
    ├── src/
    │   ├── App.tsx              # 根组件，路由（home/剧本/生图/资产库）
    │   ├── LoginPage.tsx        # 登录页
    │   ├── ProjectHome.tsx      # 项目列表 + Dashboard + 全局资产库
    │   ├── ScriptWorkbench.tsx  # 剧本模块（六步 Pipeline）
    │   ├── AssetLibrary.tsx     # 项目资产库 + DNA + 多视角提示词
    │   ├── Gallery.tsx          # 图片库面板
    │   ├── ThemeContext.tsx     # 深色/浅色主题
    │   ├── nodes/               # ReactFlow 自定义节点
    │   │   ├── ImageGenNode.tsx
    │   │   ├── VideoGenNode.tsx
    │   │   ├── ImageNode.tsx
    │   │   ├── TextNode.tsx
    │   │   └── PromptAnalysisNode.tsx
    │   ├── lib/
    │   │   └── sse.ts           # SSE 流式请求工具
    │   └── types/
    │       └── asset.ts         # 共享类型定义
    └── public/
        └── logo.svg
```

---

## 核心功能

### 剧本模块（六步 Pipeline）

专为 60 集短剧设计的 AI 生成流程，解决一次性生成导致的人物前后矛盾和情节崩坏问题。

```
① 配置 → ② 故事圣经 → ③ 角色小传 → ④ 资产登记 → ⑤ 集数大纲 → ⑥ 逐集生成/摘要
  即时      qwen-max      qwen-max      qwen-max      qwen-max      qwen-max/qwen-turbo
```

**故事圣经（Story Bible）**
包含：剧名定位、世界观背景、人物图谱（主角/反派/配角完整弧线）、三幕结构规划、情感节奏设计。是后续所有集数的创作"宪法"。

**角色小传（Character Bios）**
基于故事圣经生成全部主要角色、关键配角和反派的小传，作为后续集数大纲与逐集剧本的人设依据。

**资产登记（Asset Registry）**
基于故事圣经与角色小传抽取角色、场景、道具资产，并生成多视角提示词。保存剧本数据时会同步入 `assets` 和 `asset_prompts`，进入项目资产库。

**集数大纲（Episode Map）**
每集一行，格式：`第N集《集名》| 情节: ... | 钩子: ... | 结尾: ...`
60 集全部规划后，每集生成时知道自己在整体弧线的哪个位置。

**逐集生成（Per-Episode Loop）**
- 每次只写一集，携带：故事圣经摘要 + 集数大纲 + 前 5 集摘要
- 摘要由 `qwen-turbo` 快速生成（成本低），正文用 `qwen-max`
- 支持暂停 / 恢复，每 5 集自动保存
- 每集可手动编辑

---

### 资产库

- **项目资产** — 从剧本工作台的资产登记册自动同步角色、场景、道具
- **Character DNA** — 每个资产可维护一段固定特征描述，用于跨图保持一致性
- **多视角提示词** — 支持正面、侧面、背面、特写、全景、中景等角度提示词
- **单角度重生图** — 资产详情中可对封面或任意角度单独调用 `/api/generate-image`
- **权限隔离** — 项目资产按 `project_members` 检查读写权限，全局资产库仍使用 `projectId='__global__'`

---

### 生图模块（ReactFlow 画布）

- **文生图** — Wanx 2.1（Turbo/标准/Pro 三档），支持多种比例
- **图生视频** — WAN 2.1（风景/人物），异步轮询
- **图片上传** — 拖拽上传到画布
- **提示词分析** — 逆向拆解图片风格（调用视觉模型）
- **画布自动保存** — 2 秒防抖，自动同步到服务器
- **图片库** — 所有生成/上传图片统一管理

---

## API 接口

### 认证

```
POST /api/auth/login          # 登录，返回 JWT token
```

所有接口需携带 Header：`Authorization: Bearer <token>`

### 用户管理（需 x-admin-secret）

```
POST /api/admin/create-user   # 创建用户
GET  /api/admin/users         # 用户列表
```

### 项目

```
GET    /api/projects          # 项目列表
POST   /api/projects          # 创建项目
GET    /api/projects/:id      # 获取项目（画布节点/边）
PUT    /api/projects/:id      # 保存画布
DELETE /api/projects/:id      # 删除项目
GET    /api/projects/:id/script  # 获取剧本数据
PUT    /api/projects/:id/script  # 保存剧本数据
GET    /api/projects/:id/status  # 项目协作状态
GET    /api/projects/:id/stats   # 项目统计
GET    /api/projects/:id/events  # 项目事件日志
GET    /api/dashboard            # 首页 Dashboard 汇总
```

### AI 生成

```
POST /api/generate-image      # 文生图（Wanx）
POST /api/generate-video      # 文生视频（WAN）
GET  /api/video-status        # 视频任务状态轮询
GET  /api/video-proxy/:taskId # 视频流代理
POST /api/analyze-image       # 图片影像分析（Qwen-VL）
POST /api/script-agent        # 剧本 Agent（SSE 流式）
```

**script-agent mode 参数：**

| mode | 说明 | 模型 |
|------|------|------|
| `story_bible` | 生成故事圣经 | qwen-max |
| `character_bios` | 生成角色小传 | qwen-max |
| `asset_registry` | 生成资产登记册 | qwen-max |
| `episode_map` | 生成集数大纲 | qwen-max |
| `write_episode` | 生成单集剧本 | qwen-max |
| `summarize_episode` | 生成集数摘要 | qwen-turbo |

### 资产

```
GET    /api/assets?projectId=xxx   # 资产列表（projectId='__global__' 为全局库）
POST   /api/assets                 # 创建资产
PATCH  /api/assets/:id/image       # 更新资产图片
PATCH  /api/assets/:id/dna         # 更新资产 DNA/结构化字段
GET    /api/assets/:id/prompts     # 多视角提示词列表
POST   /api/assets/:id/prompts     # 新增多视角提示词
PATCH  /api/assets/:id/prompts/:promptId/image  # 更新某角度图片
DELETE /api/assets/:id/prompts/:promptId         # 删除某角度提示词
DELETE /api/assets/:id             # 删除资产
```

### 图片库

```
GET    /api/gallery               # 图片列表
DELETE /api/gallery/:id           # 删除图片
POST   /api/upload                # 上传图片
```

---

## 数据库设计

```sql
-- 用户表
users (id, username, passwordHash, isAdmin, createdAt)

-- 生成图片记录
images (id, filename, mimeType, prompt, model, refCount, imageUrl, createdAt)

-- 视觉资产
assets (
  id, projectId, userId,
  type CHECK(type IN ('CHARACTER','SCENE','PROP')),
  name, description, prompt, dna, fields, styleConfig,
  imageUrl, savedId,
  tags TEXT DEFAULT '[]',
  usedInProjects TEXT DEFAULT '[]',
  createdAt
)

-- 项目与协作
projects (id, name, ownerId, data, pipelineStage, styleConfig, createdAt, updatedAt, updatedBy)
project_members (projectId, userId, role, joinedAt)
project_stats (projectId, agentCallCount, imageGenCount, tokenUsed, estimatedCost, stagesCompleted, updatedAt)
events (id, projectId, userId, type, meta, createdAt)
asset_prompts (id, assetId, label, prompt, imageUrl, generatedAt)
```

全局资产库：`projectId = '__global__'`

---

## 环境变量完整说明

| 变量 | 必填 | 说明 |
|------|------|------|
| `DASHSCOPE_API_KEY` | ✅ | 阿里云百炼 API Key，用于所有 AI 功能 |
| `JWT_SECRET` | ✅ | JWT 签名密钥，建议 32 位随机字符串 |
| `ADMIN_SECRET` | ✅ | 管理员接口鉴权密钥 |
| `STORAGE_DRIVER` | — | `local`（默认）或 `oss` |
| `OSS_REGION` | OSS 时必填 | 如 `oss-cn-beijing` |
| `OSS_BUCKET` | OSS 时必填 | OSS Bucket 名称 |
| `OSS_ACCESS_KEY_ID` | OSS 时必填 | OSS Access Key ID |
| `OSS_ACCESS_KEY_SECRET` | OSS 时必填 | OSS Access Key Secret |
| `OSS_BASE_URL` | — | 自定义 CDN 域名 |
| `PORT` | — | 服务端口，默认 3001 |
| `DB_PATH` | — | SQLite 路径，默认 `backend/data/aigc.db` |
| `ALLOWED_ORIGINS` | — | 生产环境允许的前端域名（逗号分隔）|

---

## 生产部署

### 前端构建

```bash
cd frontend
npm run build
# 产物在 frontend/dist/，可直接由 Nginx 或后端 static 服务
```

### 后端服务化（systemd）

```ini
[Unit]
Description=AIGC Canvas Backend
After=network.target

[Service]
WorkingDirectory=/path/to/aigc-canvas/backend
ExecStart=/usr/bin/node index.js
Restart=always
EnvironmentFile=/path/to/aigc-canvas/backend/.env

[Install]
WantedBy=multi-user.target
```

### Nginx 配置参考

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    root /path/to/aigc-canvas/frontend/dist;
    index index.html;

    # SPA 路由
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        # SSE 必须关闭缓冲
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    # 生成的图片
    location /generated/ {
        alias /path/to/aigc-canvas/backend/generated/;
    }
}
```

> **注意：** SSE 流式响应必须配置 `proxy_buffering off`，否则剧本生成会卡住。

---

## 上线前安全检查清单

**每次发布前必须执行，不得跳过。**

### 1. 密钥泄漏扫描

```bash
# 扫描代码中的硬编码密钥（排除正常变量引用）
grep -rn "sk-\|api_key\|secret\|password" \
  --include="*.js" --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  --exclude="package-lock.json" \
  | grep -v "process\.env\|localStorage\|\.example\|changeme\|your-\|bcrypt\|hash\|Bearer"
```

预期：只出现正常的变量引用，无真实密钥值。

### 2. .env 未入 git

```bash
git ls-files | grep "\.env$"
```

预期：**无输出**。如有输出立即执行：
```bash
git rm --cached backend/.env && echo "backend/.env" >> .gitignore
```

同时确认本地数据库未入 git：

```bash
git ls-files | grep -E "backend/(data/|.*\.db|.*\.db-wal|.*\.db-shm)"
```

预期：**无输出**。SQLite 数据库包含用户、项目、资产和图片记录，不得提交。

### 3. git 历史中无密钥

```bash
git log --all --full-history -- "**/.env" ".env" "backend/.env"
```

预期：**无输出**。如历史中曾提交过需使用 `git filter-repo` 清除并强制推送。

### 4. 所有 API 路由有认证

```bash
# 检查无 authMiddleware 的路由（/health 和 /api/auth/* 例外）
grep -n "app\.\(get\|post\|put\|delete\)" backend/index.js | grep -v "authMiddleware\|health\|/api/auth\|/api/admin"
```

预期：只有 `/health`（健康检查）不需要认证，其余均需有 `authMiddleware`。

### 5. 前端 build 无密钥

```bash
cd frontend && npm run build
grep -r "sk-\|DASHSCOPE\|JWT_SECRET\|ADMIN_SECRET" dist/
```

预期：**无输出**。所有密钥应只在后端 `.env` 中，前端绝不接触。

### 6. 管理接口鉴权

```bash
# 测试未带 admin secret 时是否拒绝
curl -s -X GET http://localhost:3001/api/admin/users | python3 -m json.tool
```

预期：返回 `{"error": "无权限"}`。

### 7. CORS 生产配置

确认 `.env` 中已设置 `ALLOWED_ORIGINS`，格式：
```
ALLOWED_ORIGINS=https://your-domain.com,https://www.your-domain.com
```

未设置时仅允许 `localhost:5173`（开发环境），生产环境**必须**显式配置。

---

### 已知安全设计

| 机制 | 实现 |
|------|------|
| 密码存储 | bcrypt（salt rounds=10）|
| JWT | 30天有效期，`Authorization: Bearer` 头 |
| SQL 注入 | better-sqlite3 参数化查询，无字符串拼接 |
| 路径穿越 | `validateId()` 白名单正则 + `path.startsWith()` 双重校验 |
| 文件类型 | multer MIME 白名单（jpeg/png/webp/gif）|
| 用户隔离 | 项目通过 `project_members` 控制 owner/editor/viewer 权限，`userId` 来自 JWT 解码 |
| Body 大小 | 限制 10mb，防超大 payload 打爆内存 |
| 密钥日志 | 启动日志仅打印 key 前缀（`sk-xxxxxxx...`）|

---

## 开发规范

### 每次改动后必须

1. 更新 `README.md` 中对应的功能描述/API 文档
2. 执行上方安全检查清单（至少 1、2、4、5 项）
3. 提交并推送：`git add . && git commit -m "feat/fix: ..." && git push`

### Commit 格式

```
feat: 新功能
fix: 问题修复
refactor: 重构
docs: 文档更新
chore: 依赖/配置更新
```

### 新增 API 路由

后端路由统一在 `backend/routes/` 目录下按模块拆分，在 `index.js` 中 mount。认证路由加 `authMiddleware`。

### 前端新增模块

1. 在 `frontend/src/` 下创建组件文件
2. 在 `App.tsx` 中注册路由/标签页
3. 共享类型放 `frontend/src/types/`，共享工具放 `frontend/src/lib/`

---

## Changelog

### v0.5.0（当前）— 2026-05-04
- **DB-first 项目模型**：项目画布、剧本、协作成员、统计、事件统一进入 SQLite；旧 JSON 数据可通过 `backend/migrate.js` 迁移
- **项目 Dashboard**：新增 `/api/dashboard`，首页显示项目、资产、图片、Token、估算成本和流水线进度
- **资产库闭环**：资产登记册保存后自动同步到资产库；资产支持 DNA、多视角提示词和单角度重生图
- **权限加固**：项目资产读取/编辑按 `project_members` 检查，防止只凭 projectId 读取他人项目资产
- **泄漏防护**：`.gitignore` 新增 `backend/*.db`、`*.db-shm`、`*.db-wal`，避免根目录 SQLite 数据误提交

### v0.4.2 — 2026-05-01
- **死代码清理**：删除 `PipelinePage.tsx`（745 行，已下线模块）；后端移除 7 个失效 mode 处理器（`generate`/`review`/`extract_assets`/`analyze`/`outline`/`prompts`/`chat`）、`/api/asset-agent` 路由、`/api/pipeline/save-manifest` 路由及相关常量（`STYLE_PREFIXES`/`buildAssetSystemPrompt`/`AGENT_MODEL_FAST`/`AGENT_PROMPT`/`PIPELINE_OUTPUT_DIR`）
- **script-agent 精简**：后端仅保留 4 个活跃 mode（`story_bible`/`episode_map`/`write_episode`/`summarize_episode`），未知 mode 返回 400
- **README 同步**：API 文档、项目结构、Changelog 均已更新

### v0.4.1 — 2026-04-28
- **安全加固**：body limit 从 50mb 降至 10mb；`/api/models` 加 authMiddleware
- **README**：新增完整安全检查清单（上线前必须执行的 7 项检查）

### v0.4.0 — 2026-04-28
- **剧本模块重构**：四步 Pipeline（故事圣经 → 集数大纲 → 逐集生成 → AI审稿），支持 60 集以上
- **数据层**：SQLite 替换 JSON 文件存储（WAL 模式，并发安全）
- **存储抽象**：local/OSS 可切换，`STORAGE_DRIVER` 环境变量控制
- **路由拆分**：`routes/auth.js`、`routes/gallery.js`、`routes/assets.js`
- **模块导航**：去掉 Pipeline 演示页，剧本为默认入口，两模块切换（剧本/生图）
- **全局资产库**：跨项目资产共享，`projectId='__global__'`
- **AI 升级**：剧本 Agent 换用 qwen-max，集数摘要用 qwen-turbo
- **ErrorBoundary**：所有标签页崩溃隔离，白屏改为错误信息展示

### v0.3.0
- 剧本工作台（ScriptWorkbench）：剧本分析 + 分镜大纲 + 提示词生成
- 资产 Agent：角色/场景/道具提示词自动生成
- Pipeline 演示页（现已移除）

### v0.2.0
- ReactFlow 画布：生图节点、视频节点、文本节点、提示词分析节点
- 图片库、画布自动保存

### v0.1.0
- 项目初始化，JWT 认证，基础 AIGC 接口接入
