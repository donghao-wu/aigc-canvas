import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import ProjectHome from './ProjectHome'
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
  useEffect(() => {
    initialized.current = false
    axios.get(`/api/projects/${project.id}`).then(({ data }) => {
      setNodes(data.nodes || [])
      setEdges(data.edges || [])
      setTimeout(() => { initialized.current = true; setSaveStatus('saved') }, 200)
    })
  }, [project.id])

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
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color={theme === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.1)'} />
        <Controls showInteractive={false} />

        {/* 顶部标题栏 */}
        <Panel position="top-left">
          <div
            className="flex items-center gap-3"
            style={{
              padding: '8px 16px',
              background: T.headerBg,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              backdropFilter: 'blur(20px)',
            }}
          >
            <button onClick={onHome} style={{ fontSize: 12, color: T.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              ← Studio
            </button>
            <div style={{ width: 1, height: 14, background: T.border }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{project.name}</span>
            <div style={{ width: 1, height: 14, background: T.border }} />
            <span style={{
              fontSize: 11,
              color: saveStatus === 'saved'  ? T.textMuted
                   : saveStatus === 'saving' ? 'rgba(200,150,50,0.8)'
                   : T.textMuted,
            }}>
              {saveStatus === 'saved' ? '已保存' : saveStatus === 'saving' ? '保存中' : '未保存'}
            </span>
            <div style={{ width: 1, height: 14, background: T.border }} />
            <button onClick={() => setGalleryOpen(o => !o)} style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: galleryOpen ? T.text : T.textSub }}>
              图片库
            </button>
            <div style={{ width: 1, height: 14, background: T.border }} />
            <button onClick={onSwitchToWorkbench} style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: T.textSub }}>
              剧本工作台
            </button>
            <div style={{ width: 1, height: 14, background: T.border }} />
            <button
              onClick={toggle}
              title={theme === 'dark' ? '切换浅色' : '切换深色'}
              style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: T.textSub }}
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
            border: `1px solid ${T.border}`,
            boxShadow: theme === 'dark' ? '0 8px 32px rgba(0,0,0,0.8)' : '0 8px 32px rgba(0,0,0,0.12)',
            backdropFilter: 'blur(20px)',
            borderRadius: 8,
            minWidth: 180,
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
              <span style={{ fontSize: 13, color: T.text }}>{item.label}</span>
              <span style={{ fontSize: 11, color: T.textMuted }}>{item.desc}</span>
            </button>
          ))}
        </div>
      )}
      {/* 空画布提示 */}
      {nodes.length === 0 && (
        <div
          className="select-none"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            gap: 10,
          }}
        >
          <div style={{
            fontSize: 36,
            opacity: 0.15,
            lineHeight: 1,
          }}>⊕</div>
          <div style={{
            fontSize: 13,
            color: T.textMuted,
            opacity: 0.6,
            letterSpacing: '0.02em',
          }}>右键画布，创建第一个节点</div>
        </div>
      )}

      <Gallery visible={galleryOpen} onClose={() => setGalleryOpen(false)} />
    </div>
  )
}

type AppView =
  | { type: 'home' }
  | { type: 'project'; project: ProjectRef; tab: 'canvas' | 'workbench' }

export default function App() {
  const [view, setView] = useState<AppView>({ type: 'home' })

  if (view.type === 'project') {
    const { project, tab } = view
    const switchTab = (newTab: 'canvas' | 'workbench') =>
      setView({ type: 'project', project, tab: newTab })

    if (tab === 'workbench') {
      return (
        <ScriptWorkbench
          projectId={project.id}
          projectName={project.name}
          onHome={() => setView({ type: 'home' })}
          onSwitchToCanvas={() => switchTab('canvas')}
        />
      )
    }

    return (
      <ReactFlowProvider>
        <Canvas
          project={project}
          onHome={() => setView({ type: 'home' })}
          onSwitchToWorkbench={() => switchTab('workbench')}
        />
      </ReactFlowProvider>
    )
  }

  return (
    <ProjectHome
      onOpen={p => setView({ type: 'project', project: p, tab: 'canvas' })}
    />
  )
}
