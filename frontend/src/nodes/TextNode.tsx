import { useState, useRef, useEffect } from 'react'
import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react'
import EditableTitle from './EditableTitle'
import { useTheme } from '../ThemeContext'

export default function TextNode({ id, data }: NodeProps) {
  const { T } = useTheme()
  const { setNodes } = useReactFlow()
  const nodeName = (data as Record<string, unknown>)?.name as string || '文本'
  const content  = (data as Record<string, unknown>)?.content as string || ''

  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleRename = (v: string) =>
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, name: v } } : n))

  const handleContentChange = (v: string) =>
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, content: v } } : n))

  // 自动聚焦 textarea 进入编辑模式
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [editing])

  // 自动高度
  const autoResize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.max(80, el.scrollHeight) + 'px'
  }

  return (
    <div
      style={{
        width: 240,
        background: T.nodeBg,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        overflow: 'hidden',
      }}
    >
      <Handle type="target" position={Position.Left}  style={{ top: 22 }} />
      <Handle type="source" position={Position.Right} style={{ top: 22 }} />

      {/* 头部 */}
      <div
        className="drag-handle flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing select-none"
        style={{ borderBottom: `1px solid ${T.border}` }}
      >
        {/* 类型标签 */}
        <span style={{
          fontSize: 9, fontWeight: 600, letterSpacing: '0.07em',
          textTransform: 'uppercase', color: T.textMuted,
          padding: '1px 5px', borderRadius: 3,
          background: T.nodeSubtle, flexShrink: 0,
        }}>
          Text
        </span>
        <EditableTitle
          value={nodeName}
          onChange={handleRename}
          className="text-xs font-medium flex-1 truncate"
          style={{ color: T.textSub }}
        />
        {/* 编辑 / 完成 按钮 */}
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={() => setEditing(v => !v)}
          style={{
            fontSize: 10, padding: '2px 6px', borderRadius: 4, flexShrink: 0,
            background: editing ? T.btnBg : T.nodeSubtle,
            border: `1px solid ${T.border}`,
            color: editing ? T.btnText : T.textSub,
            cursor: 'pointer',
          }}
        >
          {editing ? '完成' : '编辑'}
        </button>
      </div>

      {/* 内容区 */}
      <div
        className="nodrag"
        style={{ padding: '10px 12px', minHeight: 80 }}
        onDoubleClick={() => setEditing(true)}
      >
        {editing ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => { handleContentChange(e.target.value); autoResize() }}
            onBlur={() => setEditing(false)}
            onInput={autoResize}
            placeholder="在此输入文字..."
            style={{
              width: '100%',
              minHeight: 80,
              resize: 'none',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 13,
              lineHeight: 1.65,
              color: T.text,
              fontFamily: 'inherit',
              padding: 0,
            }}
          />
        ) : (
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.65,
              color: content ? T.text : T.textMuted,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              minHeight: 80,
              cursor: 'text',
              userSelect: 'none',
            }}
          >
            {content || '双击或点击「编辑」输入文字'}
          </div>
        )}
      </div>

      {/* 底部字数提示 */}
      {content.length > 0 && (
        <div style={{
          borderTop: `1px solid ${T.border}`,
          padding: '4px 12px',
          fontSize: 10,
          color: T.textMuted,
          textAlign: 'right',
        }}>
          {content.length} 字
        </div>
      )}
    </div>
  )
}
