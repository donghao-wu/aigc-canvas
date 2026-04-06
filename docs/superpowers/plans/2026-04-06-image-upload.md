# Image Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add image upload via canvas drag-drop and Gallery upload zone; uploaded images persist server-side and appear mixed with generated images in Gallery.

**Architecture:** Backend gets a `POST /api/upload` endpoint (multer) that saves files to `backend/uploads/`; `GET /api/gallery` is updated to merge uploads with generated images sorted by timestamp. Frontend adds drop handlers to the canvas wrapper div (App.tsx), extends ImageNode to render from `imageUrl` in addition to base64, and extends Gallery with an upload zone and source badges.

**Tech Stack:** Node.js/Express + multer (new), React + TypeScript, @xyflow/react, axios

---

## File Map

| File | Change |
|------|--------|
| `backend/index.js` | Add multer, `POST /api/upload`, update `GET /api/gallery`, serve `/uploads` static |
| `frontend/src/nodes/ImageNode.tsx` | Support `data.imageUrl`, update `handleAnalyze` for URL images |
| `frontend/src/App.tsx` | Add `onDragOver`, `onDrop`, `onDragEnter`, `onDragLeave`, drop overlay, listen to `add-node-to-canvas` event |
| `frontend/src/Gallery.tsx` | Add upload zone, update `GalleryItem` interface, source badges, "发送到画布" button |

---

## Task 1: Install multer and create uploads directory

**Files:**
- Modify: `backend/package.json` (via npm install)
- Modify: `backend/index.js` — add `UPLOADS_DIR` constant and static serving

- [ ] **Step 1: Install multer**

```bash
cd backend && npm install multer
```

Expected output: `added 1 package` (or similar, no errors)

- [ ] **Step 2: Create the uploads directory**

```bash
mkdir -p backend/uploads
```

- [ ] **Step 3: Add UPLOADS_DIR constant and static serving to backend/index.js**

Open `backend/index.js`. Find the existing `GENERATED_DIR` block (around line 93):

```js
const GENERATED_DIR = path.join(__dirname, 'generated');
const METADATA_FILE = path.join(GENERATED_DIR, 'metadata.json');
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
```

Add immediately after that block:

```js
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
```

- [ ] **Step 4: Add multer require and static serving**

At the top of `backend/index.js`, add `multer` require after the existing requires:

```js
const multer = require('multer');
```

Find the existing static serving line:

```js
app.use('/generated', express.static(GENERATED_DIR));
```

Add immediately after it:

```js
app.use('/uploads', express.static(UPLOADS_DIR));
```

- [ ] **Step 5: Commit**

```bash
cd backend && git add package.json package-lock.json index.js && git commit -m "feat: install multer and serve /uploads static directory"
```

---

## Task 2: Add POST /api/upload endpoint

**Files:**
- Modify: `backend/index.js` — add multer config and upload route

- [ ] **Step 1: Add multer configuration to index.js**

In `backend/index.js`, after the `app.use('/uploads', ...)` line, add the multer setup:

```js
// ── 图片上传配置 ─────────────────────────────────────────────
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ts = Date.now();
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `upload-${ts}-${safe}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('不支持的文件类型，请上传 jpg/png/webp/gif'));
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});
```

- [ ] **Step 2: Add the upload endpoint**

In `backend/index.js`, find the gallery section (around line 525 near `app.get('/api/gallery'`). Add the upload endpoint just before the gallery section:

```js
// ── 图片上传接口 ──────────────────────────────────────────────
app.post('/api/upload', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '没有收到文件' });
  const url = `/uploads/${req.file.filename}`;
  const timestamp = Date.now();
  res.json({ url, filename: req.file.filename, timestamp });
});

// Multer error handler (file size / type)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '文件不能超过 20MB' });
  }
  if (err && err.message) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});
```

- [ ] **Step 3: Start the backend and test the endpoint manually**

```bash
cd backend && node index.js &
# Then test:
curl -s -X POST http://localhost:3001/api/upload \
  -H "Authorization: Bearer <your_token>" \
  -F "image=@/path/to/any/test.jpg" | head -c 200
```

Expected: `{"url":"/uploads/upload-TIMESTAMP-test.jpg","filename":"upload-TIMESTAMP-test.jpg","timestamp":TIMESTAMP}`

(If you don't have a token handy, skip this manual test — the feature will be tested via the UI in later tasks)

- [ ] **Step 4: Commit**

```bash
cd backend && git add index.js && git commit -m "feat: add POST /api/upload endpoint with multer"
```

---

## Task 3: Update GET /api/gallery to merge uploads

**Files:**
- Modify: `backend/index.js` — update gallery route

- [ ] **Step 1: Update the GET /api/gallery handler**

Find the existing gallery handler in `backend/index.js`:

```js
app.get('/api/gallery', (req, res) => {
  const meta = loadMeta();
  res.json(meta.map(m => ({
    id: m.id,
    url: `/generated/${m.filename}`,
    prompt: m.prompt,
    model: m.model,
    refCount: m.refCount || 0,
```

Replace the entire `app.get('/api/gallery', ...)` handler with:

```js
app.get('/api/gallery', (req, res) => {
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
```

- [ ] **Step 2: Restart backend and verify gallery returns both sources**

```bash
# Stop and restart backend
cd backend && node index.js
# In another terminal:
curl -s http://localhost:3001/api/gallery | node -e "
  const d = require('fs').readFileSync('/dev/stdin','utf8');
  const arr = JSON.parse(d);
  console.log('Total items:', arr.length);
  console.log('Sources:', [...new Set(arr.map(i=>i.source))]);
"
```

Expected: `Total items: N`, `Sources: [ 'generated' ]` (uploads will show once files exist)

- [ ] **Step 3: Commit**

```bash
cd backend && git add index.js && git commit -m "feat: update GET /api/gallery to merge uploaded images with generated"
```

---

## Task 4: Update ImageNode to support imageUrl

**Files:**
- Modify: `frontend/src/nodes/ImageNode.tsx`

- [ ] **Step 1: Update ImageNode to destructure imageUrl and compute imgSrc with fallback**

Open `frontend/src/nodes/ImageNode.tsx`. Replace the top of the component function:

```ts
// OLD (lines 8-15):
export default function ImageNode({ id, data }: NodeProps) {
  const { base64, mimeType, prompt } = data as { base64: string; mimeType: string; prompt: string }
  ...
  const imgSrc = `data:${mimeType || 'image/jpeg'};base64,${base64}`
```

Replace with:

```ts
export default function ImageNode({ id, data }: NodeProps) {
  const { base64, mimeType, prompt, imageUrl } = data as {
    base64?: string; mimeType?: string; prompt?: string; imageUrl?: string
  }
  const { setNodes, setEdges, getNode } = useReactFlow()
  const { T } = useTheme()
  const nodeName = (data as Record<string, unknown>)?.name as string || '图像'
  const handleRename = (v: string) =>
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, name: v } } : n))

  const imgSrc = imageUrl ?? `data:${mimeType || 'image/jpeg'};base64,${base64}`
```

- [ ] **Step 2: Update handleAnalyze to handle imageUrl case**

Replace the entire `handleAnalyze` callback:

```ts
const handleAnalyze = useCallback(async () => {
  if (analyzing) return
  if (!base64 && !imageUrl) return
  setAnalyzing(true)
  setAnalyzeErr('')
  try {
    let b64 = base64
    let mime = mimeType || 'image/jpeg'

    // If this is an uploaded image (imageUrl, no base64), fetch and convert
    if (!b64 && imageUrl) {
      const resp = await fetch(imageUrl)
      const blob = await resp.blob()
      mime = blob.type || 'image/jpeg'
      const buf = await blob.arrayBuffer()
      b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
    }

    const { data: result } = await axios.post(
      '/api/analyze-image',
      { base64: b64, mimeType: mime }
    )

    const self = getNode(id)
    const x = (self?.position.x ?? 0) + 240
    const y = self?.position.y ?? 0
    const newId = `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`

    setNodes(nds => [...nds, {
      id: newId,
      type: 'promptAnalysis',
      position: { x, y },
      data: {
        analysis: result.analysis,
        reconstructedPrompt: result.reconstructedPrompt,
      },
    }])
    setEdges(eds => [...eds, { id: `e_${id}_${newId}`, source: id, target: newId }])
  } catch (err: any) {
    setAnalyzeErr(err.response?.data?.error || '分析失败')
    setTimeout(() => setAnalyzeErr(''), 3000)
  } finally {
    setAnalyzing(false)
  }
}, [id, base64, mimeType, imageUrl, analyzing, getNode, setNodes, setEdges])
```

- [ ] **Step 3: Update the disabled condition on the 拆解 button**

Find:

```tsx
disabled={analyzing}
```

Replace with:

```tsx
disabled={analyzing || (!base64 && !imageUrl)}
```

- [ ] **Step 4: Update handleDownload for imageUrl case**

Replace `handleDownload`:

```ts
const handleDownload = useCallback(() => {
  const a = document.createElement('a')
  a.href = imgSrc
  a.download = `${nodeName}-${Date.now()}.jpg`
  if (imageUrl) a.target = '_blank'
  a.click()
}, [imgSrc, nodeName, imageUrl])
```

- [ ] **Step 5: Verify the app compiles**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: `built in Xs` with no TypeScript errors

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/nodes/ImageNode.tsx && git commit -m "feat: ImageNode supports imageUrl (uploaded images) with base64 fallback"
```

---

## Task 5: Add canvas drag-drop upload in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add isDraggingImage state and upload helper**

In `frontend/src/App.tsx`, find the CanvasArea component function (around line 110, `function CanvasArea`). Add these state and helper near the top of the component body, after the existing state declarations:

```ts
const [isDraggingImage, setIsDraggingImage] = useState(false)
const [uploadingDrop,   setUploadingDrop]   = useState(false)

const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
  const hasImage = Array.from(e.dataTransfer.items).some(
    item => item.kind === 'file' && item.type.startsWith('image/')
  )
  if (hasImage) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
}, [])

const handleCanvasDragEnter = useCallback((e: React.DragEvent) => {
  const hasImage = Array.from(e.dataTransfer.items).some(
    item => item.kind === 'file' && item.type.startsWith('image/')
  )
  if (hasImage) setIsDraggingImage(true)
}, [])

const handleCanvasDragLeave = useCallback((e: React.DragEvent) => {
  // Only clear if leaving the wrapper entirely (not entering a child)
  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
    setIsDraggingImage(false)
  }
}, [])

const handleCanvasDrop = useCallback(async (e: React.DragEvent) => {
  e.preventDefault()
  setIsDraggingImage(false)

  const files = Array.from(e.dataTransfer.files).filter(
    f => f.type.startsWith('image/')
  )
  if (files.length === 0) return

  setUploadingDrop(true)
  try {
    const file = files[0] // upload first image only
    const formData = new FormData()
    formData.append('image', file)
    const { data: uploaded } = await axios.post('/api/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })

    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const newId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
    setNodes(nds => [...nds, {
      id: newId,
      type: 'image',
      position: pos,
      data: {
        imageUrl: uploaded.url,
        prompt: file.name,
        name: file.name.replace(/\.[^/.]+$/, ''),
      },
    }])
  } catch (err: any) {
    console.error('Upload failed:', err)
    // Could add a toast here if needed
  } finally {
    setUploadingDrop(false)
  }
}, [screenToFlowPosition, setNodes])
```

- [ ] **Step 2: Add event listener for add-node-to-canvas in App.tsx**

Still in CanvasArea, find the existing `useEffect` that listens to `canvas-refresh`:

```ts
window.addEventListener('canvas-refresh', loadProject)
return () => window.removeEventListener('canvas-refresh', loadProject)
```

Add a NEW separate `useEffect` after it:

```ts
useEffect(() => {
  const handler = (e: CustomEvent) => {
    const { node } = e.detail
    if (!node) return
    setNodes(nds => {
      // Avoid duplicate ids
      if (nds.find(n => n.id === node.id)) return nds
      return [...nds, node]
    })
  }
  window.addEventListener('add-node-to-canvas', handler as EventListener)
  return () => window.removeEventListener('add-node-to-canvas', handler as EventListener)
}, [setNodes])
```

- [ ] **Step 3: Add drop handlers and overlay to the wrapper div**

Find the return statement of CanvasArea:

```tsx
return (
  <div ref={wrapperRef} className="w-screen h-screen" onClick={() => setMenu(null)}>
    <ReactFlow
```

Replace the outer div to add drag handlers and the overlay:

```tsx
return (
  <div
    ref={wrapperRef}
    className="w-screen h-screen"
    style={{ position: 'relative' }}
    onClick={() => setMenu(null)}
    onDragOver={handleCanvasDragOver}
    onDragEnter={handleCanvasDragEnter}
    onDragLeave={handleCanvasDragLeave}
    onDrop={handleCanvasDrop}
  >
    {/* Drop overlay */}
    {isDraggingImage && (
      <div style={{
        position: 'absolute', inset: 0, zIndex: 999, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(201,152,42,0.08)',
        border: '3px dashed rgba(201,152,42,0.6)',
        borderRadius: 0,
      }}>
        <div style={{
          background: 'rgba(13,11,8,0.85)', borderRadius: 12,
          padding: '16px 28px', textAlign: 'center',
          border: '1px solid rgba(201,152,42,0.4)',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🖼️</div>
          <div style={{ fontSize: 14, color: 'rgba(201,152,42,0.9)', fontWeight: 600 }}>
            释放以上传图片
          </div>
        </div>
      </div>
    )}
    {uploadingDrop && (
      <div style={{
        position: 'absolute', inset: 0, zIndex: 998, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(13,11,8,0.3)',
      }}>
        <div style={{ fontSize: 13, color: 'rgba(201,152,42,0.9)' }}>
          <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', marginRight: 8 }}>⟳</span>
          上传中...
        </div>
      </div>
    )}
    <ReactFlow
```

- [ ] **Step 4: Verify no TypeScript errors**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: `built in Xs` with no errors

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/App.tsx && git commit -m "feat: canvas drag-drop image upload with amber drop overlay"
```

---

## Task 6: Update Gallery with upload zone, source badges, and send-to-canvas

**Files:**
- Modify: `frontend/src/Gallery.tsx`

- [ ] **Step 1: Update the GalleryItem interface**

In `Gallery.tsx`, replace:

```ts
interface GalleryItem {
  id: string
  url: string
  prompt: string
  model: string
  refCount: number
  createdAt: number
}
```

With:

```ts
interface GalleryItem {
  id: string
  url: string
  prompt: string
  model: string
  refCount: number
  createdAt: number
  source: 'generated' | 'uploaded'
}
```

- [ ] **Step 2: Add upload state and handler to Gallery component**

Inside the `Gallery` component function, after the existing state declarations:

```ts
const [uploading,   setUploading]   = useState(false)
const [uploadErr,   setUploadErr]   = useState('')
const [dropHover,   setDropHover]   = useState(false)
const fileInputRef = useRef<HTMLInputElement>(null)

const handleUploadFiles = async (files: FileList | null) => {
  if (!files || files.length === 0) return
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
  if (imageFiles.length === 0) return
  setUploading(true)
  setUploadErr('')
  try {
    for (const file of imageFiles) {
      const formData = new FormData()
      formData.append('image', file)
      await axios.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    }
    await load() // refresh gallery
  } catch (err: any) {
    const msg = err.response?.data?.error || '上传失败'
    setUploadErr(msg)
    setTimeout(() => setUploadErr(''), 4000)
  } finally {
    setUploading(false)
  }
}

const sendToCanvas = (item: GalleryItem, e: React.MouseEvent) => {
  e.stopPropagation()
  const newId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
  const node = {
    id: newId,
    type: 'image',
    position: { x: 4000 + Math.random() * 200, y: 2000 + Math.random() * 200 },
    data: {
      imageUrl: item.url,
      prompt: item.prompt || item.url.split('/').pop() || '',
      name: (item.prompt || item.url.split('/').pop() || '上传图片').slice(0, 20),
    },
  }
  window.dispatchEvent(new CustomEvent('add-node-to-canvas', { detail: { node } }))
}
```

- [ ] **Step 3: Add upload zone JSX above the image grid**

In `Gallery.tsx`, find the content area comment:

```tsx
{/* 内容区 */}
<div className="flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: 'thin' }}>
```

Replace that opening section and add the upload zone before the loading/empty states:

```tsx
{/* 内容区 */}
<div className="flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: 'thin' }}>

  {/* Hidden file input */}
  <input
    ref={fileInputRef}
    type="file"
    accept="image/*"
    multiple
    style={{ display: 'none' }}
    onChange={e => handleUploadFiles(e.target.files)}
  />

  {/* Upload zone */}
  <div
    onClick={() => fileInputRef.current?.click()}
    onDragOver={e => { e.preventDefault(); setDropHover(true) }}
    onDragLeave={() => setDropHover(false)}
    onDrop={e => {
      e.preventDefault()
      setDropHover(false)
      handleUploadFiles(e.dataTransfer.files)
    }}
    style={{
      marginBottom: 10, borderRadius: 8, cursor: 'pointer',
      border: `1.5px dashed ${dropHover ? 'rgba(201,152,42,0.8)' : T.border}`,
      background: dropHover ? 'rgba(201,152,42,0.08)' : 'transparent',
      padding: '10px 8px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      transition: 'all 0.15s',
      minHeight: 52,
    }}
  >
    {uploading ? (
      <span style={{ fontSize: 12, color: 'rgba(201,152,42,0.8)' }}>
        <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', marginRight: 6 }}>⟳</span>
        上传中...
      </span>
    ) : (
      <>
        <span style={{ fontSize: 16, opacity: 0.6 }}>↑</span>
        <span style={{ fontSize: 12, color: T.textMuted }}>
          {dropHover ? '释放以上传' : '拖拽或点击上传图片'}
        </span>
      </>
    )}
  </div>

  {/* Upload error */}
  {uploadErr && (
    <div style={{
      marginBottom: 8, padding: '5px 8px', borderRadius: 6, fontSize: 11,
      background: 'rgba(239,68,68,0.08)', color: 'rgba(239,68,68,0.85)',
      border: '1px solid rgba(239,68,68,0.2)',
    }}>
      {uploadErr}
    </div>
  )}
```

- [ ] **Step 4: Add source badge and send-to-canvas button to each gallery item**

Find the existing image card hover overlay section inside the grid:

```tsx
{/* hover 遮罩（叠在图片上，保持深色渐变） */}
<div
  className="absolute inset-0 flex flex-col justify-between p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
  style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.7) 100%)' }}
>
  <div className="flex justify-end">
    <button
      onClick={e => deleteItem(item.id, e)}
```

Replace that entire hover overlay div with:

```tsx
{/* Source badge (top-left, always visible) */}
<div style={{
  position: 'absolute', top: 4, left: 4, zIndex: 1,
  fontSize: 9, padding: '1px 5px', borderRadius: 3,
  fontWeight: 600, letterSpacing: '0.5px',
  background: item.source === 'generated'
    ? 'rgba(201,152,42,0.85)'
    : 'rgba(120,120,120,0.85)',
  color: item.source === 'generated' ? '#0D0B08' : '#fff',
}}>
  {item.source === 'generated' ? 'AI' : '上传'}
</div>

{/* hover 遮罩（叠在图片上，保持深色渐变） */}
<div
  className="absolute inset-0 flex flex-col justify-between p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
  style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.7) 100%)' }}
>
  <div className="flex justify-end">
    <button
      onClick={e => deleteItem(item.id, e)}
```

Then find the bottom of the hover overlay (the download button row):

```tsx
                  <div className="flex items-end justify-between gap-1">
                    <span
                      style={{
                        fontSize: 11, padding: '2px 6px', borderRadius: 4, fontWeight: 500,
                        background: 'rgba(16,185,129,0.75)', color: '#fff', maxWidth: 70,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {MODEL_SHORT[item.model] ?? item.model.split('-')[0]}
                      {item.refCount > 0 ? ` +${item.refCount}` : ''}
                    </span>
                    <button
                      onClick={e => download(item, e)}
```

Replace that bottom row with:

```tsx
                  <div className="flex items-end justify-between gap-1">
                    {item.source === 'generated' ? (
                      <span
                        style={{
                          fontSize: 11, padding: '2px 6px', borderRadius: 4, fontWeight: 500,
                          background: 'rgba(16,185,129,0.75)', color: '#fff', maxWidth: 70,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                      >
                        {MODEL_SHORT[item.model] ?? item.model.split('-')[0]}
                        {item.refCount > 0 ? ` +${item.refCount}` : ''}
                      </span>
                    ) : (
                      <button
                        onClick={e => sendToCanvas(item, e)}
                        style={{
                          fontSize: 10, padding: '2px 6px', borderRadius: 4,
                          background: 'rgba(201,152,42,0.75)', color: '#0D0B08',
                          border: 'none', cursor: 'pointer', fontWeight: 600,
                        }}
                      >→画布</button>
                    )}
                    <button
                      onClick={e => download(item, e)}
```

- [ ] **Step 5: Update the delete handler to also handle uploaded items**

The existing `deleteItem` calls `DELETE /api/gallery/:id`. For uploaded images, `id` is `upload_filename`. The backend currently only handles generated IDs. Update backend's delete endpoint OR handle client-side by adding an upload delete endpoint.

Add this endpoint in `backend/index.js` after `POST /api/upload`:

```js
app.delete('/api/upload/:filename', authMiddleware, (req, res) => {
  const { filename } = req.params;
  // Basic safety: prevent path traversal
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return res.status(400).json({ error: '无效文件名' });
  }
  const filePath = path.join(UPLOADS_DIR, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败' });
  }
});
```

Then in `Gallery.tsx`, update `deleteItem` to handle both sources:

```ts
const deleteItem = async (item: GalleryItem, e: React.MouseEvent) => {
  e.stopPropagation()
  if (item.source === 'uploaded') {
    const filename = item.url.split('/').pop()!
    await axios.delete(`/api/upload/${filename}`)
  } else {
    await axios.delete(`/api/gallery/${item.id}`)
  }
  setItems(prev => prev.filter(i => i.id !== item.id))
  if (lightbox?.id === item.id) setLightbox(null)
}
```

Note: the `deleteItem` function signature changes from `(id: string, e)` to `(item: GalleryItem, e)`. Update all call sites in Gallery.tsx:

- In the hover overlay: `onClick={e => deleteItem(item.id, e)}` → `onClick={e => deleteItem(item, e)}`
- In the lightbox: `onClick={e => deleteItem(lightbox.id, e)}` → `onClick={e => deleteItem(lightbox, e)}`

- [ ] **Step 6: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: `built in Xs` with no TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/Gallery.tsx backend/index.js && git commit -m "feat: Gallery upload zone, source badges, send-to-canvas for uploaded images"
```

---

## Task 7: End-to-end smoke test

- [ ] **Step 1: Start backend and frontend**

```bash
cd backend && node index.js &
cd frontend && npm run dev
```

- [ ] **Step 2: Test canvas drag-drop**

1. Open the app at http://localhost:5173
2. Log in and open a project
3. Find an image file on your desktop or downloads folder
4. Drag it from file explorer onto the canvas
5. ✅ Amber dashed overlay appears on drag hover
6. ✅ Drop creates an ImageNode with the image displayed
7. ✅ Node shows image correctly, title is the filename

- [ ] **Step 3: Test 拆解 on uploaded image**

1. Click "拆解" on the newly created upload ImageNode
2. ✅ Spinner shows, PromptAnalysisNode appears connected to the ImageNode

- [ ] **Step 4: Test Gallery upload zone**

1. Open Gallery panel (top right)
2. ✅ Upload zone appears at top of Gallery
3. Click the zone → file picker opens
4. Select an image file
5. ✅ Uploading... spinner shows
6. ✅ Uploaded image appears in gallery with gray "上传" badge

- [ ] **Step 5: Test Gallery send-to-canvas**

1. Hover over an uploaded image in Gallery
2. ✅ "→画布" button appears in bottom-left
3. Click it
4. ✅ ImageNode appears on canvas with the uploaded image

- [ ] **Step 6: Test Gallery delete for uploaded image**

1. Hover over an uploaded image
2. Click the red ✕ button
3. ✅ Image disappears from gallery
4. Verify file is gone: `ls backend/uploads/`

- [ ] **Step 7: Verify backward compat — generated images unaffected**

1. Generate an image via an ImageGenNode
2. ✅ Generated image shows amber "AI" badge in Gallery
3. ✅ Existing download and delete still work
4. ✅ Generated ImageNodes on canvas still render correctly (base64 path unchanged)

- [ ] **Step 8: Final commit**

```bash
git add -A && git commit -m "feat: complete image upload — canvas drag-drop + gallery upload zone"
```
