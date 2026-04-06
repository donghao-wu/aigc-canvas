# Image Upload Feature Design

**Date:** 2026-04-06
**Status:** Approved

## Overview

Add image upload functionality to the AIGC canvas tool. Users can upload images via two entry points: drag-and-drop onto the canvas, and an upload zone in the Gallery panel. Uploaded images are stored server-side and mixed into the Gallery alongside AI-generated images.

---

## Architecture

### Backend

**New endpoint: `POST /api/upload`**
- Protected by `authMiddleware`
- Uses `multer` middleware to handle `multipart/form-data`
- Accepts image files: jpg, jpeg, png, webp, gif
- Max file size: 20MB
- Saves file to `backend/uploads/` directory
- Filename format: `upload-{timestamp}-{originalname}` (avoids collisions)
- Returns: `{ url: '/uploads/filename.jpg', filename, timestamp }`

**Updated endpoint: `GET /api/gallery`**
- Existing logic reads `generated/` + `metadata.json` → array with `source: 'generated'`
- New logic: scan `uploads/` directory, build array of `{ source: 'uploaded', url: '/uploads/filename', filename, timestamp }` objects (timestamp derived from filename prefix)
- Merge both arrays, sort descending by `timestamp`
- Return unified array

**Static file serving**
- Mount `express.static('uploads')` at `/uploads` (mirrors existing `/generated`)

**Multer config**
- Storage: `multer.diskStorage` with `destination: 'uploads/'` and `filename` using timestamp prefix
- File filter: validate `mimetype` against whitelist `['image/jpeg', 'image/png', 'image/webp', 'image/gif']`
- Limits: `{ fileSize: 20 * 1024 * 1024 }`

---

## Frontend: Canvas Drag-and-Drop

**File: `frontend/src/App.tsx`**

Add drag-and-drop handlers to the ReactFlow wrapper div:

- `onDragOver(e)`: `e.preventDefault(); e.dataTransfer.dropEffect = 'copy'`
- `onDrop(e)`:
  1. `e.preventDefault()`
  2. Check `e.dataTransfer.files` — filter for image MIME types
  3. If image file found: show drop overlay loading state
  4. Upload via `FormData` → `POST /api/upload`
  5. Convert drop position to canvas coordinates using `reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY })`
  6. Create new `image` node at that position with `data.imageUrl = response.url`
  7. Use `setNodes` to add the node (no `canvas-refresh` dispatch)

**Drop overlay**
- A semi-transparent amber dashed overlay covers the canvas while dragging an image over it
- Text: "释放以上传图片"
- Controlled by a `isDraggingImage` state (set on `onDragEnter`, cleared on `onDragLeave`/`onDrop`)
- After drop: brief loading spinner at drop position before node appears

---

## Frontend: Gallery Panel

**File: `frontend/src/Gallery.tsx`**

**Upload zone (top of Gallery)**
- Compact drag-and-drop zone (~60px tall), always visible at top of Gallery
- Displays: "拖拽或点击上传" with an upload icon
- Click triggers hidden `<input type="file" accept="image/*" multiple>`
- On file select: call `POST /api/upload` for each file, then refresh gallery list
- Drag-over: amber highlight border

**Gallery list updates**
- `GET /api/gallery` now returns unified array with `source` field
- Each image card renders a small badge in top-right corner:
  - `source === 'generated'`: amber badge "AI"
  - `source === 'uploaded'`: gray badge "上传"
- Badge uses absolute positioning, small font, pill shape

**"发送到画布" for uploaded images**
- Creates `image` node with `data.imageUrl = item.url`
- Node placed at a default canvas position (e.g. `{ x: 4000, y: 2000 }` offset by index)
- Uses `canvas-refresh` custom event to notify canvas (same as current Gallery behavior for generated images)

---

## Frontend: ImageNode

**File: `frontend/src/nodes/ImageNode.tsx`**

**Dual image source support**
- Current: renders from `data.base64` only
- New: check `data.imageUrl` first, fall back to `data.base64`
- `<img src={data.imageUrl ?? `data:image/png;base64,${data.base64}`} />`
- Backward compatible — existing generated image nodes unchanged

**"拆解" button with uploaded images**
- Currently sends `base64` to `POST /api/analyze-image`
- For `imageUrl` nodes: `fetch(data.imageUrl)` → `blob.arrayBuffer()` → convert to base64 → send to existing analyze endpoint
- No backend changes needed

---

## Data Flow Summary

```
User drops image on canvas
  → onDrop handler (App.tsx)
  → POST /api/upload (multer saves to uploads/)
  → Returns { url: '/uploads/...' }
  → setNodes adds image node with data.imageUrl
  → ImageNode renders via <img src={imageUrl}>
  → "拆解" fetches image, converts to base64, calls /api/analyze-image

User uploads via Gallery
  → Gallery upload zone (Gallery.tsx)
  → POST /api/upload (same endpoint)
  → GET /api/gallery refreshes (now includes uploads/)
  → Gallery displays mixed list with source badges
  → "发送到画布" creates image node with data.imageUrl
```

---

## File Changes Summary

| File | Change |
|------|--------|
| `backend/index.js` | Add multer, `POST /api/upload`, update `GET /api/gallery`, serve `/uploads` static |
| `frontend/src/App.tsx` | Add `onDragOver`, `onDrop`, drop overlay state |
| `frontend/src/Gallery.tsx` | Add upload zone, source badges, refresh after upload |
| `frontend/src/nodes/ImageNode.tsx` | Support `data.imageUrl`, update analyze to handle URL images |

**No new node types needed.** Existing `image` node type handles both generated and uploaded images via the dual-source pattern.

---

## Error Handling

- Upload fails: toast error message, no node created
- Unsupported file type: client-side validation before upload, show inline error
- File too large: multer rejects with 413, frontend shows "文件不能超过 20MB"
- Gallery load error: existing error handling covers this
- Analyze on URL image: if fetch fails, show same 3s auto-clear error as current behavior
