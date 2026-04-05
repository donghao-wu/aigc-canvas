# 提示词反向拆解 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户点击 ImageNode 上的「拆解」按钮，系统用 qwen3-vl-flash 视觉模型分析图片，在画布上自动生成可编辑的 PromptAnalysisNode，用户修改字段后可一键创建 ImageGenNode 重新生图。

**Architecture:** 后端新增 `/api/analyze-image` 接口，调用阿里云 DashScope OpenAI 兼容 API；前端新建 PromptAnalysisNode 节点类型，ImageNode 头部新增拆解按钮触发整个流程。

**Tech Stack:** Node.js/Express (backend), React/TypeScript/ReactFlow (@xyflow/react), axios, DashScope API (qwen3-vl-flash)

---

## 文件改动清单

| 文件 | 操作 |
|------|------|
| `backend/.env` | 新增 `DASHSCOPE_API_KEY` |
| `backend/index.js` | 新增 `buildPromptFromAnalysis()` 函数 + `POST /api/analyze-image` 接口 |
| `frontend/src/nodes/PromptAnalysisNode.tsx` | 新建：结构化提示词节点组件 |
| `frontend/src/nodes/ImageNode.tsx` | 新增「拆解」按钮 + `handleAnalyze` 逻辑 |
| `frontend/src/App.tsx` | 注册 `promptAnalysis` 节点类型，右键菜单新增选项 |

---

## Task 1: 后端 — 新增 `/api/analyze-image` 接口

**Files:**
- Modify: `backend/.env`
- Modify: `backend/index.js`

- [ ] **Step 1: 在 .env 新增 DASHSCOPE_API_KEY**

打开 `backend/.env`，在末尾追加：
```
DASHSCOPE_API_KEY=sk-a58192a595934e2491a24f142bba260e
```

- [ ] **Step 2: 在 index.js 中新增 buildPromptFromAnalysis 辅助函数**

在 `backend/index.js` 里，找到 `// ── 生图接口` 这行注释的上方，插入以下函数：

```javascript
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
```

- [ ] **Step 3: 在 index.js 中新增 POST /api/analyze-image 接口**

在 `// ── 生图接口` 注释的上方，紧接着 `buildPromptFromAnalysis` 函数之后，插入：

```javascript
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
```

- [ ] **Step 4: 重启后端，验证接口可达**

```bash
cd backend
# 停掉之前的进程（Ctrl+C 或 kill），然后重启
node index.js
```

预期输出：
```
✅ AIGC 后端运行在 http://localhost:3001
```

- [ ] **Step 5: 用 curl 快速测试接口（用一个小的测试 base64）**

```bash
curl -X POST http://localhost:3001/api/analyze-image \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(curl -s -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' -d '{"username":"wdy","password":"Wudayong197147"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')" \
  -d '{"base64":"/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoH","mimeType":"image/jpeg"}' \
  2>/dev/null | head -c 200
```

预期：返回 JSON（可能是错误 JSON，因为 base64 是假数据，但接口应该响应而不是 500 网络错误）

- [ ] **Step 6: commit**

```bash
cd backend
git add .env index.js
git commit -m "feat: add POST /api/analyze-image with qwen3-vl-flash"
```

---

## Task 2: 前端 — 新建 PromptAnalysisNode 组件

**Files:**
- Create: `frontend/src/nodes/PromptAnalysisNode.tsx`

- [ ] **Step 1: 创建文件，定义类型和辅助函数**

新建 `frontend/src/nodes/PromptAnalysisNode.tsx`，写入完整内容：

```tsx
import { useState, useCallback } from 'react'
import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react'
import { useTheme } from '../ThemeContext'

// ── 类型定义 ────────────────────────────────────────────────────
export interface PromptAnalysis {
  characters: Array<{ description: string; position: string }>
  setting: { location: string; era: string; time_of_day: string }
  lighting: { type: string; direction: string; tone: string }
  composition: { shot_type: string; angle: string }
  style: { aesthetic: string; color_palette: string; film_grain: boolean }
}

export function buildPrompt(a: PromptAnalysis): string {
  const parts: string[] = []
  if (a.characters?.length)
    parts.push(a.characters.map(c => c.description).filter(Boolean).join('，'))
  if (a.setting?.location) parts.push(a.setting.location)
  if (a.setting?.era) parts.push(`${a.setting.era}风格`)
  if (a.lighting?.direction && a.lighting?.tone)
    parts.push(`${a.lighting.direction}${a.lighting.tone}光线`)
  else if (a.lighting?.tone) parts.push(`${a.lighting.tone}光线`)
  if (a.composition?.shot_type) parts.push(a.composition.shot_type)
  if (a.style?.aesthetic) parts.push(a.style.aesthetic)
  if (a.style?.color_palette) parts.push(`${a.style.color_palette}色调`)
  if (a.style?.film_grain) parts.push('胶片质感')
  return parts.filter(Boolean).join('，')
}

// ── 字段区块定义 ────────────────────────────────────────────────
const SECTIONS = [
  { key: 'characters', label: '人物' },
  { key: 'setting',    label: '场景' },
  { key: 'lighting',   label: '光线' },
  { key: 'composition',label: '构图' },
  { key: 'style',      label: '风格' },
] as const

// 扁平化字段 label
const FIELD_LABELS: Record<string, string> = {
  'characters.0.description': '描述',
  'characters.0.position':    '位置',
  'setting.location':   '地点',
  'setting.era':        '时代',
  'setting.time_of_day':'时间',
  'lighting.type':      '光源',
  'lighting.direction': '方向',
  'lighting.tone':      '色调',
  'composition.shot_type': '景别',
  'composition.angle':     '角度',
  'style.aesthetic':     '风格',
  'style.color_palette': '主色调',
}

// ── 主组件 ──────────────────────────────────────────────────────
export default function PromptAnalysisNode({ id, data }: NodeProps) {
  const { T, theme } = useTheme()
  const { setNodes, setEdges, getNode } = useReactFlow()

  const analysis       = (data as any).analysis       as PromptAnalysis
  const reconstructedPrompt = (data as any).reconstructedPrompt as string ?? ''

  const [tab, setTab] = useState<'fields' | 'json'>('fields')
  const [jsonText, setJsonText] = useState(() => JSON.stringify(analysis, null, 2))
  const [jsonError, setJsonError] = useState('')

  // ── 更新 analysis + 重组提示词 ────────────────────────────────
  const setAnalysis = useCallback((next: PromptAnalysis) => {
    const prompt = buildPrompt(next)
    setNodes(nds => nds.map(n =>
      n.id === id ? { ...n, data: { ...n.data, analysis: next, reconstructedPrompt: prompt } } : n
    ))
    setJsonText(JSON.stringify(next, null, 2))
  }, [id, setNodes])

  // ── 字段视图：更新单个扁平路径 ──────────────────────────────
  const handleFieldChange = (path: string, value: string) => {
    const next = JSON.parse(JSON.stringify(analysis)) as PromptAnalysis
    const keys = path.split('.')
    let obj: any = next
    for (let i = 0; i < keys.length - 1; i++) {
      const k = isNaN(Number(keys[i])) ? keys[i] : Number(keys[i])
      obj = obj[k]
    }
    obj[keys[keys.length - 1]] = value
    setAnalysis(next)
  }

  // ── JSON 视图同步 ────────────────────────────────────────────
  const handleJsonChange = (raw: string) => {
    setJsonText(raw)
    try {
      const parsed = JSON.parse(raw)
      setJsonError('')
      const prompt = buildPrompt(parsed)
      setNodes(nds => nds.map(n =>
        n.id === id ? { ...n, data: { ...n.data, analysis: parsed, reconstructedPrompt: prompt } } : n
      ))
    } catch {
      setJsonError('JSON 格式错误')
    }
  }

  // ── 点击「用此生图」─────────────────────────────────────────
  const handleGenerate = useCallback(() => {
    const self = getNode(id)
    const x = (self?.position.x ?? 0) + 360
    const y = self?.position.y ?? 0
    const newId = `pagen_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
    setNodes(nds => [...nds, {
      id: newId,
      type: 'imageGen',
      position: { x, y },
      data: { name: '生图（拆解）', presetPrompt: reconstructedPrompt },
    }])
    setEdges(eds => [...eds, { id: `e_${id}_${newId}`, source: id, target: newId }])
    window.dispatchEvent(new CustomEvent('canvas-refresh'))
  }, [id, reconstructedPrompt, getNode, setNodes, setEdges])

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '4px 8px', borderRadius: 5, fontSize: 11,
    background: T.inputBg, border: `1px solid ${T.border}`,
    color: T.text, outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{
      width: 320, background: T.nodeBg, border: `1px solid ${T.border}`,
      borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      overflow: 'hidden',
    }}>
      <Handle type="target" position={Position.Left}  style={{ top: 22 }} />
      <Handle type="source" position={Position.Right} style={{ top: 22 }} />

      {/* 头部 */}
      <div className="drag-handle" style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 12px', borderBottom: `1px solid ${T.border}`,
        background: `rgba(201,152,42,0.07)`, cursor: 'grab',
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: T.accent, padding: '1px 6px', borderRadius: 3,
          background: `rgba(201,152,42,0.12)`, border: `1px solid rgba(201,152,42,0.2)`,
          flexShrink: 0,
        }}>Prompt</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.text, flex: 1, truncate: 'ellipsis' } as any}>
          结构化提示词
        </span>
      </div>

      {/* Tab 切换 */}
      <div style={{
        display: 'flex', gap: 2, padding: '6px 10px',
        borderBottom: `1px solid ${T.border}`,
        background: T.nodeSubtle,
      }}>
        {(['fields', 'json'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
            background: tab === t
              ? (theme === 'dark' ? 'rgba(201,152,42,0.18)' : 'rgba(184,135,14,0.12)')
              : 'transparent',
            color: tab === t ? T.accent : T.textSub,
            fontWeight: tab === t ? 600 : 400,
            transition: 'all 0.15s',
          }}>
            {t === 'fields' ? '字段' : 'JSON'}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="nodrag" style={{ padding: '10px 12px', maxHeight: 360, overflowY: 'auto' }}>
        {tab === 'fields' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* 人物 */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.accent, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em' }}>人物</div>
              {(analysis?.characters ?? []).map((c, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <input value={c.description ?? ''} onChange={e => handleFieldChange(`characters.${i}.description`, e.target.value)} placeholder="描述" style={inputStyle} />
                  <input value={c.position ?? ''} onChange={e => handleFieldChange(`characters.${i}.position`, e.target.value)} placeholder="位置" style={inputStyle} />
                </div>
              ))}
              {(!analysis?.characters?.length) && (
                <input value="" onChange={e => handleFieldChange('characters.0.description', e.target.value)} placeholder="无人物" style={{ ...inputStyle, opacity: 0.4 }} />
              )}
            </div>

            {/* 场景 */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.accent, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em' }}>场景</div>
              {(['location', 'era', 'time_of_day'] as const).map(k => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: T.textMuted, width: 36, flexShrink: 0 }}>{{ location:'地点', era:'时代', time_of_day:'时间' }[k]}</span>
                  <input value={analysis?.setting?.[k] ?? ''} onChange={e => handleFieldChange(`setting.${k}`, e.target.value)} style={inputStyle} />
                </div>
              ))}
            </div>

            {/* 光线 */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.accent, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em' }}>光线</div>
              {(['type', 'direction', 'tone'] as const).map(k => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: T.textMuted, width: 36, flexShrink: 0 }}>{{ type:'光源', direction:'方向', tone:'色调' }[k]}</span>
                  <input value={analysis?.lighting?.[k] ?? ''} onChange={e => handleFieldChange(`lighting.${k}`, e.target.value)} style={inputStyle} />
                </div>
              ))}
            </div>

            {/* 构图 */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.accent, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em' }}>构图</div>
              {(['shot_type', 'angle'] as const).map(k => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: T.textMuted, width: 36, flexShrink: 0 }}>{{ shot_type:'景别', angle:'角度' }[k]}</span>
                  <input value={analysis?.composition?.[k] ?? ''} onChange={e => handleFieldChange(`composition.${k}`, e.target.value)} style={inputStyle} />
                </div>
              ))}
            </div>

            {/* 风格 */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.accent, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em' }}>风格</div>
              {(['aesthetic', 'color_palette'] as const).map(k => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: T.textMuted, width: 36, flexShrink: 0 }}>{{ aesthetic:'风格', color_palette:'色调' }[k]}</span>
                  <input value={analysis?.style?.[k] ?? ''} onChange={e => handleFieldChange(`style.${k}`, e.target.value)} style={inputStyle} />
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <input type="checkbox" id={`fg_${id}`} checked={!!analysis?.style?.film_grain}
                  onChange={e => {
                    const next = JSON.parse(JSON.stringify(analysis)) as PromptAnalysis
                    next.style.film_grain = e.target.checked
                    setAnalysis(next)
                  }} />
                <label htmlFor={`fg_${id}`} style={{ fontSize: 11, color: T.textSub, cursor: 'pointer' }}>胶片质感</label>
              </div>
            </div>

          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <textarea
              value={jsonText}
              onChange={e => handleJsonChange(e.target.value)}
              style={{
                width: '100%', minHeight: 240, padding: '8px', borderRadius: 6, fontSize: 10,
                lineHeight: 1.7, fontFamily: 'monospace',
                background: T.inputBg, border: `1px solid ${jsonError ? 'rgba(255,80,60,0.5)' : T.border}`,
                color: T.text, outline: 'none', resize: 'vertical', boxSizing: 'border-box',
              }}
            />
            {jsonError && <span style={{ fontSize: 10, color: 'rgba(255,80,60,0.8)' }}>{jsonError}</span>}
          </div>
        )}
      </div>

      {/* 重组提示词预览 */}
      <div style={{ padding: '6px 12px', borderTop: `1px solid ${T.border}`, background: T.nodeSubtle }}>
        <div style={{ fontSize: 9, color: T.textMuted, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>重组提示词</div>
        <div style={{ fontSize: 10, color: T.textSub, lineHeight: 1.5 }}>
          {reconstructedPrompt || '—'}
        </div>
      </div>

      {/* 底部操作 */}
      <div style={{ padding: '8px 12px', borderTop: `1px solid ${T.border}` }}>
        <button onClick={handleGenerate} style={{
          width: '100%', padding: '8px', borderRadius: 8, fontSize: 12, fontWeight: 600,
          background: T.accent, color: theme === 'dark' ? '#0D0B08' : '#fff',
          border: 'none', cursor: 'pointer',
          boxShadow: `0 3px 12px rgba(201,152,42,0.3)`,
          transition: 'opacity 0.15s',
        }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          用此结构生图 →
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 检查**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -20
```

预期：无报错或只有不影响运行的警告

- [ ] **Step 3: commit**

```bash
git add frontend/src/nodes/PromptAnalysisNode.tsx
git commit -m "feat: add PromptAnalysisNode component with field/JSON dual view"
```

---

## Task 3: 前端 — ImageNode 新增「拆解」按钮

**Files:**
- Modify: `frontend/src/nodes/ImageNode.tsx`

- [ ] **Step 1: 替换 ImageNode.tsx 完整内容**

将 `frontend/src/nodes/ImageNode.tsx` 改为：

```tsx
import { useCallback, useState } from 'react'
import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react'
import axios from 'axios'
import EditableTitle from './EditableTitle'
import { useTheme } from '../ThemeContext'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export default function ImageNode({ id, data }: NodeProps) {
  const { base64, mimeType, prompt } = data as { base64: string; mimeType: string; prompt: string }
  const { setNodes, setEdges, getNode } = useReactFlow()
  const { T } = useTheme()
  const nodeName = (data as Record<string, unknown>)?.name as string || '图像'
  const handleRename = (v: string) =>
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, name: v } } : n))

  const imgSrc = `data:${mimeType || 'image/jpeg'};base64,${base64}`
  const [hovered,   setHovered]   = useState(false)
  const [lightbox,  setLightbox]  = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeErr, setAnalyzeErr] = useState('')

  const handleDownload = useCallback(() => {
    const a = document.createElement('a')
    a.href = imgSrc
    a.download = `${nodeName}-${Date.now()}.jpg`
    a.click()
  }, [imgSrc, nodeName])

  const handleAnalyze = useCallback(async () => {
    if (analyzing || !base64) return
    setAnalyzing(true)
    setAnalyzeErr('')
    try {
      const { data: result } = await axios.post(
        '/api/analyze-image',
        { base64, mimeType: mimeType || 'image/jpeg' },
        { headers: authHeaders() }
      )

      const self = getNode(id)
      const x = (self?.position.x ?? 0) + 260
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
      window.dispatchEvent(new CustomEvent('canvas-refresh'))
    } catch (err: any) {
      setAnalyzeErr(err.response?.data?.error || '分析失败')
      setTimeout(() => setAnalyzeErr(''), 3000)
    } finally {
      setAnalyzing(false)
    }
  }, [id, base64, mimeType, analyzing, getNode, setNodes, setEdges])

  return (
    <>
      <div
        className="flex flex-col rounded-xl overflow-hidden"
        style={{
          width: 220,
          background: T.nodeBg,
          border: `1px solid ${T.border}`,
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        }}
      >
        <Handle type="target" position={Position.Left}  style={{ top: 22 }} />
        <Handle type="source" position={Position.Right} style={{ top: 22 }} />

        {/* 头部 */}
        <div
          className="drag-handle flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing select-none"
          style={{ borderBottom: `1px solid ${T.border}` }}
        >
          <EditableTitle
            value={nodeName}
            onChange={handleRename}
            className="text-xs font-medium flex-1 truncate"
            style={{ color: T.textSub }}
          />
          {/* 拆解按钮 */}
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            title="反向拆解提示词"
            style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 4,
              background: analyzing ? `rgba(201,152,42,0.15)` : T.nodeSubtle,
              border: `1px solid ${analyzing ? 'rgba(201,152,42,0.4)' : T.border}`,
              color: analyzing ? T.accent : T.textSub,
              cursor: analyzing ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s', flexShrink: 0,
            }}
          >
            {analyzing ? (
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
            ) : '拆解'}
          </button>
          {/* 下载按钮 */}
          <button
            onClick={handleDownload}
            style={{
              fontSize: 10, padding: '2px 6px', borderRadius: 4,
              background: T.nodeSubtle, border: `1px solid ${T.border}`,
              color: T.textSub, cursor: 'pointer', flexShrink: 0,
            }}
          >↓</button>
        </div>

        {/* 错误提示 */}
        {analyzeErr && (
          <div style={{
            padding: '4px 10px', fontSize: 10, color: 'rgba(255,80,60,0.9)',
            background: 'rgba(255,80,60,0.08)', borderBottom: `1px solid rgba(255,80,60,0.15)`,
          }}>{analyzeErr}</div>
        )}

        {/* 图片 */}
        <div
          className="relative overflow-hidden"
          style={{ cursor: 'zoom-in', background: T.nodeSubtle }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => setLightbox(true)}
        >
          <img
            src={imgSrc}
            alt={prompt}
            className="w-full block"
            style={{
              maxHeight: 220, objectFit: 'contain',
              transition: 'transform 0.2s ease',
              transform: hovered ? 'scale(1.06)' : 'scale(1)',
            }}
            draggable={false}
          />
        </div>

        {/* Prompt 预览 */}
        {prompt && (
          <div style={{
            padding: '6px 10px', fontSize: 10, lineHeight: 1.5,
            color: T.textMuted, borderTop: `1px solid ${T.border}`,
            maxHeight: 44, overflow: 'hidden',
          }}>
            {prompt.slice(0, 90)}{prompt.length > 90 ? '…' : ''}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)', cursor: 'zoom-out' }}
          onClick={() => setLightbox(false)}
        >
          <img
            src={imgSrc} alt={prompt}
            style={{
              maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain',
              borderRadius: 12, boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
              animation: 'fadeInScale 0.18s ease',
            }}
            draggable={false}
          />
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: TypeScript 检查**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -20
```

预期：无报错

- [ ] **Step 3: commit**

```bash
git add frontend/src/nodes/ImageNode.tsx
git commit -m "feat: add 拆解 button to ImageNode — triggers analyze-image API"
```

---

## Task 4: 前端 — App.tsx 注册新节点 + 右键菜单

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: 导入 PromptAnalysisNode**

在 `frontend/src/App.tsx` 顶部 import 区，找到：
```tsx
import TextNode from './nodes/TextNode'
```
在其后添加：
```tsx
import PromptAnalysisNode from './nodes/PromptAnalysisNode'
```

- [ ] **Step 2: 注册节点类型**

找到：
```tsx
const nodeTypes = {
  imageGen: ImageGenNode,
  videoGen: VideoGenNode,
  imageNode: ImageNode,
  textNode: TextNode,
}
```
改为：
```tsx
const nodeTypes = {
  imageGen: ImageGenNode,
  videoGen: VideoGenNode,
  imageNode: ImageNode,
  textNode: TextNode,
  promptAnalysis: PromptAnalysisNode,
}
```

- [ ] **Step 3: 右键菜单新增选项**

找到：
```tsx
const MENU_ITEMS = [
  { type: 'imageGen', label: '生图',   desc: 'NanoBanana · 文字 / 参考图' },
  { type: 'videoGen', label: '生视频', desc: 'Sora 2 · Veo 3.1' },
  { type: 'textNode', label: '文本',   desc: '自由文字 · 便签 / 注释' },
]
```
改为：
```tsx
const MENU_ITEMS = [
  { type: 'imageGen',       label: '生图',      desc: 'NanoBanana · 文字 / 参考图' },
  { type: 'videoGen',       label: '生视频',    desc: 'Sora 2 · Veo 3.1' },
  { type: 'textNode',       label: '文本',      desc: '自由文字 · 便签 / 注释' },
  { type: 'promptAnalysis', label: '结构化提示词', desc: '反向拆解 · 可视化编辑' },
]
```

- [ ] **Step 4: TypeScript 检查 + 构建**

```bash
cd frontend
npx tsc --noEmit 2>&1
npm run build 2>&1 | tail -10
```

预期：`✓ built in X.XXs`，无报错

- [ ] **Step 5: commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: register promptAnalysis node type and add to context menu"
```

---

## Task 5: 端到端测试 + 最终 push

- [ ] **Step 1: 启动本地开发环境**

```bash
# 终端1
cd backend && node index.js
# 终端2
cd frontend && npm run dev
```

- [ ] **Step 2: 功能验证清单**

打开 http://localhost:5173，按顺序验证：

1. 登录成功，进入项目
2. 在画布上生成一张图片（通过 ImageGenNode 生图）
3. 生成的 ImageNode 头部有「拆解」按钮 ✓
4. 点击「拆解」按钮，按钮显示旋转动画 ✓
5. 几秒后 PromptAnalysisNode 出现在右侧，已连线 ✓
6. PromptAnalysisNode 显示「字段」tab，各字段有内容 ✓
7. 切换到「JSON」tab，显示完整 JSON ✓
8. 修改某个字段（如把「景别」改成「特写」），下方「重组提示词」实时更新 ✓
9. 切换到 JSON tab，修改 JSON，切回字段 tab，字段同步更新 ✓
10. 点「用此结构生图」，右侧出现 ImageGenNode，presetPrompt 有内容 ✓
11. 右键画布，菜单里有「结构化提示词」选项 ✓

- [ ] **Step 3: push 到 GitHub**

```bash
cd /d/Coding/AIGC
git push
```

---

## 自检结果

**Spec 覆盖：**
- ✅ POST /api/analyze-image（Task 1）
- ✅ qwen3-vl-flash 视觉模型（Task 1）
- ✅ PromptAnalysisNode 字段/JSON 双视图（Task 2）
- ✅ ImageNode 拆解按钮 + 自动创建节点+连线（Task 3）
- ✅ App.tsx 注册 + 右键菜单（Task 4）
- ✅ JSON→提示词重组（buildPrompt 前后端各一份，逻辑一致）
- ✅ 错误处理（analyzeErr 状态，3秒后消失）

**类型一致性：**
- `PromptAnalysis` interface 定义在 PromptAnalysisNode.tsx，ImageNode.tsx 不需要 import（直接传 data）
- `buildPrompt` 函数：后端 `buildPromptFromAnalysis()`，前端 `buildPrompt()`，逻辑相同
- `getNode(id)` 在两处（ImageNode, PromptAnalysisNode）都已引入自 `useReactFlow()`
