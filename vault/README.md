# 壹镜 Agent 设计室

> 这个 vault 是壹镜 AIGC Canvas 的 **agent 设计台与提示词库**。
> 代码在 `../backend/`，这里负责设计、迭代、记录。

## 快速导航

| 区域 | 说明 |
|------|------|
| [[Agents/00-架构总览]] | Agent 整体架构与数据流 |
| [[Agents/01-故事圣经]] | STORY_BIBLE_PROMPT · 当前生产版本 |
| [[Agents/02-角色小传]] | CHARACTER_BIOS_PROMPT |
| [[Agents/03-资产登记]] | ASSET_REGISTRY_PROMPT · 多提示词版 |
| [[Agents/04-集数大纲]] | EPISODE_MAP_PROMPT |
| [[Agents/05-逐集剧本]] | WRITE_EPISODE_PROMPT |
| [[Agents/06-集数摘要]] | SUMMARIZE_PROMPT |
| [[Styles/00-画风总览]] | 所有画风 style token 一览 |
| [[Research/NanoBanana生图技巧]] | 漫剧生图最佳实践 |
| [[Design/Agent扩展规划]] | 下一步要做的 agent |
| [[Design/资产库闭环修复]] | 资产登记册 → 资产库同步与权限修复 |

## 同步规则

- **Obsidian → 代码**：在这里迭代 prompt → 测试满意后手动更新 `backend/index.js`
- **代码 → Obsidian**：改了代码里的 prompt → 同步更新这里并注明版本
- prompt 版本号格式：`v主.次`，每次上生产 +1

## 当前模型配置

| 用途 | 模型 | max_tokens |
|------|------|-----------|
| 剧本创作（主力）| qwen-max | 4096–8192 |
| 集数摘要 | qwen-turbo | 512 |

## Changelog

### 2026-05-11 — 分镜生成 + Seedance 2.0 + @资产引用

**剧本 → 分镜 → 画布 完整链路**
- 每集剧本下新增"📽 分镜"子标签页（剧本/分镜双 tab 切换）
- `STORYBOARD_PROMPT`：AI 从剧本选取 3–5 个戏剧高峰，生成约 15 秒分镜方案
- 分镜提示词使用 `@资产名` 引用（如 `@林晓月 nervously checks her phone`）
- 发送到画布时系统自动替换 `@资产名` → 资产 DNA 描述（调用 `/api/assets` 解析）
- 每集独立生成，互不干扰；生成结果持久化到 `project.data.storyboardByEpisode`
- "→ 画布"（单个镜头）和"全部发送到画布"（批量横向排列）
- 画布 VideoGenNode 新增 `initialPrompt` 支持，接收分镜发来的预填充提示词

**Seedance 2.0 占位**
- VideoGenNode 新增 Seedance 2.0 横屏/竖屏模型选项（disabled 状态，接入中）
- 后端 `SEEDANCE_CONFIG` 预定义模型参数，收到 API key 后只需解开占位即可
- `/api/generate-video` 对 seedance_* 模型返回友好 503 提示

**Vault 同步**
- 见 [[Agents/07-分镜生成]]（新建）

### 2026-05-11 — Token Tracking 根本原因修复（QA 发现）

**Token tracking 第二层修复**
- QA 验证时发现 `agentCallCount` 和 `tokenUsed` 仍全为 0
- 根本原因：DashScope OpenAI 兼容接口需要在请求体中显式传 `stream_options: { include_usage: true }` 才会在 SSE 流末尾返回 token 用量，否则 `usage` 字段永远不出现
- 修复：在 `/api/script-agent` 的 DashScope 请求中加入该字段
- 已验证：`summarize_episode` 调用后 `tokenUsed: 158`、`agentCallCount: 1`，写入正确

### 2026-05-06 — Token Tracking 修复 + 成员管理 UI + 动态下一步面板

**Token tracking（自上线起一直失效）**
- `ScriptWorkbench` 的 6 个 `streamSSE` 调用全部补入 `projectId`
- 现在每次 Agent 调用结束后都会正确写入 `project_stats` 和 `events` 表

**成员管理 UI（API 早已完整，但一直没有前端入口）**
- `StudioHeader` 新增 `projectId` prop + 成员下拉面板
  - 展示所有成员 + 角色标签（所有者 / 编辑 / 只读）
  - 按用户名邀请，默认 editor 权限
  - 非所有者成员可一键移除（X 按钮）
  - 打开面板时自动拉取最新列表，点外部自动关闭
- `ScriptWorkbench`、`AssetLibrary`、画布 `StudioHeader` 全部传入 `projectId`

**"下一步" 面板动态化（原来 3 项全是写死的 ✓）**
- 改为读取最近更新项目的 `stagesCompleted` + `imageGenCount`
- 已完成步骤显示绿色 ✓，待完成显示琥珀色 →，点击直接跳转到对应项目

### 2026-05-04 — 安全加固 + 死代码清理（50 人生产准备审计）

**安全**
- 登录接口加 rate-limit：同一 IP 每分钟最多 10 次失败尝试（`express-rate-limit`）
- `/generated/` 和 `/uploads/` 从无鉴权静态文件改为鉴权动态路由，支持 Bearer header 或 `?token=` 查询参数
- 前端新增 `lib/imageUrl.ts` → `authImageUrl()`，所有渲染本地图片的 `<img>` 统一追加 token

**死代码清理**
- 删除 `test_ref.js`（遗留调试脚本）
- 移除 `backend/index.js` 中无用的 `bcrypt` require 和 `PROJECTS_ROOT` 目录创建
- `VideoGenNode` 模型列表改为只展示后端实际支持的 WAN 2.1 三种模式，删除 Sora/Veo 假选项

**遗留待做（未本次实现）**
- Per-user API 配额控制（每日 token 上限 + 429 熔断）
- Dashboard 全局统计改为仅展示当前用户聚合数据

### 2026-05-04 — UI 第二阶段：项目内工作区 Chrome

- `ProjectHome.tsx` 左侧 5 个模块补齐真实内容切换：生产总览、项目队列、剧本流水线、视觉资产、视频交付
- 视频交付模块先显示交付队列候选和能力接入状态，避免误以为成片交付链路已经完整上线
- 新增 `StudioHeader.tsx`，统一剧本、生图画布、资产库三页的项目名、模块切换、状态提示和主题切换
- 画布页使用浮动工作区栏，避免压缩 ReactFlow 操作空间
- 剧本页和资产库改为固定 Studio 顶栏，资产库同时调整背景、搜索筛选和网格密度
- 后端移除 `changeme-*` 开发默认密钥，避免误把弱密钥带入长期环境
- 本阶段仍不重写业务流程，只先消除“首页新、项目内旧”的视觉断裂

### 2026-05-04 — UI 第一阶段：项目中控台

- `ProjectHome.tsx` 从居中项目列表改为生产中控台布局
- 新增左侧导航、Production Command 顶部区、5 项统计卡、项目队列、生产流、全局资产速览
- 视觉方向对齐前期 mock：影棚中控台 / AI 流水线驾驶舱，信息密度更高，卡片边角控制在 8-12px
- 功能保持：新建/重命名/删除项目、资产预览、复制 Prompt、加入全局库

### 2026-05-04 — 资产库闭环修复

- 修复后端项目路由 `dbModule` 引用断点，Dashboard 返回字段与前端对齐
- 资产登记册保存后自动解析并同步到 `assets` / `asset_prompts`
- 资产库单角度生图改为调用真实 `/api/generate-image`，直接使用返回的 `imageUrl` / `savedId`
- 资产接口按 `project_members` 做项目权限检查，避免只凭 projectId 读取资产
- `.gitignore` 补充根目录 SQLite 数据库忽略规则，降低用户数据误提交风险

### 2026-05-04 — 团队协作 + 资产库 + Dashboard

**后端**
- `db.js`：新增 `project_members` / `project_stats` / `events` / `asset_prompts` 四张表；`trackAgentCall / trackImageGen / trackStageComplete` 事务追踪；`findAssetWithPrompts / listAssetsWithPrompts` 多视角查询
- `index.js`：项目路由全量迁移 DB；script 路由改为读写 `projects.data` 列；`/api/script-agent` 接入 token 追踪（读 SSE 最后一帧 `usage`）；新增协作 API：`/api/projects/:id/status`（10s 轮询）、`/api/projects/:id/members`、`/api/dashboard`
- `routes/assets.js`：新增多视角提示词 CRUD（`/api/assets/:id/prompts`）、DNA 字段更新（`PATCH /api/assets/:id/dna`）
- `migrate.js`：JSON 文件 → DB 一次性迁移脚本

**前端**
- `AssetLibrary.tsx`：新页面，类型网格 + 右侧详情面板；支持 DNA 编辑、多视角提示词增删、单角度重生图
- `ProjectHome.tsx`：全局统计条（项目/资产/图片/Token/费用）；项目卡片新增 7 步流水线进度条 + 协作人数
- 三 Tab 互通：剧本 ↔ 生图 ↔ 资产库

**架构决策**（见 [[Agents/00-架构总览]]）
- DB-first：所有项目数据（画布 + 剧本）存入 `projects.data` JSON 列
- 协作：轮询 10s + Last-write-wins 冲突提示
- 追踪：双写 events + project_stats，dashboard 直读聚合表
- Character DNA：P0 功能已上线，见 [[Design/Agent扩展规划]]
