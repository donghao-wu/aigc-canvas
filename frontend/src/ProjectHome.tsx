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

export default function ProjectHome({ onOpen }: Props) {
  const { theme, T, toggle } = useTheme()
  const SEP = <div style={{ height: 1, background: T.border, margin: '24px 0' }} />
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [creating, setCreating] = useState(false)
  const [newName,  setNewName]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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

  return (
    <div style={{ minHeight: '100vh', background: T.canvasBg, color: T.text, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

      {/* 顶栏 */}
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 40px', borderBottom: `1px solid ${T.border}` }}>
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.02em', color: T.text }}>Studio</span>
        <button
          onClick={toggle}
          style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: T.textSub }}
        >{theme === 'dark' ? '◑ 浅色' : '◑ 深色'}</button>
      </div>

      {/* 主内容 */}
      <div style={{ width: '100%', maxWidth: 860, padding: '64px 32px', display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* 标题 */}
        <h1 style={{ fontSize: 28, fontWeight: 600, color: T.text, letterSpacing: '-0.02em', lineHeight: 1.2 }}>Studio</h1>
        <p style={{ marginTop: 6, fontSize: 13, color: T.textSub }}>选择项目继续创作，或开始一个新项目</p>

        {SEP}

        {/* 新建按钮 / 输入框 */}
        {!creating ? (
          <button
            onClick={() => setCreating(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '9px 16px', borderRadius: 8,
              background: T.nodeSubtle,
              border: `1px solid ${T.border}`,
              color: T.textSub, fontSize: 13, cursor: 'pointer',
              transition: 'background 0.15s',
              width: 'fit-content',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = T.inputBg)}
            onMouseLeave={e => (e.currentTarget.style.background = T.nodeSubtle)}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
            新建项目
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                padding: '9px 12px', borderRadius: 8, fontSize: 13,
                background: T.inputBg,
                border: `1px solid ${T.borderMid}`,
                color: T.text, outline: 'none', width: 220,
              }}
            />
            <button
              onClick={handleCreate}
              disabled={loading}
              style={{
                padding: '9px 14px', borderRadius: 8, fontSize: 13,
                background: T.btnBg, color: T.btnText,
                border: 'none', cursor: 'pointer', fontWeight: 500,
              }}
            >{loading ? '创建中' : '创建'}</button>
            <button
              onClick={() => { setCreating(false); setNewName('') }}
              style={{ padding: '9px 14px', borderRadius: 8, fontSize: 13, background: 'transparent', border: 'none', color: T.textMuted, cursor: 'pointer' }}
            >取消</button>
          </div>
        )}

        {/* 项目列表 */}
        {projects.length > 0 && (
          <>
            {SEP}
            <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: T.textMuted, marginBottom: 14 }}>最近</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {projects.map(p => (
                <div
                  key={p.id}
                  onClick={() => onOpen({ id: p.id, name: p.name })}
                  className="group"
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 12,
                    padding: '16px 18px', borderRadius: 10, cursor: 'pointer',
                    background: T.nodeSubtle,
                    border: `1px solid ${T.border}`,
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = T.borderMid
                    e.currentTarget.style.background  = T.inputBg
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = T.border
                    e.currentTarget.style.background  = T.nodeSubtle
                  }}
                >
                  {/* 预览占位 */}
                  <div style={{ height: 72, borderRadius: 6, background: T.nodeSubtle }} />

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{p.name}</span>
                    <span style={{ fontSize: 11, color: T.textMuted }}>
                      {p.nodeCount} 个节点 · {timeAgo(p.updatedAt)}
                    </span>
                  </div>

                  <button
                    onClick={e => handleDelete(e, p.id)}
                    style={{
                      alignSelf: 'flex-end', padding: '3px 8px', borderRadius: 5,
                      background: 'transparent', border: 'none',
                      fontSize: 11, color: 'rgba(255,69,58,0.5)', cursor: 'pointer',
                      opacity: 0, transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,69,58,0.9)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,69,58,0.5)')}
                    className="group-hover:opacity-100"
                  >删除</button>
                </div>
              ))}
            </div>
          </>
        )}

        {projects.length === 0 && !creating && (
          <p style={{ marginTop: 40, fontSize: 13, color: T.textMuted }}>还没有项目</p>
        )}
      </div>
    </div>
  )
}
