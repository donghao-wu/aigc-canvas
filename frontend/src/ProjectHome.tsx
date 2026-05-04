import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import axios from 'axios'
import {
  ArrowRight,
  Boxes,
  Check,
  Coins,
  Copy,
  Database,
  FileText,
  FolderKanban,
  Image,
  LayoutDashboard,
  LogOut,
  Moon,
  Palette,
  PenLine,
  Plus,
  Search,
  Sparkles,
  Sun,
  Trash2,
  Users,
  Video,
} from 'lucide-react'
import { useTheme } from './ThemeContext'
import type { DbAsset } from './types/asset'
import { TYPE_LABEL } from './types/asset'

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

interface Props {
  onOpen: (p: { id: string; name: string }) => void
  username?: string
  onLogout?: () => void
}

type HomeSection = 'overview' | 'projects' | 'scripts' | 'assets' | 'videos'

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

const TYPE_ACCENT: Record<DbAsset['type'], string> = {
  CHARACTER: '#63B3ED',
  SCENE: '#68D391',
  PROP: '#F6AD55',
}

function authHeaders() {
  const token = localStorage.getItem('auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
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
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [globalAssets, setGlobalAssets] = useState<DbAsset[]>([])
  const [previewAsset, setPreviewAsset] = useState<DbAsset | null>(null)
  const [assetFilter, setAssetFilter] = useState<DbAsset['type'] | 'ALL'>('ALL')
  const [search, setSearch] = useState('')
  const [assetSearch, setAssetSearch] = useState('')
  const [activeSection, setActiveSection] = useState<HomeSection>('overview')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  const cardBg = theme === 'dark' ? 'rgba(22,24,28,0.72)' : 'rgba(255,255,255,0.78)'
  const pageBg = theme === 'dark'
    ? 'radial-gradient(circle at 20% 0%, rgba(201,152,42,0.12), transparent 30%), linear-gradient(135deg, #08090B 0%, #111316 48%, #0B0D10 100%)'
    : 'linear-gradient(135deg, #F4F1EA 0%, #ECE8DD 55%, #F8F6EF 100%)'

  const loadAssets = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/assets?projectId=__global__', { headers: authHeaders() })
      setGlobalAssets(data)
    } catch {
      setGlobalAssets([])
    }
  }, [])

  const load = useCallback(async () => {
    const [projRes, dashRes] = await Promise.allSettled([
      axios.get('/api/projects', { headers: authHeaders() }),
      axios.get<DashboardData>('/api/dashboard', { headers: authHeaders() }),
    ])
    const list: ProjectMeta[] = projRes.status === 'fulfilled' ? projRes.value.data : []
    if (dashRes.status === 'fulfilled') {
      setDashboard(dashRes.value.data)
      const byId = Object.fromEntries(dashRes.value.data.projects.map(p => [p.id, p]))
      setProjects(list.map(p => ({
        ...p,
        pipelineStage: byId[p.id]?.pipelineStage || p.pipelineStage,
        memberCount: byId[p.id]?.memberCount || p.memberCount,
        stagesCompleted: byId[p.id]?.stagesCompleted || p.stagesCompleted,
      })))
    } else {
      setProjects(list)
    }
  }, [])

  useEffect(() => {
    load()
    loadAssets()
  }, [load, loadAssets])

  useEffect(() => {
    if (creating) setTimeout(() => inputRef.current?.focus(), 40)
  }, [creating])

  const filteredProjects = useMemo(() => {
    const key = search.trim().toLowerCase()
    if (!key) return projects
    return projects.filter(p => p.name.toLowerCase().includes(key))
  }, [projects, search])

  const filteredAssetLibrary = useMemo(() => {
    const key = assetSearch.trim().toLowerCase()
    return globalAssets
      .filter(a => assetFilter === 'ALL' || a.type === assetFilter)
      .filter(a => {
        if (!key) return true
        return a.name.toLowerCase().includes(key)
          || (a.description || '').toLowerCase().includes(key)
          || (a.prompt || '').toLowerCase().includes(key)
      })
  }, [globalAssets, assetFilter, assetSearch])

  const filteredAssets = useMemo(() => filteredAssetLibrary.slice(0, 8), [filteredAssetLibrary])

  const productionProjects = dashboard?.projects
    ?.slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) || []
  const activeProjects = productionProjects.slice(0, 5)

  const navItems: Array<{ key: HomeSection; label: string; icon: typeof LayoutDashboard }> = [
    { key: 'overview', label: '生产总览', icon: LayoutDashboard },
    { key: 'projects', label: '项目队列', icon: FolderKanban },
    { key: 'scripts', label: '剧本流水线', icon: FileText },
    { key: 'assets', label: '视觉资产', icon: Palette },
    { key: 'videos', label: '视频交付', icon: Video },
  ]

  const sectionMeta: Record<HomeSection, { eyebrow: string; title: string }> = {
    overview: { eyebrow: 'Production Command', title: '项目生产中控台' },
    projects: { eyebrow: 'Project Queue', title: '项目队列' },
    scripts: { eyebrow: 'Script Pipeline', title: '剧本流水线' },
    assets: { eyebrow: 'Visual Assets', title: '视觉资产' },
    videos: { eyebrow: 'Video Delivery', title: '视频交付' },
  }

  const scriptProjects = productionProjects.filter(p =>
    ['story_bible', 'character_bios', 'asset_registry', 'episode_map', 'episodes'].includes(p.pipelineStage)
    || (p.stagesCompleted || []).some(s => ['story_bible', 'character_bios', 'asset_registry', 'episode_map', 'episodes'].includes(s))
  )

  const deliveryProjects = productionProjects.filter(p =>
    ['image_gen', 'video_gen'].includes(p.pipelineStage)
    || (p.stagesCompleted || []).some(s => ['image_gen', 'video_gen'].includes(s))
  )

  const handleCreate = async () => {
    setLoading(true)
    try {
      const { data } = await axios.post('/api/projects', { name: newName.trim() || '未命名项目' }, { headers: authHeaders() })
      setCreating(false)
      setNewName('')
      onOpen({ id: data.id, name: data.name })
    } finally {
      setLoading(false)
    }
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
    setTimeout(() => {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }, 40)
  }

  const commitEdit = async (id: string) => {
    const name = editingName.trim()
    if (name && name !== projects.find(p => p.id === id)?.name) {
      await axios.put(`/api/projects/${id}`, { name }, { headers: authHeaders() })
      load()
    }
    setEditingId(null)
  }

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
    } finally {
      setPromotingId(null)
    }
  }

  const copyPrompt = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopiedPrompt(true)
      setTimeout(() => setCopiedPrompt(false), 1500)
    } catch {}
  }

  const metricItems = [
    { label: '项目', value: dashboard?.global.totalProjects ?? projects.length, icon: FolderKanban },
    { label: '资产', value: dashboard?.global.totalAssets ?? globalAssets.length, icon: Boxes },
    { label: '图片', value: dashboard?.global.totalImages ?? 0, icon: Image },
    { label: 'Token', value: fmtNum(dashboard?.global.totalTokens ?? 0), icon: Database },
    { label: '费用', value: `¥${(dashboard?.global.estimatedCost ?? 0).toFixed(2)}`, icon: Coins },
  ]

  const iconButton: CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 8,
    border: `1px solid ${T.border}`,
    background: T.nodeSubtle,
    color: T.textSub,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  }

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      overflow: 'hidden',
      background: pageBg,
      color: T.text,
    }}>
      <aside style={{
        width: 238,
        flexShrink: 0,
        borderRight: `1px solid ${T.border}`,
        background: theme === 'dark' ? 'rgba(6,8,11,0.78)' : 'rgba(255,255,255,0.52)',
        backdropFilter: 'blur(22px)',
        display: 'flex',
        flexDirection: 'column',
        padding: 18,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: 'rgba(201,152,42,0.14)',
            border: '1px solid rgba(201,152,42,0.28)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <img src="/logo.svg" style={{ width: 18, height: 18 }} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.1 }}>壹镜</div>
            <div style={{ fontSize: 10, color: T.textMuted, marginTop: 3 }}>AIGC Studio</div>
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {navItems.map(item => {
            const Icon = item.icon
            const active = activeSection === item.key
            return (
              <button key={item.key} onClick={() => setActiveSection(item.key)} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '10px 11px',
                borderRadius: 8,
                border: active ? '1px solid rgba(201,152,42,0.28)' : '1px solid transparent',
                background: active ? 'rgba(201,152,42,0.12)' : 'transparent',
                color: active ? T.text : T.textSub,
                fontSize: 13,
                cursor: 'pointer',
              }}>
                <Icon size={16} />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            border: `1px solid ${T.border}`,
            background: T.nodeSubtle,
            borderRadius: 10,
            padding: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.text }}>
              <Sparkles size={15} color={T.accent} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>生产状态</span>
            </div>
            <p style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.6, marginTop: 8 }}>
              资产、剧本和画布已接入同一项目数据层。
            </p>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '10px 4px 0',
            borderTop: `1px solid ${T.border}`,
          }}>
            <div style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: 'rgba(99,179,237,0.14)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.text,
              fontSize: 12,
              fontWeight: 800,
            }}>
              {(username || 'U').slice(0, 1).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {username || '用户'}
              </div>
              <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>工作台成员</div>
            </div>
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <div style={{ maxWidth: 1320, margin: '0 auto', padding: '24px 28px 56px' }}>
          <header style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            justifyContent: 'space-between',
            marginBottom: 22,
          }}>
            <div>
              <div style={{ fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                {sectionMeta[activeSection].eyebrow}
              </div>
              <h1 style={{ fontSize: 30, lineHeight: 1.15, marginTop: 7, fontWeight: 800, letterSpacing: '-0.02em' }}>
                {sectionMeta[activeSection].title}
              </h1>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={toggle} title="切换主题" style={iconButton}>
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              {onLogout && (
                <button onClick={onLogout} style={{ ...iconButton, width: 'auto', padding: '0 12px', gap: 7 }}>
                  <LogOut size={15} />
                  <span style={{ fontSize: 12 }}>退出</span>
                </button>
              )}
              <button
                onClick={() => setCreating(true)}
                style={{
                  height: 36,
                  padding: '0 15px',
                  borderRadius: 8,
                  border: 'none',
                  background: T.btnBg,
                  color: T.btnText,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 10px 26px rgba(201,152,42,0.22)',
                }}
              >
                <Plus size={16} />
                新建项目
              </button>
            </div>
          </header>

          {activeSection === 'overview' && (
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))', gap: 12, marginBottom: 18 }}>
              {metricItems.map(item => {
                const Icon = item.icon
                return (
                  <div key={item.label} style={{
                    minHeight: 98,
                    borderRadius: 10,
                    border: `1px solid ${T.border}`,
                    background: cardBg,
                    padding: 15,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: theme === 'dark' ? '0 18px 44px rgba(0,0,0,0.2)' : '0 18px 44px rgba(88,72,34,0.08)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 700 }}>{item.label}</span>
                      <Icon size={16} color={T.accent} />
                    </div>
                    <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>{item.value}</div>
                  </div>
                )
              })}
            </section>
          )}

          {creating && (
            <section style={{
              border: `1px solid ${T.borderMid}`,
              background: cardBg,
              borderRadius: 10,
              padding: 14,
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              marginBottom: 18,
            }}>
              <input
                ref={inputRef}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreate()
                  if (e.key === 'Escape') {
                    setCreating(false)
                    setNewName('')
                  }
                }}
                placeholder="输入项目名称"
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 38,
                  borderRadius: 8,
                  border: `1px solid ${T.border}`,
                  background: T.inputBg,
                  color: T.text,
                  outline: 'none',
                  padding: '0 12px',
                  fontSize: 13,
                }}
              />
              <button onClick={handleCreate} disabled={loading} style={{
                height: 38,
                padding: '0 16px',
                borderRadius: 8,
                border: 'none',
                background: T.btnBg,
                color: T.btnText,
                fontSize: 13,
                fontWeight: 800,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.65 : 1,
              }}>
                {loading ? '创建中' : '创建'}
              </button>
              <button onClick={() => { setCreating(false); setNewName('') }} style={{
                height: 38,
                padding: '0 14px',
                borderRadius: 8,
                border: `1px solid ${T.border}`,
                background: T.nodeSubtle,
                color: T.textSub,
                fontSize: 13,
                cursor: 'pointer',
              }}>
                取消
              </button>
            </section>
          )}

          {activeSection === 'overview' && (
            <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(340px, 0.9fr)', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <PanelCard title="项目队列" eyebrow="Projects" T={T} cardBg={cardBg} action={
                <div style={{
                  height: 34,
                  minWidth: 220,
                  borderRadius: 8,
                  border: `1px solid ${T.border}`,
                  background: T.inputBg,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 10px',
                }}>
                  <Search size={15} color={T.textMuted} />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="搜索项目"
                    style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: T.text, fontSize: 12 }}
                  />
                </div>
              }>
                {filteredProjects.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                    {filteredProjects.map((p, i) => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        index={i}
                        hovered={hoveredId === p.id}
                        editing={editingId === p.id}
                        editingName={editingName}
                        editInputRef={editInputRef}
                        T={T}
                        theme={theme}
                        onHover={setHoveredId}
                        onOpen={onOpen}
                        onStartEdit={startEdit}
                        onCommitEdit={commitEdit}
                        onEditName={setEditingName}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState T={T} />
                )}
              </PanelCard>

              <PanelCard title="全局资产速览" eyebrow="Assets" T={T} cardBg={cardBg} action={
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['ALL', 'CHARACTER', 'SCENE', 'PROP'] as const).map(f => (
                    <button key={f} onClick={() => setAssetFilter(f)} style={{
                      height: 28,
                      padding: '0 9px',
                      borderRadius: 7,
                      border: `1px solid ${assetFilter === f ? 'rgba(201,152,42,0.44)' : T.border}`,
                      background: assetFilter === f ? 'rgba(201,152,42,0.12)' : T.nodeSubtle,
                      color: assetFilter === f ? T.text : T.textSub,
                      fontSize: 11,
                      cursor: 'pointer',
                    }}>
                      {f === 'ALL' ? '全部' : TYPE_LABEL[f]}
                    </button>
                  ))}
                </div>
              }>
                {filteredAssets.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                    {filteredAssets.map(asset => (
                      <AssetTile key={asset.id} asset={asset} T={T} onClick={() => setPreviewAsset(asset)} />
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: '30px 0', textAlign: 'center', color: T.textMuted, fontSize: 12 }}>暂无全局资产</div>
                )}
              </PanelCard>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <PanelCard title="生产流" eyebrow="Pipeline" T={T} cardBg={cardBg}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {activeProjects.length > 0 ? activeProjects.map(item => (
                    <div key={item.id} style={{
                      border: `1px solid ${T.border}`,
                      background: T.nodeSubtle,
                      borderRadius: 9,
                      padding: 12,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                            {STAGE_LABEL[item.pipelineStage] || item.pipelineStage || '未开始'} · {timeAgo(item.updatedAt)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: T.textSub, fontSize: 11 }}>
                          <Users size={13} />
                          {item.memberCount || 1}
                        </div>
                      </div>
                      <PipelineProgress stage={item.pipelineStage || ''} completed={item.stagesCompleted || []} T={T} />
                    </div>
                  )) : (
                    <div style={{ padding: '22px 0', textAlign: 'center', color: T.textMuted, fontSize: 12 }}>还没有生产记录</div>
                  )}
                </div>
              </PanelCard>

              <PanelCard title="下一步" eyebrow="Next" T={T} cardBg={cardBg}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {[
                    ['剧本工作台', '完成故事圣经、角色小传和资产登记'],
                    ['资产库', '生成角色三视图和场景多角度参考'],
                    ['画布', '把资产送入节点画布开始生图排布'],
                  ].map(([title, desc]) => (
                    <div key={title} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: 10,
                      borderRadius: 8,
                      background: T.nodeSubtle,
                      border: `1px solid ${T.border}`,
                    }}>
                      <Check size={15} color={T.accent} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 750 }}>{title}</div>
                        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3 }}>{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </PanelCard>
            </div>
          </section>
          )}

          {activeSection === 'projects' && (
            <PanelCard title="全部项目" eyebrow={`${filteredProjects.length} Projects`} T={T} cardBg={cardBg} action={
              <div style={{
                height: 34,
                minWidth: 260,
                borderRadius: 8,
                border: `1px solid ${T.border}`,
                background: T.inputBg,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 10px',
              }}>
                <Search size={15} color={T.textMuted} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="搜索项目"
                  style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: T.text, fontSize: 12 }}
                />
              </div>
            }>
              {filteredProjects.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                  {filteredProjects.map((p, i) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      index={i}
                      hovered={hoveredId === p.id}
                      editing={editingId === p.id}
                      editingName={editingName}
                      editInputRef={editInputRef}
                      T={T}
                      theme={theme}
                      onHover={setHoveredId}
                      onOpen={onOpen}
                      onStartEdit={startEdit}
                      onCommitEdit={commitEdit}
                      onEditName={setEditingName}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState T={T} />
              )}
            </PanelCard>
          )}

          {activeSection === 'scripts' && (
            <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(320px, 0.7fr)', gap: 16 }}>
              <PanelCard title="剧本阶段看板" eyebrow="Script Flow" T={T} cardBg={cardBg}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(132px, 1fr))', gap: 10 }}>
                  {PIPELINE_STAGES.slice(0, 5).map(stage => (
                    <StageLane
                      key={stage}
                      stage={stage}
                      projects={productionProjects.filter(p => p.pipelineStage === stage || (p.stagesCompleted || []).includes(stage)).slice(0, 4)}
                      T={T}
                      onOpen={onOpen}
                    />
                  ))}
                </div>
              </PanelCard>

              <PanelCard title="近期剧本项目" eyebrow={`${scriptProjects.length} Active`} T={T} cardBg={cardBg}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {scriptProjects.length > 0 ? scriptProjects.slice(0, 8).map(item => (
                    <button key={item.id} onClick={() => onOpen({ id: item.id, name: item.name })} style={{
                      textAlign: 'left',
                      border: `1px solid ${T.border}`,
                      background: T.nodeSubtle,
                      borderRadius: 9,
                      padding: 12,
                      color: T.text,
                      cursor: 'pointer',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                        <span style={{ fontSize: 10, color: T.accent, whiteSpace: 'nowrap' }}>{STAGE_LABEL[item.pipelineStage] || '未开始'}</span>
                      </div>
                      <PipelineProgress stage={item.pipelineStage || ''} completed={item.stagesCompleted || []} T={T} />
                    </button>
                  )) : (
                    <ModuleEmpty T={T} icon={FileText} title="还没有进入剧本流水线的项目" />
                  )}
                </div>
              </PanelCard>
            </section>
          )}

          {activeSection === 'assets' && (
            <PanelCard title="全局视觉资产" eyebrow={`${filteredAssetLibrary.length} Assets`} T={T} cardBg={cardBg} action={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  height: 34,
                  minWidth: 240,
                  borderRadius: 8,
                  border: `1px solid ${T.border}`,
                  background: T.inputBg,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 10px',
                }}>
                  <Search size={15} color={T.textMuted} />
                  <input
                    value={assetSearch}
                    onChange={e => setAssetSearch(e.target.value)}
                    placeholder="搜索资产 / prompt"
                    style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: T.text, fontSize: 12 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['ALL', 'CHARACTER', 'SCENE', 'PROP'] as const).map(f => (
                    <button key={f} onClick={() => setAssetFilter(f)} style={{
                      height: 30,
                      padding: '0 9px',
                      borderRadius: 7,
                      border: `1px solid ${assetFilter === f ? 'rgba(201,152,42,0.44)' : T.border}`,
                      background: assetFilter === f ? 'rgba(201,152,42,0.12)' : T.nodeSubtle,
                      color: assetFilter === f ? T.text : T.textSub,
                      fontSize: 11,
                      cursor: 'pointer',
                    }}>
                      {f === 'ALL' ? '全部' : TYPE_LABEL[f]}
                    </button>
                  ))}
                </div>
              </div>
            }>
              {filteredAssetLibrary.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 12 }}>
                  {filteredAssetLibrary.map(asset => (
                    <AssetTile key={asset.id} asset={asset} T={T} onClick={() => setPreviewAsset(asset)} />
                  ))}
                </div>
              ) : (
                <ModuleEmpty T={T} icon={Palette} title="暂无匹配的视觉资产" />
              )}
            </PanelCard>
          )}

          {activeSection === 'videos' && (
            <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(320px, 0.8fr)', gap: 16 }}>
              <PanelCard title="交付队列" eyebrow={`${deliveryProjects.length} Candidates`} T={T} cardBg={cardBg}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {deliveryProjects.length > 0 ? deliveryProjects.map(item => (
                    <button key={item.id} onClick={() => onOpen({ id: item.id, name: item.name })} style={{
                      textAlign: 'left',
                      border: `1px solid ${T.border}`,
                      background: T.nodeSubtle,
                      borderRadius: 9,
                      padding: 12,
                      color: T.text,
                      cursor: 'pointer',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                            {STAGE_LABEL[item.pipelineStage] || item.pipelineStage || '待排期'} · {timeAgo(item.updatedAt)}
                          </div>
                        </div>
                        <Video size={16} color={T.accent} />
                      </div>
                      <PipelineProgress stage={item.pipelineStage || ''} completed={item.stagesCompleted || []} T={T} />
                    </button>
                  )) : (
                    <ModuleEmpty T={T} icon={Video} title="还没有进入视频交付的项目" />
                  )}
                </div>
              </PanelCard>

              <PanelCard title="交付能力状态" eyebrow="Roadmap" T={T} cardBg={cardBg}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {[
                    ['视频生成节点', '已在画布内提供基础节点'],
                    ['交付状态追踪', '待接入任务状态、审核和导出记录'],
                    ['成片版本库', '待接入多版本对比与最终交付包'],
                  ].map(([title, desc], index) => (
                    <div key={title} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: 11,
                      borderRadius: 9,
                      border: `1px solid ${T.border}`,
                      background: T.nodeSubtle,
                    }}>
                      <span style={{
                        width: 22,
                        height: 22,
                        borderRadius: 7,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: index === 0 ? 'rgba(80,200,120,0.12)' : 'rgba(201,152,42,0.1)',
                        color: index === 0 ? 'rgba(80,200,120,0.9)' : T.accent,
                        fontSize: 11,
                        fontWeight: 900,
                      }}>{index === 0 ? '✓' : '·'}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 800 }}>{title}</div>
                        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3 }}>{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </PanelCard>
            </section>
          )}
        </div>
      </main>

      {previewAsset && (
        <AssetPreview
          asset={previewAsset}
          T={T}
          copiedPrompt={copiedPrompt}
          promoting={promotingId === previewAsset.id}
          onClose={() => setPreviewAsset(null)}
          onCopy={() => copyPrompt(previewAsset.prompt)}
          onPromote={() => promoteToGlobal(previewAsset)}
        />
      )}
    </div>
  )
}

function PanelCard({ title, eyebrow, action, children, T, cardBg }: {
  title: string
  eyebrow: string
  action?: React.ReactNode
  children: React.ReactNode
  T: any
  cardBg: string
}) {
  return (
    <section style={{
      border: `1px solid ${T.border}`,
      background: cardBg,
      borderRadius: 12,
      padding: 16,
      boxShadow: '0 18px 44px rgba(0,0,0,0.12)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800 }}>{eyebrow}</div>
          <div style={{ fontSize: 16, fontWeight: 850, marginTop: 4 }}>{title}</div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function StageLane({ stage, projects, T, onOpen }: {
  stage: string
  projects: DashboardData['projects']
  T: any
  onOpen: (p: { id: string; name: string }) => void
}) {
  return (
    <div style={{
      minHeight: 260,
      border: `1px solid ${T.border}`,
      background: T.nodeSubtle,
      borderRadius: 10,
      padding: 10,
      display: 'flex',
      flexDirection: 'column',
      gap: 9,
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 850 }}>{STAGE_LABEL[stage]}</div>
        <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>{projects.length} 个项目</div>
      </div>
      {projects.length > 0 ? projects.map(project => (
        <button key={project.id} onClick={() => onOpen({ id: project.id, name: project.name })} style={{
          textAlign: 'left',
          border: `1px solid ${T.border}`,
          background: 'rgba(255,255,255,0.035)',
          borderRadius: 8,
          padding: 9,
          color: T.text,
          cursor: 'pointer',
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</div>
          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>{timeAgo(project.updatedAt)}</div>
        </button>
      )) : (
        <div style={{
          minHeight: 104,
          border: `1px dashed ${T.borderMid}`,
          borderRadius: 8,
          color: T.textMuted,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          textAlign: 'center',
          padding: 10,
        }}>
          暂无项目
        </div>
      )}
    </div>
  )
}

function ModuleEmpty({ T, icon: Icon, title }: { T: any; icon: typeof FileText; title: string }) {
  return (
    <div style={{
      minHeight: 240,
      border: `1px dashed ${T.borderMid}`,
      borderRadius: 10,
      background: T.nodeSubtle,
      color: T.textMuted,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      fontSize: 13,
    }}>
      <Icon size={30} />
      <span>{title}</span>
    </div>
  )
}

function ProjectCard({ project, index, hovered, editing, editingName, editInputRef, T, theme, onHover, onOpen, onStartEdit, onCommitEdit, onEditName, onDelete }: {
  project: ProjectMeta
  index: number
  hovered: boolean
  editing: boolean
  editingName: string
  editInputRef: React.RefObject<HTMLInputElement>
  T: any
  theme: string
  onHover: (id: string | null) => void
  onOpen: (p: { id: string; name: string }) => void
  onStartEdit: (e: React.MouseEvent, p: ProjectMeta) => void
  onCommitEdit: (id: string) => void
  onEditName: (name: string) => void
  onDelete: (e: React.MouseEvent, id: string) => void
}) {
  return (
    <article
      onClick={() => onOpen({ id: project.id, name: project.name })}
      onMouseEnter={() => onHover(project.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        borderRadius: 10,
        border: `1px solid ${hovered ? T.borderMid : T.border}`,
        background: hovered
          ? (theme === 'dark' ? 'rgba(30,34,40,0.92)' : 'rgba(255,255,255,0.94)')
          : T.nodeSubtle,
        cursor: 'pointer',
        overflow: 'hidden',
        animation: `slideInUp 0.24s ease ${index * 0.035}s both`,
        transition: 'border-color 0.15s, transform 0.15s, background 0.15s',
        transform: hovered ? 'translateY(-2px)' : 'none',
      }}
    >
      <div style={{
        height: 84,
        borderBottom: `1px solid ${T.border}`,
        background: 'linear-gradient(135deg, rgba(201,152,42,0.16), rgba(99,179,237,0.08), transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 14,
      }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ width: 8, height: 8, borderRadius: 99, background: 'rgba(80,200,120,0.85)' }} />
          <span style={{ fontSize: 11, color: T.textSub }}>Live Project</span>
        </div>
        <ArrowRight size={18} color={hovered ? T.accent : T.textMuted} />
      </div>
      <div style={{ padding: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {editing ? (
            <input
              ref={editInputRef}
              value={editingName}
              onChange={e => onEditName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') onCommitEdit(project.id)
                if (e.key === 'Escape') onCommitEdit(project.id)
              }}
              onBlur={() => onCommitEdit(project.id)}
              onClick={e => e.stopPropagation()}
              style={{
                flex: 1,
                minWidth: 0,
                border: `1px solid ${T.borderMid}`,
                background: T.inputBg,
                color: T.text,
                borderRadius: 6,
                padding: '4px 7px',
                outline: 'none',
                fontSize: 13,
                fontWeight: 700,
              }}
            />
          ) : (
            <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 800, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {project.name}
            </div>
          )}
          <button onClick={e => onStartEdit(e, project)} title="重命名" style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border: `1px solid ${T.border}`,
            background: T.nodeSubtle,
            color: T.textSub,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            opacity: hovered ? 1 : 0,
          }}>
            <PenLine size={13} />
          </button>
        </div>

        <PipelineProgress stage={project.pipelineStage || ''} completed={project.stagesCompleted || []} T={T} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.textMuted, fontSize: 11 }}>
            <span>{project.nodeCount} 节点</span>
            {project.memberCount && project.memberCount > 1 && <span>{project.memberCount} 人</span>}
            <span>{timeAgo(project.updatedAt)}</span>
          </div>
          <button onClick={e => onDelete(e, project.id)} title="删除" style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border: '1px solid rgba(239,68,68,0.18)',
            background: 'rgba(239,68,68,0.08)',
            color: 'rgba(239,68,68,0.72)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            opacity: hovered ? 1 : 0,
          }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </article>
  )
}

function PipelineProgress({ stage, completed, T }: {
  stage: string
  completed: string[]
  T: any
}) {
  const currentIdx = PIPELINE_STAGES.indexOf(stage)
  const completedSet = new Set(completed)
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {PIPELINE_STAGES.map((s, i) => {
          const done = completedSet.has(s)
          const current = s === stage
          return (
            <div key={s} title={STAGE_LABEL[s]} style={{
              flex: 1,
              height: 4,
              borderRadius: 99,
              background: done
                ? 'rgba(201,152,42,0.86)'
                : current
                  ? 'rgba(201,152,42,0.42)'
                  : i < currentIdx
                    ? 'rgba(201,152,42,0.24)'
                    : T.border,
            }} />
          )
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: 10, color: T.textMuted }}>
        {STAGE_LABEL[stage] || '尚未进入流水线'}{completed.length > 0 ? ` · ${completed.length}/${PIPELINE_STAGES.length}` : ''}
      </div>
    </div>
  )
}

function AssetTile({ asset, T, onClick }: { asset: DbAsset; T: any; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      border: `1px solid ${T.border}`,
      background: T.nodeSubtle,
      borderRadius: 9,
      overflow: 'hidden',
      padding: 0,
      textAlign: 'left',
      cursor: 'pointer',
      color: T.text,
    }}>
      <div style={{
        height: 92,
        background: asset.imageUrl ? T.nodeSubtle : `linear-gradient(135deg, ${TYPE_ACCENT[asset.type]}33, transparent)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {asset.imageUrl ? (
          <img src={asset.imageUrl} alt={asset.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Boxes size={26} color={TYPE_ACCENT[asset.type]} />
        )}
      </div>
      <div style={{ padding: 9 }}>
        <div style={{ fontSize: 10, color: TYPE_ACCENT[asset.type], fontWeight: 800, marginBottom: 4 }}>{TYPE_LABEL[asset.type]}</div>
        <div style={{ fontSize: 12, fontWeight: 760, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.name}</div>
        <div style={{ fontSize: 10, color: T.textMuted, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {asset.description || '暂无描述'}
        </div>
      </div>
    </button>
  )
}

function AssetPreview({ asset, T, copiedPrompt, promoting, onClose, onCopy, onPromote }: {
  asset: DbAsset
  T: any
  copiedPrompt: boolean
  promoting: boolean
  onClose: () => void
  onCopy: () => void
  onPromote: () => void
}) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed',
      inset: 0,
      zIndex: 100,
      background: 'rgba(0,0,0,0.62)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backdropFilter: 'blur(6px)',
      padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(560px, 100%)',
        maxHeight: '82vh',
        overflow: 'hidden',
        borderRadius: 12,
        background: T.nodeBg,
        border: `1px solid ${T.borderMid}`,
        boxShadow: '0 28px 90px rgba(0,0,0,0.44)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 18px', borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 10, color: TYPE_ACCENT[asset.type], fontWeight: 850 }}>{TYPE_LABEL[asset.type]}</span>
          <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 820, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.name}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: T.textMuted, cursor: 'pointer', fontSize: 18 }}>x</button>
        </div>
        <div style={{ overflowY: 'auto' }}>
          {asset.imageUrl && (
            <div style={{ padding: 16, background: T.nodeSubtle }}>
              <img src={asset.imageUrl} alt={asset.name} style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 8 }} />
            </div>
          )}
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <InfoBlock title="外观描述" value={asset.description || '暂无描述'} T={T} />
            <InfoBlock title="生图 Prompt" value={asset.prompt || '暂无 prompt'} T={T} mono />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: 14, borderTop: `1px solid ${T.border}` }}>
          <button onClick={onCopy} style={{
            flex: 1,
            height: 36,
            borderRadius: 8,
            border: `1px solid ${T.border}`,
            background: copiedPrompt ? T.btnBg : T.nodeSubtle,
            color: copiedPrompt ? T.btnText : T.textSub,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 800,
          }}>
            {copiedPrompt ? <Check size={15} /> : <Copy size={15} />}
            {copiedPrompt ? '已复制' : '复制 Prompt'}
          </button>
          {asset.projectId !== '__global__' && (
            <button onClick={onPromote} disabled={promoting} style={{
              flex: 1,
              height: 36,
              borderRadius: 8,
              border: 'none',
              background: T.btnBg,
              color: T.btnText,
              cursor: promoting ? 'not-allowed' : 'pointer',
              opacity: promoting ? 0.65 : 1,
              fontSize: 12,
              fontWeight: 850,
            }}>
              {promoting ? '处理中' : '加入全局库'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoBlock({ title, value, T, mono }: { title: string; value: string; T: any; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{title}</div>
      <div style={{
        border: `1px solid ${T.border}`,
        background: T.nodeSubtle,
        borderRadius: 8,
        padding: '9px 10px',
        color: T.textSub,
        fontSize: 11,
        lineHeight: 1.7,
        fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
        wordBreak: 'break-word',
      }}>
        {value}
      </div>
    </div>
  )
}

function EmptyState({ T }: { T: any }) {
  return (
    <div style={{
      minHeight: 220,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      color: T.textMuted,
      border: `1px dashed ${T.borderMid}`,
      borderRadius: 10,
      background: T.nodeSubtle,
    }}>
      <FolderKanban size={30} />
      <div style={{ fontSize: 13 }}>还没有项目</div>
    </div>
  )
}
