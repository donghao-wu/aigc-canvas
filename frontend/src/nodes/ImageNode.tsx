import { useCallback, useState } from 'react'
import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react'
import EditableTitle from './EditableTitle'
import { useTheme } from '../ThemeContext'

export default function ImageNode({ id, data }: NodeProps) {
  const { base64, mimeType, prompt } = data as { base64: string; mimeType: string; prompt: string }
  const { setNodes } = useReactFlow()
  const { T } = useTheme()
  const nodeName   = (data as Record<string, unknown>)?.name as string || '图像'
  const handleRename = (v: string) =>
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, name: v } } : n))

  const imgSrc = `data:${mimeType || 'image/jpeg'};base64,${base64}`
  const [hovered,  setHovered]  = useState(false)
  const [lightbox, setLightbox] = useState(false)

  const handleDownload = useCallback(() => {
    const a = document.createElement('a')
    a.href = imgSrc
    a.download = `${nodeName}-${Date.now()}.jpg`
    a.click()
  }, [imgSrc, nodeName])

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
          <button
            onClick={handleDownload}
            style={{
              fontSize: 10, padding: '2px 6px', borderRadius: 4,
              background: T.nodeSubtle,
              border: `1px solid ${T.border}`,
              color: T.textSub, cursor: 'pointer',
            }}
          >↓</button>
        </div>

        {/* 图片：悬停放大，点击打开 lightbox */}
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
              maxHeight: 220,
              objectFit: 'contain',
              transition: 'transform 0.2s ease',
              transform: hovered ? 'scale(1.06)' : 'scale(1)',
            }}
            draggable={false}
          />
        </div>

        {/* Prompt */}
        {prompt && (
          <div
            style={{
              padding: '6px 10px', fontSize: 10, lineHeight: 1.5,
              color: T.textMuted,
              borderTop: `1px solid ${T.border}`,
              maxHeight: 44, overflow: 'hidden',
            }}
          >
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
            src={imgSrc}
            alt={prompt}
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              objectFit: 'contain',
              borderRadius: 12,
              boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
              animation: 'fadeInScale 0.18s ease',
            }}
            draggable={false}
          />
        </div>
      )}
    </>
  )
}
