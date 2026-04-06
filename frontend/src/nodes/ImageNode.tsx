import { useCallback, useState } from 'react'
import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react'
import axios from 'axios'
import EditableTitle from './EditableTitle'
import { useTheme } from '../ThemeContext'

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
  const [hovered,    setHovered]    = useState(false)
  const [lightbox,   setLightbox]   = useState(false)
  const [analyzing,  setAnalyzing]  = useState(false)
  const [analyzeErr, setAnalyzeErr] = useState('')

  const handleDownload = useCallback(() => {
    const a = document.createElement('a')
    a.href = imgSrc
    a.download = `${nodeName}-${Date.now()}.jpg`
    if (imageUrl) a.target = '_blank'
    a.click()
  }, [imgSrc, nodeName, imageUrl])

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
            disabled={analyzing || (!base64 && !imageUrl)}
            title="反向拆解提示词"
            style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 4,
              background: analyzing ? 'rgba(201,152,42,0.15)' : T.nodeSubtle,
              border: `1px solid ${analyzing ? 'rgba(201,152,42,0.4)' : T.border}`,
              color: analyzing ? 'rgba(201,152,42,0.9)' : T.textSub,
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
            background: 'rgba(255,80,60,0.08)', borderBottom: '1px solid rgba(255,80,60,0.15)',
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
