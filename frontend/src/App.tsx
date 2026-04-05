import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import ProjectHome from './ProjectHome'
import LoginPage from './LoginPage'
import { useTheme } from './ThemeContext'
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  BackgroundVariant,
  Panel,
  useReactFlow,
  ReactFlowProvider,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import ImageGenNode from './nodes/ImageGenNode'
import VideoGenNode from './nodes/VideoGenNode'
import ImageNode from './nodes/ImageNode'
import TextNode from './nodes/TextNode'
import Gallery from './Gallery'
import ScriptWorkbench from './ScriptWorkbench'

const nodeTypes = {
  imageGen: ImageGenNode,
  videoGen: VideoGenNode,
  imageNode: ImageNode,
  textNode: TextNode,
}

function DeleteEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps) {
  const { deleteElements } = useReactFlow()
  const { T } = useTheme()
  const [hovered, setHovered] = useState(false)
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <>
      <BaseEdge path={edgePath} style={{ stroke: 'rgba(150,150,180,0.4)', strokeWidth: 1.5 }} />
      {/* 加宽透明区域用于鼠标悬停检测 */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: 'pointer' }}
      />
      <EdgeLabelRenderer>
        <button
          className="nodrag nopan"
          onClick={() => deleteElements({ edges: [{ id }] })}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            width: 18, height: 18,
            borderRadius: '50%',
            background: T.nodeBg,
            border: '1px solid rgba(99,102,241,0.5)',
            color: T.textSub,
            fontSize: 10,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s',
          }}
          title="删除连线"
        >✕</button>
      </EdgeLabelRenderer>
    </>
  )
}

const edgeTypes = { default: DeleteEdge }

let nodeCounter = 2

const MENU_ITEMS = [
  { type: 'imageGen', label: '生图',   desc: 'NanoBanana · 文字 / 参考图' },
  { type: 'videoGen', label: '生视频', desc: 'Sora 2 · Veo 3.1' },
  { type: 'textNode', label: '文本',   desc: '自由文字 · 便签 / 注释' },
]

const SHORTCUTS = [
  ['Ctrl + 滚轮', '缩放'],
  ['空格 + 拖拽',  '移动画布'],
  ['左键拖拽',    '框选'],
  ['右键',        '添加节点'],
  ['Delete',      '删除选中'],
]

interface ProjectRef { id: string; name: string }

// ── 画布（需要包在 ReactFlowProvider 里） ───────────────────
function Canvas({ project, onHome, onSwitchToWorkbench }: { project: ProjectRef; onHome: () => void; onSwitchToWorkbench: () => void }) {
  const { theme, T, toggle } = useTheme()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const initialized = useRef(false)
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [menu, setMenu] = useState<{
    x: number; y: number; canvasX: number; canvasY: number
  } | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, zoomIn, zoomOut } = useReactFlow()

  // 加载项目数据
  const loadProject = useCallback(() => {
    initialized.current = false
    axios.get(`/api/projects/${project.id}`).then(({ data }) => {
      setNodes(data.nodes || [])
      setEdges(data.edges || [])
      setTimeout(() => { initialized.current = true; setSaveStatus('saved') }, 200)
    })
  }, [project.id])

  useEffect(() => { loadProject() }, [project.id])

  // 监听资产发送事件，刷新画布节点
  useEffect(() => {
    window.addEventListener('canvas-refresh', loadProject)
    return () => window.removeEventListener('canvas-refresh', loadProject)
  }, [loadProject])

  // 自动保存（2 秒防抖）
  useEffect(() => {
    if (!initialized.current) return
    setSaveStatus('unsaved')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        await axios.put(`/api/projects/${project.id}`, { nodes, edges })
        setSaveStatus('saved')
      } catch { setSaveStatus('unsaved') }
    }, 2000)
  }, [nodes, edges])

  // Ctrl + 滚轮 缩放
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      if (e.deltaY < 0) zoomIn({ duration: 80 })
      else zoomOut({ duration: 80 })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomIn, zoomOut])

  const onConnect = useCallback(
    (conn: Connection) => setEdges(eds => addEdge(conn, eds)),
    [setEdges]
  )

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    setMenu({ x: e.clientX, y: e.clientY, canvasX: flow.x, canvasY: flow.y })
  }, [screenToFlowPosition])

  const addNode = useCallback((type: string) => {
    if (!menu) return
    setNodes(nds => [
      ...nds,
      {
        id: String(nodeCounter++),
        type,
        position: { x: menu.canvasX, y: menu.canvasY },
        data: {},
      },
    ])
    setMenu(null)
  }, [menu, setNodes])

  return (
    <div ref={wrapperRef} className="w-screen h-screen" onClick={() => setMenu(null)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onContextMenu={onContextMenu}

        colorMode={theme === 'dark' ? 'dark' : 'light'}
        fitView
        fitViewOptions={{ maxZoom: 0.75 }}
        minZoom={0.1}
        maxZoom={2}
        // 滚轮：禁止直接缩放，改由 Ctrl+滚轮触发
        zoomOnScroll={false}
        preventScrolling={false}
        // 拖拽：左键 = 框选，空格+左键 = 平移
        panOnDrag={false}
        panActivationKeyCode="Space"
        selectionOnDrag={true}
        style={{ background: T.canvasBg }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1.5} color={theme === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)'} />
        <Controls showInteractive={false} />

        {/* 顶部标题栏 */}
        <Panel position="top-left">
          <div
            className="flex items-center gap-2"
            style={{
              padding: '5px 10px',
              background: T.headerBg,
              border: `1px solid ${T.border}`,
              borderRadius: 999,
              backdropFilter: 'blur(24px)',
              boxShadow: theme === 'dark' ? '0 4px 24px rgba(0,0,0,0.5)' : '0 4px 20px rgba(0,0,0,0.08)',
              gap: 6,
            }}
          >
            {/* Logo + 返回 */}
            <button
              onClick={onHome}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px',
                borderRadius: 8, transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = T.nodeSubtle)}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <div style={{
                width: 22, height: 22, borderRadius: 6,
                background: 'rgba(201,152,42,0.12)',
                border: '1px solid rgba(201,152,42,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <img src="/logo.svg" style={{ width: 13, height: 13 }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>壹镜</span>
            </button>

            <div style={{ width: 1, height: 14, background: T.border }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: T.textSub, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>

            {/* 保存状态 */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 6,
              background: saveStatus === 'saving' ? 'rgba(201,152,42,0.1)' : 'transparent',
              transition: 'background 0.2s',
            }}>
              <div style={{
                width: 5, height: 5, borderRadius: '50%',
                background: saveStatus === 'saved'  ? 'rgba(80,200,100,0.7)'
                           : saveStatus === 'saving' ? 'rgba(201,152,42,0.9)'
                           : 'rgba(255,120,100,0.7)',
                transition: 'background 0.3s',
              }} />
              <span style={{
                fontSize: 11,
                color: saveStatus === 'saving' ? 'rgba(201,152,42,0.8)' : T.textMuted,
              }}>
                {saveStatus === 'saved' ? '已保存' : saveStatus === 'saving' ? '保存中' : '未保存'}
              </span>
            </div>

            <div style={{ width: 1, height: 14, background: T.border }} />

            {/* 分段控件 */}
            <div style={{
              display: 'flex', alignItems: 'center',
              background: T.nodeSubtle,
              border: `1px solid ${T.border}`,
              borderRadius: 8, padding: 3, gap: 2,
            }}>
              {[
                { label: '图片库',    active: galleryOpen,    onClick: () => setGalleryOpen(o => !o) },
                { label: '剧本工作台', active: false,          onClick: onSwitchToWorkbench },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  style={{
                    fontSize: 12, fontWeight: item.active ? 600 : 400,
                    padding: '4px 11px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: item.active
                      ? (theme === 'dark' ? 'rgba(201,152,42,0.15)' : 'rgba(184,135,14,0.12)')
                      : 'transparent',
                    color: item.active ? T.accent : T.textSub,
                    boxShadow: item.active ? `0 1px 4px rgba(0,0,0,0.2)` : 'none',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (!item.active) e.currentTarget.style.color = T.text }}
                  onMouseLeave={e => { if (!item.active) e.currentTarget.style.color = T.textSub }}
                >{item.label}</button>
              ))}
            </div>

            <div style={{ width: 1, height: 14, background: T.border }} />

            <button
              onClick={toggle}
              title={theme === 'dark' ? '切换浅色' : '切换深色'}
              style={{
                fontSize: 12, background: 'none', border: 'none', cursor: 'pointer',
                padding: '3px 8px', color: T.textSub, borderRadius: 6,
                transition: 'color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.background = T.nodeSubtle }}
              onMouseLeave={e => { e.currentTarget.style.color = T.textSub; e.currentTarget.style.background = 'none' }}
            >
              {theme === 'dark' ? '◑ 浅色' : '◑ 深色'}
            </button>
          </div>
        </Panel>

        {/* 操作快捷键提示（右下角，pointer-events:none 不干扰操作） */}
        <Panel position="bottom-right">
          <div
            className="select-none"
            style={{
              pointerEvents: 'none',
              padding: '10px 14px',
              background: theme === 'dark' ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.88)',
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              backdropFilter: 'blur(16px)',
              marginBottom: 8,
              marginRight: 4,
              boxShadow: theme === 'dark' ? '0 2px 12px rgba(0,0,0,0.4)' : '0 2px 12px rgba(0,0,0,0.08)',
            }}
          >
            {SHORTCUTS.map(([key, desc]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 20, lineHeight: 2 }}>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: T.textSub, minWidth: 88, textAlign: 'right' }}>{key}</span>
                <span style={{ fontSize: 11, color: T.textMuted }}>{desc}</span>
              </div>
            ))}
          </div>
        </Panel>
      </ReactFlow>

      {/* 右键菜单 */}
      {menu && (
        <div
          className="fixed z-50 overflow-hidden py-1"
          style={{
            left: menu.x,
            top: menu.y,
            background: T.menuBg,
            border: `1px solid ${T.borderMid}`,
            boxShadow: theme === 'dark' ? '0 12px 40px rgba(0,0,0,0.8), 0 0 0 1px rgba(201,152,42,0.06)' : '0 8px 32px rgba(0,0,0,0.12)',
            backdropFilter: 'blur(24px)',
            borderRadius: 12,
            minWidth: 180,
            overflow: 'hidden',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: '8px 14px 4px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: T.textMuted }}>
            添加节点
          </div>

          {MENU_ITEMS.map(item => (
            <button
              key={item.type}
              onClick={() => addNode(item.type)}
              style={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%', padding: '8px 14px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = T.nodeSubtle)}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <span style={{ fontSize: 14, color: T.text }}>{item.label}</span>
              <span style={{ fontSize: 12, color: T.textSub }}>{item.desc}</span>
            </button>
          ))}
        </div>
      )}
      {/* 空画布提示 */}
      {nodes.length === 0 && (
        <div
          className="select-none"
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', gap: 12,
          }}
        >
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'rgba(201,152,42,0.06)',
            border: '1px solid rgba(201,152,42,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, opacity: 0.6,
          }}>⊕</div>
          <div style={{ fontSize: 13, color: T.textMuted, letterSpacing: '0.02em' }}>
            右键画布，创建第一个节点
          </div>
        </div>
      )}

      <Gallery visible={galleryOpen} onClose={() => setGalleryOpen(false)} />
    </div>
  )
}

type AppView =
  | { type: 'home' }
  | { type: 'project'; project: ProjectRef; tab: 'canvas' | 'workbench' }

// ── axios 全局 token 拦截器 ───────────────────────────────────
axios.interceptors.request.use(config => {
  const token = localStorage.getItem('auth_token')
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  return config
})

export default function App() {
  const [view, setView]         = useState<AppView>({ type: 'home' })
  const [token, setToken]       = useState<string | null>(() => localStorage.getItem('auth_token'))
  const [username, setUsername] = useState<string>(() => localStorage.getItem('auth_username') || '')

  const handleLogin = (newToken: string, newUsername: string) => {
    localStorage.setItem('auth_token', newToken)
    localStorage.setItem('auth_username', newUsername)
    setToken(newToken)
    setUsername(newUsername)
  }

  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_username')
    setToken(null)
    setUsername('')
    setView({ type: 'home' })
  }

  // 全局 401 处理 → 自动登出
  useEffect(() => {
    const id = axios.interceptors.response.use(
      r => r,
      err => {
        if (err.response?.status === 401) handleLogout()
        return Promise.reject(err)
      }
    )
    return () => axios.interceptors.response.eject(id)
  }, [])

  if (!token) return <LoginPage onLogin={handleLogin} />

  if (view.type === 'project') {
    const { project, tab } = view
    const switchTab = (newTab: 'canvas' | 'workbench') =>
      setView({ type: 'project', project, tab: newTab })

    return (
      <>
        <div style={{ display: tab === 'canvas' ? 'block' : 'none', width: '100vw', height: '100vh' }}>
          <ReactFlowProvider>
            <Canvas
              project={project}
              onHome={() => setView({ type: 'home' })}
              onSwitchToWorkbench={() => switchTab('workbench')}
            />
          </ReactFlowProvider>
        </div>
        <div style={{ display: tab === 'workbench' ? 'block' : 'none', width: '100vw', height: '100vh' }}>
          <ScriptWorkbench
            projectId={project.id}
            projectName={project.name}
            onHome={() => setView({ type: 'home' })}
            onSwitchToCanvas={() => switchTab('canvas')}
          />
        </div>
      </>
    )
  }

  return (
    <ProjectHome
      username={username}
      onLogout={handleLogout}
      onOpen={p => setView({ type: 'project', project: p, tab: 'canvas' })}
    />
  )
}
