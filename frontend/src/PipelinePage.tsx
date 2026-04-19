import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import axios from 'axios'
import { useTheme } from './ThemeContext'

// ── Types ────────────────────────────────────────────────────
export interface Shot {
  id: number
  location: string
  shotType: string
  angle: string
  desc: string
}

export interface PipelineAsset {
  id: string
  type: 'CHARACTER' | 'SCENE' | 'PROP'
  name: string
  desc: string
  prompt: string
  imageBase64?: string
  mimeType?: string
  savedId?: string
  status: 'pending' | 'generating' | 'done' | 'failed'
}

export interface PipelineVideo {
  shotId: number
  prompt: string
  taskId?: string
  videoUrl?: string
  status: 'pending' | 'submitting' | 'processing' | 'completed' | 'failed'
}

type StepStatus = 'idle' | 'running' | 'done' | 'failed'
type AssetStyle = '2D' | '3D' | '仿真人'

// ── Helpers ──────────────────────────────────────────────────

// Stream SSE from script-agent or asset-agent
async function streamSSE(
  url: string,
  body: object,
  onText: (accumulated: string) => void,
): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return full
        try {
          const p = JSON.parse(data)
          if (p.error) throw new Error(p.error)
          if (p.text) { full += p.text; onText(full) }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith('HTTP')) throw e
          if (e instanceof SyntaxError) continue
          // other unexpected errors: re-throw
          throw e
        }
      }
    }
  } finally {
    reader.cancel()
  }
  return full
}

// Parse outline text → Shot[]
function parseShotsFromOutline(text: string): Shot[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^镜头\s*\d+\s*\|/.test(l))
    .map(line => {
      const parts = line.split('|').map(s => s.trim())
      const id = parseInt(parts[0]?.match(/\d+/)?.[0] ?? '0', 10)
      const location = parts[1] ?? ''
      const shotType = parts[2] ?? ''
      const rest = parts[3] ?? ''
      const dashIdx = rest.indexOf('—')
      const angle = dashIdx > -1 ? rest.slice(0, dashIdx).trim() : rest
      const desc  = dashIdx > -1 ? rest.slice(dashIdx + 1).trim() : ''
      return { id, location, shotType, angle, desc }
    })
    .filter(s => s.id > 0)
}

// Parse asset-agent output → PipelineAsset[]
function parseAssetsFromText(raw: string): PipelineAsset[] {
  const items: PipelineAsset[] = []
  const blockRe = /===ASSET_START===([\s\S]*?)===ASSET_END===/g
  let match
  while ((match = blockRe.exec(raw)) !== null) {
    const inner = match[1].trim()
    const get = (key: string) => {
      const m = inner.match(new RegExp(`^${key}:\\s*(.+)`, 'm'))
      return m ? m[1].trim() : ''
    }
    const type = get('TYPE') as PipelineAsset['type']
    if (!['CHARACTER', 'SCENE', 'PROP'].includes(type)) continue
    items.push({
      id: `asset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      name:   get('NAME') || '未命名',
      desc:   get('DESC'),
      prompt: get('PROMPT'),
      status: 'pending',
    })
  }
  return items
}

// Parse prompts-mode output → { shotId, prompt }[]
function parseVideoPrompts(raw: string): { shotId: number; prompt: string }[] {
  return raw
    .split(/(?=^镜头\s*\d+\s*\|)/m)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => ({
      shotId: parseInt(p.match(/^镜头\s*(\d+)/)?.[1] ?? '0', 10),
      prompt: p,
    }))
    .filter(p => p.shotId > 0)
}

// Run items in batches of batchSize, calling fn for each
async function runBatched<T>(
  items: T[],
  batchSize: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize)
    await Promise.allSettled(chunk.map((item, j) => fn(item, i + j)))
  }
}

// ── Step Card ────────────────────────────────────────────────
const STATUS_LABEL: Record<StepStatus, string> = {
  idle: '待执行', running: '运行中', done: '完成', failed: '失败',
}
const STATUS_COLOR: Record<StepStatus, string> = {
  idle: 'rgba(255,255,255,0.25)',
  running: 'rgba(251,191,36,0.9)',
  done: 'rgba(52,211,153,0.9)',
  failed: 'rgba(248,113,113,0.9)',
}

function StepCard({
  step, title, status, canRun, onRun, children,
}: {
  step: number; title: string; status: StepStatus
  canRun: boolean; onRun: () => void; children?: ReactNode
}) {
  const { T } = useTheme()
  return (
    <div style={{
      background: T.nodeBg,
      border: `1px solid ${T.border}`,
      borderRadius: 10,
      marginBottom: 12,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderBottom: children ? `1px solid ${T.border}` : 'none',
        background: T.nodeSubtle,
      }}>
        <span style={{
          width: 22, height: 22, borderRadius: '50%',
          background: 'rgba(201,152,42,0.15)',
          border: '1px solid rgba(201,152,42,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, color: 'rgba(201,152,42,0.9)',
          flexShrink: 0,
        }}>{step}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>{title}</span>
        <span style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 10,
          background: STATUS_COLOR[status] + '22',
          color: STATUS_COLOR[status],
          border: `1px solid ${STATUS_COLOR[status]}44`,
          fontWeight: 500,
        }}>{STATUS_LABEL[status]}</span>
        <button
          onClick={onRun}
          disabled={!canRun}
          style={{
            fontSize: 11, padding: '4px 12px', borderRadius: 6,
            background: canRun ? 'rgba(201,152,42,0.15)' : T.inputBg,
            border: `1px solid ${canRun ? 'rgba(201,152,42,0.4)' : T.border}`,
            color: canRun ? 'rgba(201,152,42,0.9)' : T.textMuted,
            cursor: canRun ? 'pointer' : 'not-allowed',
            fontWeight: 500, transition: 'all 0.15s',
          }}
        >
          {status === 'running' ? '运行中...' : '执行'}
        </button>
      </div>
      {children && <div style={{ padding: '12px 14px' }}>{children}</div>}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────
interface Props {
  projectId: string
  projectName: string
  onHome: () => void
  onSwitchToCanvas: () => void
}

export default function PipelinePage({ projectId, projectName, onHome, onSwitchToCanvas }: Props) {
  const { T } = useTheme()

  // ── Input state
  const [script, setScript]     = useState('')
  const [style, setStyle]       = useState<AssetStyle>('3D')

  // ── Step statuses
  const [step1Status, setStep1Status] = useState<StepStatus>('idle')
  const [step2Status, setStep2Status] = useState<StepStatus>('idle')
  const [step3Status, setStep3Status] = useState<StepStatus>('idle')
  const [step4Status, setStep4Status] = useState<StepStatus>('idle')

  // ── Step results
  const [outlineText, setOutlineText] = useState('')
  const [shots, setShots]             = useState<Shot[]>([])
  const [assets, setAssets]           = useState<PipelineAsset[]>([])
  const [videos, setVideos]           = useState<PipelineVideo[]>([])
  const [manifestFolder, setManifestFolder] = useState<string | null>(null)

  // ── Step 1: 剧本拆解 ─────────────────────────────────────────
  const handleStep1 = useCallback(async () => {
    if (!script.trim() || step1Status === 'running') return
    setStep1Status('running')
    setOutlineText('')
    setShots([])
    try {
      const full = await streamSSE(
        '/api/script-agent',
        { mode: 'outline', script },
        (acc) => setOutlineText(acc),
      )
      const parsed = parseShotsFromOutline(full)
      if (parsed.length === 0) throw new Error('未能解析出镜头，请检查剧本格式')
      setShots(parsed)
      setStep1Status('done')
    } catch (err) {
      setStep1Status('failed')
      setOutlineText(prev => prev + `\n\n❌ 错误：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [script, step1Status])

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: T.canvasBg, color: T.text, fontFamily: 'inherit',
    }}>
      {/* Top Nav */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 16px', height: 44,
        background: T.nodeBg, borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>壹镜</span>
        <span style={{ fontSize: 11, color: T.textMuted }}>{projectName}</span>
        <div style={{ flex: 1 }} />
        {[
          { label: '画布', onClick: onSwitchToCanvas },
          { label: '首页', onClick: onHome },
        ].map(item => (
          <button key={item.label} onClick={item.onClick} style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 6,
            background: 'transparent', border: `1px solid ${T.border}`,
            color: T.textSub, cursor: 'pointer',
          }}>{item.label}</button>
        ))}
        <span style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 6,
          background: 'rgba(201,152,42,0.15)',
          border: '1px solid rgba(201,152,42,0.3)',
          color: 'rgba(201,152,42,0.9)', fontWeight: 600,
        }}>Pipeline</span>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left: input panel */}
        <div style={{
          width: 260, flexShrink: 0,
          borderRight: `1px solid ${T.border}`,
          padding: 14, display: 'flex', flexDirection: 'column', gap: 12,
          overflowY: 'auto',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>剧本</div>
          <textarea
            value={script}
            onChange={e => setScript(e.target.value)}
            placeholder="粘贴剧本内容..."
            rows={16}
            style={{
              width: '100%', resize: 'none', outline: 'none',
              padding: '8px 10px', borderRadius: 7, fontSize: 12,
              background: T.inputBg, border: `1px solid ${T.border}`,
              color: T.text, lineHeight: 1.65, boxSizing: 'border-box',
            }}
          />

          <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>风格</div>
          {(['2D', '3D', '仿真人'] as AssetStyle[]).map(s => (
            <button key={s} onClick={() => setStyle(s)} style={{
              padding: '6px 0', borderRadius: 6, fontSize: 12,
              background: style === s ? 'rgba(201,152,42,0.15)' : T.inputBg,
              border: `1px solid ${style === s ? 'rgba(201,152,42,0.4)' : T.border}`,
              color: style === s ? 'rgba(201,152,42,0.9)' : T.textSub,
              cursor: 'pointer', fontWeight: style === s ? 600 : 400,
              transition: 'all 0.15s',
            }}>{s}</button>
          ))}
        </div>

        {/* Right: steps */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

          {/* Step 1 */}
          <StepCard
            step={1} title="剧本拆解 · 生成分镜大纲"
            status={step1Status}
            canRun={!!script.trim() && step1Status !== 'running'}
            onRun={handleStep1}
          >
            {outlineText && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {shots.length > 0 && (
                  <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>
                    已解析 {shots.length} 个镜头
                  </div>
                )}
                <div style={{
                  maxHeight: 200, overflowY: 'auto',
                  background: T.nodeSubtle, borderRadius: 6,
                  padding: '8px 10px', fontSize: 11, color: T.textSub,
                  lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: 'monospace',
                }}>
                  {outlineText}
                </div>
              </div>
            )}
          </StepCard>

          {/* Steps 2–4 placeholder rendered in Tasks 4–6 */}
          <Step2
            status={step2Status} setStatus={setStep2Status}
            shots={shots} script={script} style={style}
            assets={assets} setAssets={setAssets}
            enabled={step1Status === 'done'}
          />
          <Step3
            status={step3Status} setStatus={setStep3Status}
            shots={shots} assets={assets}
            videos={videos} setVideos={setVideos}
            enabled={step2Status === 'done'}
          />
          <Step4
            status={step4Status} setStatus={setStep4Status}
            projectName={projectName}
            shots={shots} assets={assets} videos={videos}
            manifestFolder={manifestFolder} setManifestFolder={setManifestFolder}
            enabled={step3Status === 'done'}
          />

        </div>
      </div>
    </div>
  )
}

// ── Placeholder components (replaced in Tasks 4–6) ───────────
function Step2({ status, setStatus, shots, script, style, assets, setAssets, enabled }: {
  status: StepStatus; setStatus: (s: StepStatus) => void
  shots: Shot[]; script: string; style: AssetStyle
  assets: PipelineAsset[]; setAssets: (a: PipelineAsset[]) => void
  enabled: boolean
}) {
  const { T } = useTheme()
  const [streamText, setStreamText] = useState('')
  const assetsRef = useRef<PipelineAsset[]>([])

  const handleRun = useCallback(async () => {
    if (!enabled || status === 'running') return
    setStatus('running')
    setStreamText('')
    assetsRef.current = []
    setAssets([])

    try {
      // 1. Call asset-agent to get prompts
      const full = await streamSSE(
        '/api/asset-agent',
        { mode: 'detailed', style, script, promptTexts: shots.map(s => `镜头 ${s.id} | ${s.location} | ${s.shotType} | ${s.angle} — ${s.desc}`) },
        (acc) => setStreamText(acc),
      )

      const parsed = parseAssetsFromText(full)
      if (parsed.length === 0) throw new Error('未解析到任何资产，请检查剧本内容')

      assetsRef.current = parsed
      setAssets([...parsed])

      // 2. Batch generate images 3 at a time
      await runBatched(parsed, 3, async (asset, index) => {
        assetsRef.current = assetsRef.current.map((a, i) =>
          i === index ? { ...a, status: 'generating' } : a
        )
        setAssets([...assetsRef.current])

        try {
          const { data } = await axios.post<{ base64: string; mimeType: string; savedId: string }>('/api/generate-image', {
            prompt: asset.prompt,
            model: 'wanx2.1-t2i-turbo',
            aspectRatio: asset.type === 'CHARACTER' ? '3:4' : '16:9',
          })
          assetsRef.current = assetsRef.current.map((a, i) =>
            i === index ? { ...a, status: 'done', imageBase64: data.base64 ?? '', mimeType: data.mimeType ?? 'image/jpeg', savedId: data.savedId } : a
          )
        } catch {
          assetsRef.current = assetsRef.current.map((a, i) =>
            i === index ? { ...a, status: 'failed' } : a
          )
        }
        setAssets([...assetsRef.current])
      })

      const anyDone = assetsRef.current.some(a => a.status === 'done')
      setStatus(anyDone ? 'done' : 'failed')
    } catch (err) {
      setStatus('failed')
    }
  }, [enabled, status, shots, script, style, setStatus, setAssets])

  const TYPE_LABEL: Record<PipelineAsset['type'], string> = { CHARACTER: '角色', SCENE: '场景', PROP: '道具' }
  const TYPE_COLOR: Record<PipelineAsset['type'], string> = {
    CHARACTER: 'rgba(167,139,250,0.9)',
    SCENE: 'rgba(52,211,153,0.9)',
    PROP: 'rgba(251,191,36,0.9)',
  }

  return (
    <StepCard step={2} title="角色/场景设计生图" status={status}
      canRun={enabled && status !== 'running'} onRun={handleRun}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {streamText && assets.length === 0 && (
          <div style={{
            fontSize: 11, color: T.textSub, background: T.nodeSubtle,
            borderRadius: 6, padding: '6px 10px', maxHeight: 80,
            overflowY: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace',
          }}>{streamText.slice(-300)}</div>
        )}
        {assets.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {assets.map(asset => (
              <div key={asset.id} style={{
                width: 120, borderRadius: 8, overflow: 'hidden',
                background: T.nodeSubtle, border: `1px solid ${T.border}`,
                display: 'flex', flexDirection: 'column',
              }}>
                <div style={{ height: 90, background: T.inputBg, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  {asset.imageBase64 ? (
                    <img src={`data:${asset.mimeType};base64,${asset.imageBase64}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={asset.name} />
                  ) : (
                    <span style={{ fontSize: 18 }}>
                      {asset.status === 'generating' ? '⏳' : asset.status === 'failed' ? '❌' : '🖼️'}
                    </span>
                  )}
                  <span style={{
                    position: 'absolute', top: 4, left: 4,
                    fontSize: 9, padding: '1px 5px', borderRadius: 4,
                    background: TYPE_COLOR[asset.type] + '33',
                    color: TYPE_COLOR[asset.type],
                    border: `1px solid ${TYPE_COLOR[asset.type]}66`,
                    fontWeight: 600,
                  }}>{TYPE_LABEL[asset.type]}</span>
                </div>
                <div style={{ padding: '5px 6px', fontSize: 10, color: T.textSub, lineHeight: 1.4 }}>
                  {asset.name}
                </div>
              </div>
            ))}
          </div>
        )}
        {assets.length > 0 && (
          <div style={{ fontSize: 11, color: T.textMuted }}>
            {assets.filter(a => a.status === 'done').length}/{assets.length} 完成
            {assets.some(a => a.status === 'failed') && ` · ${assets.filter(a => a.status === 'failed').length} 失败`}
          </div>
        )}
      </div>
    </StepCard>
  )
}

function Step3({ status, setStatus, shots, assets, videos, setVideos, enabled }: {
  status: StepStatus; setStatus: (s: StepStatus) => void
  shots: Shot[]; assets: PipelineAsset[]
  videos: PipelineVideo[]; setVideos: (v: PipelineVideo[]) => void
  enabled: boolean
}) {
  const { T } = useTheme()
  const [promptText, setPromptText] = useState('')
  const videosRef = useRef<PipelineVideo[]>([])
  const pollsRef  = useRef<Map<number, ReturnType<typeof setInterval>>>(new Map())

  const stopAllPolls = useCallback(() => {
    pollsRef.current.forEach(timer => clearInterval(timer))
    pollsRef.current.clear()
  }, [])

  const pollVideo = useCallback((shotId: number, taskId: string) => {
    const timer = setInterval(async () => {
      try {
        const { data } = await axios.get<{ status: string; progress?: number; videoUrl?: string }>('/api/video-status', { params: { taskId } })
        videosRef.current = videosRef.current.map(v =>
          v.shotId === shotId
            ? { ...v,
                status: data.status === 'completed' ? 'completed' : data.status === 'failed' ? 'failed' : 'processing',
                videoUrl: data.videoUrl ?? v.videoUrl }
            : v
        )
        setVideos([...videosRef.current])
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(pollsRef.current.get(shotId))
          pollsRef.current.delete(shotId)
        }
      } catch { /* ignore transient poll errors */ }
    }, 5000)
    pollsRef.current.set(shotId, timer)
  }, [setVideos])

  const handleRun = useCallback(async () => {
    if (!enabled || status === 'running') return
    stopAllPolls()
    setStatus('running')
    setPromptText('')
    videosRef.current = []
    setVideos([])

    try {
      // 1. Get video prompts from script-agent
      const shotsForPrompts = shots.map(s => ({
        header: `镜头 ${String(s.id).padStart(2, '0')} | ${s.location} | ${s.shotType} | ${s.angle} — ${s.desc}`,
        details: '',
        isGroup: false,
      }))
      const full = await streamSSE(
        '/api/script-agent',
        { mode: 'prompts', shots: shotsForPrompts },
        (acc) => setPromptText(acc),
      )

      const videoPrompts = parseVideoPrompts(full)
      if (videoPrompts.length === 0) throw new Error('未解析到视频提示词')

      const initial: PipelineVideo[] = videoPrompts.map(vp => ({ shotId: vp.shotId, prompt: vp.prompt, status: 'pending' }))
      videosRef.current = initial
      setVideos([...initial])

      // 2. Batch submit videos 3 at a time
      await runBatched(videoPrompts, 3, async (vp, index) => {
        videosRef.current = videosRef.current.map((v, i) =>
          i === index ? { ...v, status: 'submitting' } : v
        )
        setVideos([...videosRef.current])

        try {
          const { data } = await axios.post<{ taskId: string }>('/api/generate-video', {
            prompt: vp.prompt,
            model: 'wan_landscape',
          })
          const taskId = data.taskId
          videosRef.current = videosRef.current.map((v, i) =>
            i === index ? { ...v, taskId, status: 'processing' } : v
          )
          setVideos([...videosRef.current])
          pollVideo(vp.shotId, taskId)
        } catch {
          videosRef.current = videosRef.current.map((v, i) =>
            i === index ? { ...v, status: 'failed' } : v
          )
          setVideos([...videosRef.current])
        }
      })

      const anySubmitted = videosRef.current.some(v => v.status !== 'failed')
      setStatus(anySubmitted ? 'done' : 'failed')
    } catch (err) {
      setStatus('failed')
    }
  }, [enabled, status, shots, setStatus, setVideos, pollVideo, stopAllPolls])

  // Clean up polls on unmount
  useEffect(() => () => stopAllPolls(), [stopAllPolls])

  const VIDEO_STATUS_ICON: Record<PipelineVideo['status'], string> = {
    pending: '⏸️', submitting: '📤', processing: '⏳', completed: '✅', failed: '❌',
  }

  return (
    <StepCard step={3} title="分镜视频生成" status={status}
      canRun={enabled && status !== 'running'} onRun={handleRun}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {promptText && videos.length === 0 && (
          <div style={{
            fontSize: 11, color: T.textSub, background: T.nodeSubtle,
            borderRadius: 6, padding: '6px 10px', maxHeight: 60, overflowY: 'auto',
            whiteSpace: 'pre-wrap', fontFamily: 'monospace',
          }}>{promptText.slice(-200)}</div>
        )}
        {videos.map(v => (
          <div key={v.shotId} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 6,
            background: T.nodeSubtle, border: `1px solid ${T.border}`,
          }}>
            <span style={{ fontSize: 12 }}>{VIDEO_STATUS_ICON[v.status]}</span>
            <span style={{ fontSize: 11, color: T.textMuted, width: 56, flexShrink: 0 }}>镜头 {v.shotId}</span>
            <span style={{ fontSize: 11, color: T.textSub, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {v.prompt.slice(0, 60)}...
            </span>
            {v.videoUrl && v.status === 'completed' && (
              <a href={v.videoUrl} target="_blank" rel="noreferrer"
                style={{ fontSize: 10, color: 'rgba(201,152,42,0.9)', textDecoration: 'none' }}>预览</a>
            )}
          </div>
        ))}
        {videos.length > 0 && (
          <div style={{ fontSize: 11, color: T.textMuted }}>
            {videos.filter(v => v.status === 'completed').length}/{videos.length} 完成
          </div>
        )}
      </div>
    </StepCard>
  )
}

function Step4({ status, setStatus, projectName, shots, assets, videos, manifestFolder, setManifestFolder, enabled }: {
  status: StepStatus; setStatus: (s: StepStatus) => void
  projectName: string; shots: Shot[]; assets: PipelineAsset[]; videos: PipelineVideo[]
  manifestFolder: string | null; setManifestFolder: (f: string) => void
  enabled: boolean
}) {
  const { T } = useTheme()
  const [error, setError] = useState<string | null>(null)

  const handleRun = useCallback(async () => {
    if (!enabled || status === 'running') return
    setStatus('running')
    setError(null)

    try {
      const { data } = await axios.post<{ ok: boolean; folder: string; path: string }>('/api/pipeline/save-manifest', {
        projectName,
        shots,
        assets: assets.map(a => ({ type: a.type, name: a.name, prompt: a.prompt, savedId: a.savedId })),
        videos: videos.map(v => ({ shotId: v.shotId, prompt: v.prompt, taskId: v.taskId, status: v.status, videoUrl: v.videoUrl })),
      })
      setManifestFolder(data.folder)
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : '归档失败')
      setStatus('failed')
    }
  }, [enabled, status, projectName, shots, assets, videos, setStatus, setManifestFolder])

  return (
    <StepCard step={4} title="素材归档" status={status}
      canRun={enabled && status !== 'running'} onRun={handleRun}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {error && (
          <div style={{
            fontSize: 11, color: 'rgba(248,113,113,0.9)', padding: '6px 10px',
            borderRadius: 6, background: 'rgba(248,113,113,0.08)',
            border: '1px solid rgba(248,113,113,0.2)',
          }}>
            ❌ {error}
          </div>
        )}
        {manifestFolder && (
          <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ color: 'rgba(52,211,153,0.9)', fontWeight: 600 }}>✅ 归档完成</div>
            <div style={{ color: T.textMuted }}>📁 pipeline-output/{manifestFolder}/</div>
            <div style={{ color: T.textSub, paddingLeft: 16 }}>📄 manifest.json</div>
            <div style={{ color: T.textSub, paddingLeft: 16 }}>🖼️ {assets.filter(a => a.savedId).length} 张设计图</div>
            <div style={{ color: T.textSub, paddingLeft: 16 }}>🎬 {videos.length} 个视频任务</div>
            <div style={{
              marginTop: 4, padding: '6px 10px', borderRadius: 6,
              background: T.nodeSubtle, border: `1px solid ${T.border}`,
            }}>
              <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 4 }}>素材统计</div>
              <div style={{ fontSize: 11, color: T.textSub }}>
                镜头数：{shots.length} ·
                角色：{assets.filter(a => a.type === 'CHARACTER').length} ·
                场景：{assets.filter(a => a.type === 'SCENE').length} ·
                视频完成：{videos.filter(v => v.status === 'completed').length}/{videos.length}
              </div>
            </div>
          </div>
        )}
        {!manifestFolder && !error && (
          <div style={{ fontSize: 11, color: T.textMuted }}>
            将保存到 backend/pipeline-output/ 目录
          </div>
        )}
      </div>
    </StepCard>
  )
}
