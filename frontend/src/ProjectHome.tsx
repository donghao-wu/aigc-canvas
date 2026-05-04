import { useEffect, useRef, useState, useCallback } from 'react'
import axios from 'axios'
import { useTheme } from './ThemeContext'

interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  nodeCount: number
  pipelineStage?: string
  memberCount?: number
  stagesCompleted?: string[]
}

// Pipeline stages in order
const PIPELINE_STAGES = [
  'story_bible', 'character_bios', 'asset_registry',
  'episode_map', 'episodes', 'image_gen', 'video_gen',
]
const STAGE_LABEL: Record<string, string> = {
  story_bible:    '故事圣经',
  character_bios: '角色小传',
  asset_registry: '资产登记',
  episode_map:    '集数大纲',
  episodes:       '逐集剧本',
  image_gen:      '生图',
  video_gen:      '视频',
}

interface DashboardData {
  global: {
    totalProjects: number
    totalAssets: number
    totalImages: number
    totalTokens: number
    estimatedCost: number
  }
  projects: Array<{
    id: string
    name: string
    pipelineStage: string
    stagesCompleted: string[]
    memberCount: number
    agentCallCount: number
    tokenUsed: number
    imageGenCount: number
    updatedAt: string
  }>
}

import type { DbAsset } from './types/asset'
import { TYPE_LABEL, TYPE_COLOR } from './types/asset'

function authHeaders() {
  const token = localStorage.getItem('auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

interface Props {
  onOpen: (p: { id: string; name: string }) => void
  username?: string
  onLogout?: () => void
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return String(n)
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

  // ── Dashboard ─────────────────────────────────────────────────
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const loadDashboard = useCallback(async () => {
    try {
      const { data } = await axios.get<DashboardData>('/api/dashboard', { headers: authHeaders() })
      setDashboard(data)
    } catch { /* non-critical */ }
  }, [])

  // ── 资产库 ────────────────────────────────────────────────────
  const [globalAssets,  setGlobalAssets]  = useState<DbAsset[]>([])
  const [recentAssets,  setRecentAssets]  = useState<DbAsset[]>([])
  const [previewAsset,  setPreviewAsset]  = useState<DbAsset | null>(null)
  const [assetFilter,   setAssetFilter]   = useState<DbAsset['type'] | 'ALL'>('ALL')
  const [copiedPrompt,  setCopiedPrompt]  = useState(false)
  const [promotingId,   setPromotingId]   = useState<string | null>(null)

  const loadAssets = useCallback(async () => {
    try {
      const headers = authHeaders()
      const [globalRes, recentRes] = await Promise.all([
        axios.get('/api/assets?projectId=__global__', { headers }),
        // fetch all project IDs then load their assets — simplified: just load global for now
        // Recent = last 12 assets across all user projects (approximated by createdAt)
        axios.get('/api/assets?projectId=__global__', { headers }),
      ])
      setGlobalAssets(globalRes.data)
      setRecentAssets([]) // populated incrementally below
    } catch { /* non-critical */ }
  }, [])

  const load = async () => {
    const [projRes, dashRes] = await Promise.allSettled([
      axios.get('/api/projects', { headers: authHeaders() }),
      axios.get<DashboardData>('/api/dashboard', { headers: authHeaders() }),
    ])
    const projects: ProjectMeta[] = projRes.status === 'fulfilled' ? projRes.value.data : []
    if (dashRes.status === 'fulfilled') {
      setDashboard(dashRes.value.data)
      const byId = Object.fromEntries(dashRes.value.data.projects.map(p => [p.id, p]))
      setProjects(projects.map(p => ({
        ...p,
        pipelineStage:    byId[p.id]?.pipelineStage,
        memberCount:      byId[p.id]?.memberCount,
        stagesCompleted:  byId[p.id]?.stagesCompleted,
      })))
    } else {
      setProjects(projects)
    }
  }

  useEffect(() => {
    load()
    loadAssets()
  }, [])
  useEffect(() => { if (creating) setTimeout(() => inputRef.current?.focus(), 40) }, [creating])

  const handleCreate = async () => {
    setLoading(true)
    const { data } = await axios.post('/api/projects', { name: newName.trim() || '未命名项目' }, { headers: authHeaders() })
    setLoading(false); setCreating(false); setNewName('')
    onOpen({ id: data.id, name: data.name })
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!confirm('删除后不可恢复，确认删除？')) return
    await axios.delete(`/api/projects/${id}`, { headers: authHeaders() })
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
      await axios.put(`/api/projects/${id}`, { name }, { headers: authHeaders() })
      load()
    }
    setEditingId(null)
  }

  // 把项目级资产提升到全局库
  const promoteToGlobal = async (asset: DbAsset) => {
    if (promotingId) return
    setPromotingId(asset.id)
    try {
      await axios.post('/api/assets', {
        projectId: '__global__',
        type: asset.type,
        name: asset.name,
        description: asset.description,
        prompt: asset.prompt,
        imageUrl: asset.imageUrl,
        tags: asset.tags,
      }, { headers: authHeaders() })
      await loadAssets()
    } catch { /* ignore */ } finally {
      setPromotingId(null)
    }
  }

  const copyPrompt = async (prompt: string) => {
    try { await navigator.clipboard.writeText(prompt); setCopiedPrompt(true); setTimeout(() => setCopiedPrompt(false), 1500) } catch {}
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

      {/* ── 统计条 ──────────────────────────── */}
      {dashboard?.global && (
        <div style={{
          width: '100%',
          background: theme === 'dark' ? 'rgba(201,152,42,0.04)' : 'rgba(184,135,14,0.03)',
          borderBottom: `1px solid ${T.border}`,
          display: 'flex', justifyContent: 'center',
        }}>
          <div style={{
            maxWidth: 900, width: '100%',
            padding: '10px 32px',
            display: 'flex', gap: 32, alignItems: 'center',
          }}>
            {[
              { label: '项目', value: dashboard.global.totalProjects, icon: '📁' },
              { label: '资产', value: dashboard.global.totalAssets,   icon: '🗃️' },
              { label: '图片', value: dashboard.global.totalImages,   icon: '🖼️' },
              { label: 'Token', value: fmtNum(dashboard.global.totalTokens), icon: '⚡' },
              { label: '费用', value: `¥${dashboard.global.estimatedCost.toFixed(2)}`, icon: '💰' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, opacity: 0.6 }}>{item.icon}</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: T.text, lineHeight: 1 }}>
                  {item.value}
                </span>
                <span style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
                    {/* Pipeline progress bar */}
                    {(p.stagesCompleted || p.pipelineStage) && (
                      <PipelineProgress
                        stage={p.pipelineStage || ''}
                        completed={p.stagesCompleted || []}
                        T={T}
                      />
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                      <span style={{ fontSize: 11, color: T.textMuted }}>
                        {p.nodeCount} 节点
                        {p.memberCount && p.memberCount > 1 ? ` · 👥 ${p.memberCount}` : ''}
                        {' · '}{timeAgo(p.updatedAt)}
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

        {/* ── 全局资产库 ─────────────────────────────── */}
        {globalAssets.length > 0 && (
          <>
            <div style={{ height: 1, background: T.border, margin: '48px 0 28px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: T.textMuted, fontWeight: 600, marginBottom: 4 }}>全局资产库</p>
                <p style={{ fontSize: 12, color: T.textSub }}>跨项目可复用资产 · {globalAssets.length} 项</p>
              </div>
              {/* 类型筛选 */}
              <div style={{ display: 'flex', gap: 6 }}>
                {(['ALL', 'CHARACTER', 'SCENE', 'PROP'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setAssetFilter(f)}
                    style={{
                      padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                      background: assetFilter === f ? T.btnBg : T.nodeSubtle,
                      border: assetFilter === f ? 'none' : `1px solid ${T.border}`,
                      color: assetFilter === f ? T.btnText : T.textSub,
                    }}
                  >{f === 'ALL' ? '全部' : TYPE_LABEL[f]}</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
              {globalAssets
                .filter(a => assetFilter === 'ALL' || a.type === assetFilter)
                .map(asset => (
                  <div
                    key={asset.id}
                    onClick={() => setPreviewAsset(asset)}
                    style={{
                      borderRadius: 10, border: `1px solid ${T.border}`,
                      background: T.nodeBg, cursor: 'pointer', overflow: 'hidden',
                      transition: 'border-color 0.15s, transform 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = T.borderMid; e.currentTarget.style.transform = 'translateY(-2px)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.transform = 'none' }}
                  >
                    {/* 图片 / 占位 */}
                    <div style={{
                      height: 100, background: asset.imageUrl ? 'transparent' : TYPE_COLOR[asset.type],
                      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                    }}>
                      {asset.imageUrl
                        ? <img src={asset.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ fontSize: 28, opacity: 0.25 }}>{asset.type === 'CHARACTER' ? '👤' : asset.type === 'SCENE' ? '🏞' : '📦'}</span>
                      }
                    </div>
                    {/* 信息 */}
                    <div style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                        <span style={{
                          fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                          background: TYPE_COLOR[asset.type], color: T.textSub, letterSpacing: '0.04em',
                        }}>{TYPE_LABEL[asset.type]}</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.name}</div>
                      {asset.description && (
                        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.description}</div>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </>
        )}
      </div>

      {/* ── 资产预览 Modal ──────────────────────────── */}
      {previewAsset && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}
          onClick={() => setPreviewAsset(null)}
        >
          <div
            style={{ width: 520, maxHeight: '80vh', borderRadius: 16, background: T.nodeBg, border: `1px solid ${T.borderMid}`, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.4)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal 头 */}
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: TYPE_COLOR[previewAsset.type], color: T.textSub }}>
                {TYPE_LABEL[previewAsset.type]}
              </span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: T.text }}>{previewAsset.name}</span>
              <button onClick={() => setPreviewAsset(null)} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 18, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ overflow: 'auto', flex: 1 }}>
              {/* 图片 */}
              {previewAsset.imageUrl && (
                <div style={{ background: T.nodeSubtle, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                  <img src={previewAsset.imageUrl} style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 8, objectFit: 'contain' }} />
                </div>
              )}

              {/* 描述 + Prompt */}
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {previewAsset.description && (
                  <div>
                    <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4, fontWeight: 500 }}>外观描述</div>
                    <div style={{ fontSize: 13, color: T.text, lineHeight: 1.6 }}>{previewAsset.description}</div>
                  </div>
                )}

                <div>
                  <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4, fontWeight: 500 }}>生图 Prompt</div>
                  <div style={{
                    padding: '10px 12px', borderRadius: 7,
                    background: T.nodeSubtle, border: `1px solid ${T.border}`,
                    fontSize: 11, lineHeight: 1.7, color: T.textSub,
                    wordBreak: 'break-word', maxHeight: 140, overflow: 'auto',
                  }}>
                    {previewAsset.prompt || '（暂无 prompt）'}
                  </div>
                </div>

                {previewAsset.usedInProjects.length > 0 && (
                  <div style={{ fontSize: 11, color: T.textMuted }}>
                    已用于 {previewAsset.usedInProjects.length} 个项目
                  </div>
                )}
              </div>
            </div>

            {/* Modal 底部操作 */}
            <div style={{ padding: '12px 20px', borderTop: `1px solid ${T.border}`, display: 'flex', gap: 8 }}>
              <button
                onClick={() => copyPrompt(previewAsset.prompt)}
                style={{ flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 12, fontWeight: 500, background: copiedPrompt ? T.btnBg : T.nodeSubtle, border: copiedPrompt ? 'none' : `1px solid ${T.border}`, color: copiedPrompt ? T.btnText : T.textSub, cursor: 'pointer' }}
              >{copiedPrompt ? '已复制 ✓' : '复制 Prompt'}</button>
              {previewAsset.projectId !== '__global__' && (
                <button
                  onClick={() => promoteToGlobal(previewAsset)}
                  disabled={!!promotingId}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 12, fontWeight: 600, background: T.btnBg, border: 'none', color: T.btnText, cursor: promotingId ? 'not-allowed' : 'pointer', opacity: promotingId ? 0.6 : 1 }}
                >{promotingId === previewAsset.id ? '提升中...' : '加入全局库'}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── PipelineProgress ─────────────────────────────────────────
function PipelineProgress({ stage, completed, T }: {
  stage: string
  completed: string[]
  T: any
}) {
  const currentIdx  = PIPELINE_STAGES.indexOf(stage)
  const completedSet = new Set(completed)

  return (
    <div style={{ marginTop: 6, marginBottom: 2 }}>
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        {PIPELINE_STAGES.map((s, i) => {
          const done    = completedSet.has(s)
          const current = s === stage
          return (
            <div
              key={s}
              title={STAGE_LABEL[s]}
              style={{
                flex: 1, height: 3, borderRadius: 2,
                background: done
                  ? 'rgba(201,152,42,0.8)'
                  : current
                    ? 'rgba(201,152,42,0.4)'
                    : i < currentIdx
                      ? 'rgba(201,152,42,0.25)'
                      : T.border,
                transition: 'background 0.2s',
              }}
            />
          )
        })}
      </div>
      {stage && (
        <div style={{ fontSize: 10, color: T.textMuted, marginTop: 3 }}>
          {STAGE_LABEL[stage] || stage}
          {completed.length > 0 && ` · ${completed.length}/${PIPELINE_STAGES.length} 步完成`}
        </div>
      )}
    </div>
  )
}
