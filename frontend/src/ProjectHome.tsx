import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { useTheme } from './ThemeContext'

interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  nodeCount: number
}

interface Props {
  onOpen: (p: { id: string; name: string }) => void
  username?: string
  onLogout?: () => void
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

export default function ProjectHome({ onOpen, username, onLogout }: Props) {
  const { theme, T, toggle } = useTheme()
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [creating, setCreating] = useState(false)
  const [newName,  setNewName]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const [hoveredId,   setHoveredId]   = useState<string | null>(null)

  const load = () => axios.get('/api/projects').then(r => setProjects(r.data))
  useEffect(() => { load() }, [])
  useEffect(() => { if (creating) setTimeout(() => inputRef.current?.focus(), 40) }, [creating])

  const handleCreate = async () => {
    setLoading(true)
    const { data } = await axios.post('/api/projects', { name: newName.trim() || '未命名项目' })
    setLoading(false); setCreating(false); setNewName('')
    onOpen({ id: data.id, name: data.name })
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!confirm('删除后不可恢复，确认删除？')) return
    await axios.delete(`/api/projects/${id}`)
    load()
  }

  const startEdit = (e: React.MouseEvent, p: ProjectMeta) => {
    e.stopPropagation()
    setEditingId(p.id)
    setEditingName(p.name)
    setTimeout(() => { editInputRef.current?.focus(); editInputRef.current?.select() }, 40)
  }

  const commitEdit = async (id: string) => {
    const name = editingName.trim()
    if (name && name !== projects.find(p => p.id === id)?.name) {
      await axios.put(`/api/projects/${id}`, { name })
      load()
    }
    setEditingId(null)
  }

  const topbarBtnStyle: React.CSSProperties = {
    fontSize: 13,
    padding: '6px 14px',
    borderRadius: 999,
    background: T.nodeSubtle,
    border: `1px solid ${T.border}`,
    cursor: 'pointer',
    color: T.textSub,
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: T.canvasBg,
      color: T.text,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      overflowY: 'auto',
    }}>

      {/* ── 顶栏 ─────────────────────────────── */}
      <div style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 36px',
        borderBottom: `1px solid ${T.border}`,
        backdropFilter: 'blur(20px)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: T.headerBg,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{
            width: 30, height: 30,
            borderRadius: 8,
            background: `rgba(201,152,42,0.12)`,
            border: `1px solid rgba(201,152,42,0.2)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img src="/logo.svg" style={{ width: 18, height: 18 }} />
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: '-0.01em' }}>壹镜</span>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={toggle} className="btn-pill" style={topbarBtnStyle}>
            {theme === 'dark' ? '◑ 浅色' : '◑ 深色'}
          </button>
          {username && (
            <div style={{
              fontSize: 13, fontWeight: 500, color: T.textSub,
              padding: '6px 14px', borderRadius: 999,
              background: T.nodeSubtle, border: `1px solid ${T.border}`,
            }}>
              {username}
            </div>
          )}
          {onLogout && (
            <button onClick={onLogout} className="btn-pill" style={topbarBtnStyle}>
              退出 →
            </button>
          )}
        </div>
      </div>

      {/* ── 主内容 ───────────────────────────── */}
      <div style={{
        width: '100%',
        maxWidth: 900,
        padding: '56px 32px 80px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}>

        {/* Hero */}
        <div className="animate-fadeIn" style={{ marginBottom: 40 }}>
          <h1 style={{
            fontSize: 36,
            fontWeight: 700,
            color: T.text,
            letterSpacing: '-0.025em',
            lineHeight: 1.15,
          }}>项目</h1>
          <p style={{ marginTop: 8, fontSize: 14, color: T.textSub }}>
            选择项目继续创作，或开始一个新项目
          </p>
        </div>

        {/* 新建按钮 / 输入框 */}
        {!creating ? (
          <button
            onClick={() => setCreating(true)}
            className="btn-pill"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 18px', borderRadius: 10,
              background: T.nodeSubtle,
              border: `1px solid ${T.borderMid}`,
              color: T.text, fontSize: 14, fontWeight: 500, cursor: 'pointer',
              width: 'fit-content',
            }}
          >
            <span style={{
              width: 18, height: 18,
              borderRadius: 5,
              background: `rgba(201,152,42,0.15)`,
              border: `1px solid rgba(201,152,42,0.25)`,
              color: T.accent,
              fontSize: 14, fontWeight: 400,
              display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
              flexShrink: 0,
            }}>+</span>
            新建项目
          </button>
        ) : (
          <div className="animate-fadeIn" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              ref={inputRef}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') { setCreating(false); setNewName('') }
              }}
              placeholder="项目名称"
              style={{
                padding: '9px 13px', borderRadius: 9, fontSize: 14,
                background: T.inputBg,
                border: `1px solid ${T.borderMid}`,
                color: T.text, outline: 'none', width: 220,
              }}
            />
            <button
              onClick={handleCreate}
              disabled={loading}
              className="btn-pill"
              style={{
                padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600,
                background: T.accent, color: theme === 'dark' ? '#0D0B08' : '#fff',
                border: 'none', cursor: 'pointer',
                boxShadow: `0 4px 16px rgba(201,152,42,0.25)`,
              }}
            >{loading ? '创建中' : '创建'}</button>
            <button
              onClick={() => { setCreating(false); setNewName('') }}
              className="btn-pill"
              style={{
                padding: '9px 14px', borderRadius: 9, fontSize: 13,
                background: T.nodeSubtle, border: `1px solid ${T.border}`,
                color: T.textSub, cursor: 'pointer',
              }}
            >取消</button>
          </div>
        )}

        {/* 项目列表 */}
        {projects.length > 0 && (
          <>
            <div style={{ height: 1, background: T.border, margin: '32px 0 24px' }} />
            <p style={{
              fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em',
              color: T.textMuted, marginBottom: 16, fontWeight: 600,
            }}>最近</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {projects.map((p, i) => (
                <div
                  key={p.id}
                  onClick={() => onOpen({ id: p.id, name: p.name })}
                  className="btn-pill"
                  style={{
                    display: 'flex', flexDirection: 'column',
                    borderRadius: 12, cursor: 'pointer',
                    background: T.nodeBg,
                    border: `1px solid ${hoveredId === p.id ? T.borderMid : T.border}`,
                    overflow: 'hidden',
                    animation: `slideInUp 0.28s ease ${i * 0.04}s both`,
                  }}
                  onMouseEnter={() => setHoveredId(p.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* 预览区 */}
                  <div style={{
                    height: 80,
                    background: hoveredId === p.id
                      ? `linear-gradient(135deg, rgba(201,152,42,0.08) 0%, rgba(201,152,42,0.03) 100%)`
                      : T.nodeSubtle,
                    borderBottom: `1px solid ${T.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.2s',
                  }}>
                    <span style={{ fontSize: 22, opacity: hoveredId === p.id ? 0.3 : 0.12, transition: 'opacity 0.2s' }}>⊕</span>
                  </div>

                  {/* 信息区 */}
                  <div style={{ padding: '12px 14px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {editingId === p.id ? (
                      <input
                        ref={editInputRef}
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitEdit(p.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        onBlur={() => commitEdit(p.id)}
                        onClick={e => e.stopPropagation()}
                        style={{
                          fontSize: 13, fontWeight: 500, color: T.text,
                          background: T.inputBg, border: `1px solid ${T.borderMid}`,
                          borderRadius: 5, padding: '2px 7px', outline: 'none', width: '100%',
                        }}
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{
                          fontSize: 13, fontWeight: 600, color: T.text,
                          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{p.name}</span>
                        <button
                          onClick={e => startEdit(e, p)}
                          style={{
                            opacity: hoveredId === p.id ? 0.7 : 0,
                            padding: '1px 5px', background: 'none', border: 'none',
                            color: T.textSub, cursor: 'pointer', fontSize: 11, borderRadius: 4,
                            flexShrink: 0, transition: 'opacity 0.15s',
                          }}
                          title="重命名"
                        >✎</button>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, color: T.textMuted }}>
                        {p.nodeCount} 个节点 · {timeAgo(p.updatedAt)}
                      </span>
                      <button
                        onClick={e => handleDelete(e, p.id)}
                        style={{
                          padding: '2px 6px', borderRadius: 4,
                          background: 'transparent', border: 'none',
                          fontSize: 10, color: 'rgba(255,80,60,0.45)', cursor: 'pointer',
                          opacity: hoveredId === p.id ? 1 : 0,
                          transition: 'opacity 0.15s, color 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,80,60,0.85)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,80,60,0.45)')}
                      >删除</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {projects.length === 0 && !creating && (
          <p style={{ marginTop: 48, fontSize: 13, color: T.textMuted }}>还没有项目</p>
        )}
      </div>
    </div>
  )
}
