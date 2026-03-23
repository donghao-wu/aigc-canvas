import { useState, useCallback, useRef } from 'react'
import { Handle, Position, type NodeProps, useEdges, useReactFlow } from '@xyflow/react'
import EditableTitle from './EditableTitle'
import { useTheme } from '../ThemeContext'
import axios from 'axios'

// ── 配置 ─────────────────────────────────────────────────────
// 纯文字模式用 NanoBanana
const TEXT_MODELS = [
  { id: 'midjourney',                     label: 'Midjourney',     badge: '高质量' },
  { id: 'gemini-3-pro-image-preview',     label: 'NanoBanana Pro', badge: '最优' },
  { id: 'gemini-3.1-flash-image-preview', label: 'NanoBanana 2',   badge: '快速' },
  { id: 'gemini-2.5-flash-image',         label: 'NanoBanana',     badge: '均衡' },
]

// 参考图模式不含 MJ（MJ 不支持参考图）
const REF_MODELS = [
  { id: 'gemini-3-pro-image-preview',     label: 'NanoBanana Pro', badge: '最优' },
  { id: 'gemini-3.1-flash-image-preview', label: 'NanoBanana 2',   badge: '快速' },
  { id: 'gemini-2.5-flash-image',         label: 'NanoBanana',     badge: '均衡' },
]

const RATIOS = [
  { value: '1:1',  label: '1:1'  },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3',  label: '4:3'  },
  { value: '3:4',  label: '3:4'  },
  { value: '3:2',  label: '3:2'  },
]

const SIZES = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
]

// 主题色
const C = 'rgba(16,185,129,'

// ── 参考图上传区域（支持多张，最多 4 张）────────────────────────
interface RefImageData { base64: string; mimeType: string; previewUrl: string }

const MAX_REF = 4

function RefImageList({
  values,
  onChange,
}: {
  values: RefImageData[]
  onChange: (v: RefImageData[]) => void
}) {
  const { T } = useTheme()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const readFile = (file: File): Promise<RefImageData> =>
    new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = e => {
        const dataUrl = e.target?.result as string
        const [header, base64] = dataUrl.split(',')
        const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg'
        resolve({ base64, mimeType, previewUrl: dataUrl })
      }
      reader.readAsDataURL(file)
    })

  const addFiles = async (files: FileList | null) => {
    if (!files) return
    const imgs = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, MAX_REF - values.length)
    const results = await Promise.all(imgs.map(readFile))
    onChange([...values, ...results])
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const removeAt = (i: number) => onChange(values.filter((_, idx) => idx !== i))

  const canAdd = values.length < MAX_REF

  return (
    <div className="flex flex-col gap-2">
      {/* 已上传缩略图 */}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v, i) => (
            <div
              key={i}
              className="relative rounded-lg overflow-hidden flex-shrink-0"
              style={{ width: 72, height: 72, background: '#0d0d1a', border: `1px solid ${C}0.35)` }}
            >
              <img
                src={v.previewUrl}
                alt={`参考图 ${i + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
              <button
                onClick={() => removeAt(i)}
                className="absolute top-0.5 right-0.5 flex items-center justify-center rounded-full text-xs font-bold"
                style={{ width: 18, height: 18, background: 'rgba(0,0,0,0.75)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
              >✕</button>
            </div>
          ))}
          {/* +添加按钮（内联在网格里） */}
          {canAdd && (
            <button
              onClick={() => inputRef.current?.click()}
              className="flex items-center justify-center rounded-lg text-xl flex-shrink-0 transition-all"
              style={{
                width: 72, height: 72,
                border: `1.5px dashed ${C}0.25)`,
                background: T.nodeSubtle,
                color: `${C}0.5)`,
              }}
              title="添加更多参考图"
            >＋</button>
          )}
        </div>
      )}

      {/* 拖拽上传区（无图片时显示） */}
      {values.length === 0 && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className="flex flex-col items-center justify-center gap-1.5 rounded-xl cursor-pointer transition-all select-none"
          style={{
            height: 80,
            border: `1.5px dashed ${dragging ? C + '0.6)' : C + '0.2)'}`,
            background: dragging ? C + '0.06)' : T.nodeSubtle,
            color: dragging ? '#6ee7b7' : T.textMuted,
          }}
        >
          <span className="text-xl">🖼️</span>
          <span className="text-xs">点击 / 拖拽上传参考图（最多 {MAX_REF} 张）</span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => { addFiles(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}

// ── 主组件 ───────────────────────────────────────────────────
export default function ImageGenNode({ id, data }: NodeProps) {
  const { T } = useTheme()
  const nodeName = (data as Record<string, unknown>)?.name as string || 'NanoBanana 生图'
  const [mode,        setMode]        = useState<'text' | 'ref'>('text')
  const [prompt,      setPrompt]      = useState(() => (data as Record<string, unknown>)?.presetPrompt as string || '')
  const [model,       setModel]       = useState('gemini-3-pro-image-preview')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [imageSize,   setImageSize]   = useState('1K')
  const [refImages,   setRefImages]   = useState<RefImageData[]>([])
  const [loading,     setLoading]     = useState(false)
  const [imageData,   setImageData]   = useState<string | null>(null)
  const [mimeType,    setMimeType]    = useState('image/png')
  const [error,       setError]       = useState<string | null>(null)

  const edges = useEdges()
  const { setNodes, setEdges, getNodes } = useReactFlow()
  const handleRename = (v: string) =>
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, name: v } } : n))

  // 从连线的 ImageNode 中读取图片作为参考
  const connectedRefs = edges
    .filter(e => e.target === id)
    .map(e => getNodes().find(n => n.id === e.source))
    .filter(n => n?.type === 'imageNode' && (n.data as Record<string,unknown>)?.base64)
    .map(n => {
      const d = n!.data as { base64: string; mimeType: string }
      return { base64: d.base64, mimeType: d.mimeType || 'image/jpeg' }
    })

  // 从连线的 TextNode 中读取文本作为 prompt
  const connectedTexts = edges
    .filter(e => e.target === id)
    .map(e => getNodes().find(n => n.id === e.source))
    .filter(n => n?.type === 'textNode')
    .map(n => ((n!.data as Record<string,unknown>)?.content as string) || '')
    .filter(t => t.trim().length > 0)

  // 有连接文本节点时，自动合并为 prompt；否则用本地输入
  const effectivePrompt = connectedTexts.length > 0
    ? connectedTexts.join('\n\n')
    : prompt

  const handleModeChange = (m: 'text' | 'ref') => {
    setMode(m)
    setModel('gemini-3-pro-image-preview')
    setError(null)
  }

  const currentModels = mode === 'text' ? TEXT_MODELS : REF_MODELS

  // 连线图片 + 手动上传图片 合并
  const allRefImages = [...connectedRefs, ...refImages.map(r => ({ base64: r.base64, mimeType: r.mimeType }))]

  const canGenerate = !!effectivePrompt.trim() && (mode === 'text' || allRefImages.length > 0) && !loading

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return

    setLoading(true)
    setError(null)
    setImageData(null)

    try {
      const payload: Record<string, unknown> = {
        prompt: effectivePrompt.trim(),
        model,
        aspectRatio,
        imageSize,
      }

      if (allRefImages.length > 0) {
        payload.referenceImages = allRefImages
      }

      const { data } = await axios.post('/api/generate-image', payload)

      if (data?.base64) {
        const resultBase64 = data.base64
        const resultMime   = data.mimeType || 'image/jpeg'
        setImageData(resultBase64)
        setMimeType(resultMime)
        window.dispatchEvent(new Event('gallery-refresh'))

        // 自动在右侧创建 ImageNode 并连线
        const self  = getNodes().find(n => n.id === id)
        const pos   = self?.position ?? { x: 200, y: 200 }
        const newId = `img_${Date.now()}`
        setNodes(nds => [...nds, {
          id: newId,
          type: 'imageNode',
          position: { x: pos.x + 380, y: pos.y },
          data: { base64: resultBase64, mimeType: resultMime, prompt: effectivePrompt.trim() },
        }])
        setEdges(eds => [...eds, {
          id: `e_${id}_${newId}`,
          source: id,
          target: newId,
          type: 'default',
        }])
      } else {
        setError('未获取到图片数据，请重试')
      }
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data?.error ?? err.message)
        : (err instanceof Error ? err.message : '生成失败')
      setError(String(msg))
    } finally {
      setLoading(false)
    }
  }, [effectivePrompt, model, aspectRatio, imageSize, allRefImages, canGenerate, id, getNodes, setNodes, setEdges])

  return (
    <div
      className="relative flex flex-col rounded-xl overflow-hidden"
      style={{
        width: 320,
        background: T.nodeBg,
        border: `1px solid ${T.border}`,
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      <Handle type="target" position={Position.Left}  style={{ top: 36 }} />
      <Handle type="source" position={Position.Right} style={{ top: 36 }} />

      {/* 头部 */}
      <div
        className="drag-handle flex items-center gap-2 px-3 py-2.5 cursor-grab active:cursor-grabbing select-none"
        style={{ borderBottom: `1px solid ${T.border}` }}
      >
        <EditableTitle
          value={nodeName}
          onChange={handleRename}
          className="text-xs font-medium flex-1"
          style={{ color: T.text }}
        />
        <span style={{ fontSize: 10, color: T.textMuted, fontFamily: 'monospace' }}>#{id}</span>
      </div>

      {/* 主体 */}
      <div className="flex flex-col gap-2.5 p-3">

        {/* 模式切换 */}
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: `1px solid ${T.border}`, background: T.nodeSubtle }}>
          {(['text', 'ref'] as const).map(m => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              style={{
                flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 500,
                background: mode === m ? T.border : 'transparent',
                color: mode === m ? T.text : T.textSub,
                border: 'none', cursor: 'pointer',
                borderRight: m === 'text' ? `1px solid ${T.border}` : 'none',
                transition: 'all 0.15s',
              }}
            >
              {m === 'text' ? '文字生图' : '参考图生图'}
            </button>
          ))}
        </div>

        {/* 连线参考图预览 */}
        {connectedRefs.length > 0 && (
          <div style={{ borderRadius: 6, padding: '8px 10px', background: T.nodeSubtle, border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 10, color: T.textSub, marginBottom: 6 }}>
              连线参考图 · {connectedRefs.length} 张
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {connectedRefs.map((r, i) => (
                <img
                  key={i}
                  src={`data:${r.mimeType};base64,${r.base64}`}
                  alt={`ref-${i}`}
                  style={{ width: 48, height: 48, borderRadius: 4, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.1)' }}
                  draggable={false}
                />
              ))}
            </div>
          </div>
        )}

        {/* 参考图上传 */}
        {mode === 'ref' && (
          <RefImageList values={refImages} onChange={setRefImages} />
        )}

        {/* Prompt */}
        {connectedTexts.length > 0 ? (
          <div style={{
            padding: '8px 10px', borderRadius: 6, fontSize: 12,
            background: T.nodeSubtle,
            border: `1px solid ${T.borderMid}`,
            color: T.text, lineHeight: 1.6,
            position: 'relative',
          }}>
            <div style={{
              fontSize: 9, fontWeight: 600, letterSpacing: '0.07em',
              textTransform: 'uppercase', color: T.textMuted,
              marginBottom: 5,
            }}>
              来自文本节点 · {connectedTexts.length} 个
            </div>
            <div style={{
              color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 80, overflow: 'hidden',
            }}>
              {effectivePrompt.slice(0, 200)}{effectivePrompt.length > 200 ? '…' : ''}
            </div>
          </div>
        ) : (
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate() }}
            placeholder={mode === 'ref' ? '描述想要的效果...' : '描述想要的图片... (Ctrl+Enter)'}
            rows={3}
            className="w-full resize-none outline-none"
            style={{
              padding: '8px 10px', borderRadius: 6, fontSize: 12,
              background: T.inputBg,
              border: `1px solid ${T.border}`,
              color: T.text,
              lineHeight: 1.6, transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.target.style.borderColor = 'rgba(255,255,255,0.2)')}
            onBlur={e  => (e.target.style.borderColor = T.border)}
          />
        )}

        {/* 模型选择 */}
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          className="w-full outline-none cursor-pointer"
          style={{
            padding: '6px 8px', borderRadius: 6, fontSize: 11,
            background: T.inputBg,
            border: `1px solid ${T.border}`,
            color: T.text,
          }}
        >
          {currentModels.map(m => (
            <option key={m.id} value={m.id} style={{ background: T.nodeBg }}>
              {m.label} · {m.badge}
            </option>
          ))}
        </select>

        {/* 比例 */}
        <div>
          <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 5 }}>比例</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {RATIOS.map(r => (
              <button
                key={r.value}
                onClick={() => setAspectRatio(r.value)}
                style={{
                  padding: '3px 8px', borderRadius: 4, fontSize: 11,
                  background: aspectRatio === r.value ? T.borderMid : T.inputBg,
                  border: `1px solid ${aspectRatio === r.value ? T.borderMid : T.border}`,
                  color: aspectRatio === r.value ? T.text : T.textSub,
                  cursor: 'pointer', transition: 'all 0.1s',
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* 分辨率 */}
        <div>
          <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 5 }}>分辨率</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {SIZES.map(s => (
              <button
                key={s.value}
                onClick={() => setImageSize(s.value)}
                style={{
                  flex: 1, padding: '4px 0', borderRadius: 4, fontSize: 11,
                  background: imageSize === s.value ? T.borderMid : T.inputBg,
                  border: `1px solid ${imageSize === s.value ? T.borderMid : T.border}`,
                  color: imageSize === s.value ? T.text : T.textSub,
                  cursor: 'pointer', transition: 'all 0.1s',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 生成按钮 */}
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          style={{
            width: '100%', padding: '8px 0', borderRadius: 6,
            fontSize: 12, fontWeight: 500,
            background: canGenerate ? T.btnBg : T.inputBg,
            color: canGenerate ? T.btnText : T.textMuted,
            border: 'none', cursor: canGenerate ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s',
          }}
        >
          {loading ? '生成中...' : '生成图片'}
        </button>

        {/* 错误提示 */}
        {error && (
          <div style={{
            fontSize: 11, padding: '7px 10px', borderRadius: 6,
            background: 'rgba(255,59,48,0.08)',
            border: '1px solid rgba(255,59,48,0.2)',
            color: 'rgba(255,100,90,0.9)',
          }}>
            {error}
          </div>
        )}

        {/* 加载动画 */}
        {loading && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 10, height: 100,
            background: T.nodeSubtle, borderRadius: 6,
            border: `1px solid ${T.border}`,
          }}>
            <div style={{
              width: 18, height: 18,
              border: '1.5px solid rgba(255,255,255,0.1)',
              borderTopColor: 'rgba(255,255,255,0.6)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <span style={{ fontSize: 11, color: T.textMuted }}>生成中，通常需要 10–30 秒</span>
          </div>
        )}

        {/* 生成成功提示 */}
        {imageData && !loading && (
          <div style={{
            fontSize: 11, padding: '6px 10px', borderRadius: 6, textAlign: 'center',
            background: T.inputBg,
            border: `1px solid ${T.border}`,
            color: 'rgba(255,255,255,0.4)',
          }}>
            已生成 · 见右侧节点
          </div>
        )}
      </div>
    </div>
  )
}
