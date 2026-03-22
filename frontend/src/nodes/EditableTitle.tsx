import { useRef, useState } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  style?: React.CSSProperties
  className?: string
}

export default function EditableTitle({ value, onChange, style, className }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft(value)
    setEditing(true)
    setTimeout(() => { inputRef.current?.select() }, 0)
  }

  const commit = () => {
    setEditing(false)
    const v = draft.trim()
    if (v && v !== value) onChange(v)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') setEditing(false)
        }}
        className={className}
        style={{
          ...style,
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 4,
          outline: 'none',
          padding: '0 4px',
          cursor: 'text',
          minWidth: 60,
          maxWidth: 180,
        }}
        autoFocus
      />
    )
  }

  return (
    <span
      onDoubleClick={startEdit}
      className={className}
      style={{ ...style, cursor: 'default' }}
      title="双击重命名"
    >
      {value}
    </span>
  )
}
