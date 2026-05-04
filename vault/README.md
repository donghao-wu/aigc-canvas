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
