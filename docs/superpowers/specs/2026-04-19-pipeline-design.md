# Pipeline Page Design — 漫剧全AI生产智能体 Demo

**Date:** 2026-04-19  
**Status:** Approved

---

## Overview

Add a dedicated `/pipeline` page to 壹镜 that walks through the full manga/comic AI production pipeline step by step. The user controls the pace — each step has its own trigger button. All existing backend APIs are reused unchanged; only one new endpoint is added.

---

## Architecture

**Approach:** Frontend-driven pipeline. `PipelinePage.tsx` calls existing APIs in sequence, manages all state locally, and calls one new backend endpoint to save the final manifest.

**New files:**
- `frontend/src/PipelinePage.tsx` — main pipeline UI
- `frontend/src/hooks/usePipeline.ts` — state + API orchestration logic (optional extraction)

**Modified files:**
- `frontend/src/App.tsx` — add "Pipeline" tab to top nav + route
- `backend/index.js` — add `POST /api/pipeline/save-manifest`

---

## Page Layout

```
┌─────────────────────────────────────────────┐
│  顶部导航：壹镜 | 图片库 | 剧本工作台 | Pipeline │
└─────────────────────────────────────────────┘
┌──────────────┬──────────────────────────────┐
│              │  Step 1：剧本拆解             │
│  剧本输入    │  [执行] → 分镜列表            │
│  (textarea)  ├──────────────────────────────┤
│              │  Step 2：角色/场景设计生图     │
│  风格选择    │  [执行] → 缩略图网格          │
│  (2D/3D/     ├──────────────────────────────┤
│   仿真人)    │  Step 3：分镜视频生成         │
│              │  [执行] → 进度条 + 视频列表   │
│              ├──────────────────────────────┤
│              │  Step 4：素材归档             │
│              │  [导出 manifest] → 文件树     │
└──────────────┴──────────────────────────────┘
```

- Each step card: status badge (待执行 / 运行中 / 完成 / 失败), trigger button, result area
- Steps 2–4 are disabled until the preceding step completes

---

## Step-by-Step Data Flow

### Step 1 — 剧本拆解
- Call: `POST /api/script-agent` (mode: `outline`)
- Stream SSE response, accumulate text
- Parse output into structured array:
  ```js
  shots = [{ id, location, shotType, angle, desc }, ...]
  ```
- Store in `pipelineState.shots`
- Display: collapsible list of shot cards

### Step 2 — 角色/场景设计生图
- Call: `POST /api/asset-agent` with script + style (2D/3D/仿真人)
- Parse `===ASSET_START===` blocks → extract `TYPE`, `NAME`, `PROMPT` per asset
- Batch generate images: 3 concurrent calls to `POST /api/generate-image`
- Show per-asset progress, retry button on failure
- Store in `pipelineState.assets = [{ type, name, prompt, imageBase64, mimeType, savedId }]`
- Display: grid grouped by CHARACTER / SCENE / PROP with thumbnails

### Step 3 — 分镜视频生成
- Call: `POST /api/script-agent` (mode: `prompts`) with confirmed shots
- Parse video prompts per shot
- Batch generate videos: 3 concurrent calls to `POST /api/generate-video`
- Poll `GET /api/video-status` every 5s per task until completed/failed
- Show per-shot progress bar, retry on failure
- Store in `pipelineState.videos = [{ shotId, prompt, taskId, videoUrl, status }]`
- Display: shot list with inline video player or progress indicator

### Step 4 — 素材归档
- Call: `POST /api/pipeline/save-manifest`
- Backend writes to `backend/pipeline-output/{timestamp}-{name}/manifest.json`
- manifest.json structure:
  ```json
  {
    "projectName": "...",
    "createdAt": "...",
    "shots": [...],
    "assets": [{ "type", "name", "prompt", "file" }],
    "videos": [{ "shotId", "prompt", "file", "status" }]
  }
  ```
- Display: file tree with download links

---

## Error Handling

- Each step fails independently — others are unaffected
- Batch items: individual failures marked ❌, rest continue
- On failure: show count "3 个失败" + per-item retry button
- Network errors: auto-retry once, then surface error message
- No step resets state of completed steps

---

## Concurrency

- Batch size: 3 concurrent API calls at a time
- Pattern: process array in chunks of 3, await each chunk before next
- Applied to both image generation (Step 2) and video generation (Step 3)

---

## Backend Changes

### New endpoint only — no existing endpoints modified

```
POST /api/pipeline/save-manifest
Auth: required (authMiddleware)
Body: { projectName, shots, assets, videos }
```

- Creates `backend/pipeline-output/{timestamp}-{projectName}/`
- Writes `manifest.json`
- Copies image files from `generated/` by savedId
- Returns: `{ path, manifestUrl }`

---

## Out of Scope (Demo)

- Real-time multi-user collaboration
- Video download packaging (zip)
- Pipeline history / re-run
- Progress persistence across page reload
