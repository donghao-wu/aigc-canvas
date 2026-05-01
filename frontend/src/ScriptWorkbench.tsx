import React, { useState, useRef, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import axios from 'axios'
import { useTheme } from './ThemeContext'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ── 类型 ─────────────────────────────────────────────────────
interface GenerateParams {
  genre: string
  theme: string
  episodes: number
  duration: string
  protagonist: string
  style: string
  requirements: string
}

interface EpisodeOutline {
  index: number      // 0-based
  title: string
  plot: string
  hook: string
  ending: string
  raw: string        // original line for display
}

interface EpisodeDraft {
  index: number
  content: string
  summary: string
  status: 'pending' | 'generating' | 'done' | 'error'
}

interface ScriptData {
  params: GenerateParams | null
  storyBible: string
  episodeMapText: string
  episodeMap: EpisodeOutline[]
  episodes: EpisodeDraft[]
}

type SelectedItem = 'params' | 'bible' | 'map' | number

const GENRES  = ['都市', '古装', '悬疑', '甜宠', '逆袭', '职场', '家庭', '青春', '豪门', '其他']
const STYLES  = ['爽文', '轻喜', '正剧', '虐恋', '悬疑烧脑', '热血励志', '甜宠']
const DURATIONS = [
  { label: '1分钟/集', value: '1' },
  { label: '3分钟/集', value: '3' },
  { label: '5分钟/集', value: '5' },
]
const EPISODE_PRESETS = [10, 20, 30, 60, 80, 100]

const DEFAULT_PARAMS: GenerateParams = {
  genre: '都市', theme: '', episodes: 60, duration: '3',
  protagonist: '', style: '爽文', requirements: '',
}

const EMPTY_DATA: ScriptData = {
  params: null, storyBible: '', episodeMapText: '',
  episodeMap: [], episodes: [],
}

// ── SSE 流式请求 ─────────────────────────────────────────────
async function streamSSE(
  body: Record<string, unknown>,
  onChunk: (text: string) => void,
  onDone: (full: string) => void,
  onError: (msg: string) => void,
  signal?: AbortSignal,
) {
  try {
    const resp = await fetch('/api/script-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
      signal,
    })
    if (!resp.ok || !resp.body) { onError('请求失败'); return }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          if (parsed.error) { onError(parsed.error); return }
          if (parsed.text) { full += parsed.text; onChunk(parsed.text) }
        } catch {}
      }
    }
    onDone(full)
  } catch (e: any) {
    if (e.name === 'AbortError') return
    onError(e.message || '未知错误')
  }
}

// ── 解析集数大纲 ─────────────────────────────────────────────
function parseEpisodeMap(text: string): EpisodeOutline[] {
  const lines = text.split('\n').filter(l => /^第\d+集/.test(l.trim()))
  return lines.map(line => {
    const raw = line.trim()
    const titleMatch = raw.match(/^第(\d+)集《(.+?)》/)
    const plotMatch  = raw.match(/情节[：:]\s*(.+?)(?:\s*\||\s*$)/)
    const hookMatch  = raw.match(/钩子[：:]\s*(.+?)(?:\s*\||\s*$)/)
    const endMatch   = raw.match(/结尾[：:]\s*(.+?)(?:\s*$)/)
    return {
      index:  titleMatch ? parseInt(titleMatch[1]) - 1 : 0,
      title:  titleMatch ? titleMatch[2] : `第${raw.slice(1, 3)}集`,
      plot:   plotMatch  ? plotMatch[1].trim()  : '',
      hook:   hookMatch  ? hookMatch[1].trim()  : '',
      ending: endMatch   ? endMatch[1].trim()   : '',
      raw,
    }
  })
}

// ── 主组件 ───────────────────────────────────────────────────
interface Props {
  projectId: string
  projectName: string
  onHome: () => void
  onSwitchToCanvas: () => void
}

export default function ScriptWorkbench({ projectId, projectName, onHome, onSwitchToCanvas }: Props) {
  const { theme, T, toggle } = useTheme()

  // ── 核心状态 ───────────────────────────────────────────────
  const [data, setData]             = useState<ScriptData>(EMPTY_DATA)
  const [params, setParams]         = useState<GenerateParams>(DEFAULT_PARAMS)
  const [selected, setSelected]     = useState<SelectedItem>('params')
  const [streamBuf, setStreamBuf]   = useState('')   // 当前正在 stream 的文字
  const [busy, setBusy]             = useState(false)
  const [error, setError]           = useState('')
  const [paused, setPaused]         = useState(false)
  const [saveMsg, setSaveMsg]       = useState('')

  const abortRef    = useRef<AbortController | null>(null)
  const pauseRef    = useRef(false)
  const dataRef     = useRef<ScriptData>(EMPTY_DATA)  // always in sync with data
  dataRef.current   = data

  // ── 加载已保存的剧本数据 ──────────────────────────────────
  useEffect(() => {
    axios.get(`/api/projects/${projectId}/script`, { headers: authHeaders() })
      .then(({ data: saved }) => {
        if (saved.storyBible || saved.episodes?.length) {
          setData(saved)
          if (saved.params) setParams(saved.params)
          // 自动导航到合适位置
          if (saved.episodes?.length > 0) {
            const lastDone = saved.episodes.filter((e: EpisodeDraft) => e.status === 'done').length
            setSelected(lastDone > 0 ? lastDone - 1 : 'bible')
          } else if (saved.storyBible) {
            setSelected('bible')
          }
        }
      })
      .catch(() => {})
  }, [projectId])

  // ── 保存到后端 ────────────────────────────────────────────
  const saveToServer = useCallback(async (d: ScriptData) => {
    try {
      await axios.put(`/api/projects/${projectId}/script`, { ...d, params }, { headers: authHeaders() })
      setSaveMsg('已保存')
      setTimeout(() => setSaveMsg(''), 2000)
    } catch {}
  }, [projectId, params])

  const updateData = useCallback((patch: Partial<ScriptData>, save = false) => {
    setData(prev => {
      const next = { ...prev, ...patch }
      if (save) saveToServer(next)
      return next
    })
  }, [saveToServer])

  // ── 阶段计算 ─────────────────────────────────────────────
  const hasBible    = !!data.storyBible
  const hasMap      = data.episodeMap.length > 0
  const doneCount   = data.episodes.filter(e => e.status === 'done').length
  const totalEps    = params.episodes
  const allDone     = hasMap && doneCount >= totalEps

  // ── Step 1: 生成故事圣经 ──────────────────────────────────
  const handleGenerateBible = useCallback(() => {
    if (busy) return
    setBusy(true); setError(''); setStreamBuf(''); setSelected('bible')
    abortRef.current = new AbortController()

    let full = ''
    streamSSE(
      { mode: 'story_bible', ...params },
      chunk => { full += chunk; setStreamBuf(full) },
      fullText => {
        updateData({ storyBible: fullText, params }, true)
        setStreamBuf('')
        setBusy(false)
      },
      msg => { setError(msg); setBusy(false); setStreamBuf('') },
      abortRef.current.signal,
    )
  }, [busy, params, updateData])

  // ── Step 2: 生成集数大纲 ─────────────────────────────────
  const handleGenerateMap = useCallback(() => {
    if (busy || !hasBible) return
    setBusy(true); setError(''); setStreamBuf(''); setSelected('map')
    abortRef.current = new AbortController()

    let full = ''
    streamSSE(
      { mode: 'episode_map', storyBible: data.storyBible, episodes: params.episodes },
      chunk => { full += chunk; setStreamBuf(full) },
      fullText => {
        const map = parseEpisodeMap(fullText)
        const episodes: EpisodeDraft[] = Array.from({ length: params.episodes }, (_, i) => ({
          index: i, content: '', summary: '', status: 'pending',
        }))
        updateData({ episodeMapText: fullText, episodeMap: map, episodes }, true)
        setStreamBuf('')
        setBusy(false)
      },
      msg => { setError(msg); setBusy(false); setStreamBuf('') },
      abortRef.current.signal,
    )
  }, [busy, hasBible, data.storyBible, params.episodes, updateData])

  // ── Step 3: 逐集生成循环 ─────────────────────────────────
  const generateEpisodesFrom = useCallback(async (startIndex: number) => {
    const d = dataRef.current
    if (!d.storyBible || d.episodeMap.length === 0) return

    pauseRef.current = false
    setPaused(false)
    setBusy(true)
    setError('')

    const controller = new AbortController()
    abortRef.current = controller

    for (let i = startIndex; i < params.episodes; i++) {
      if (pauseRef.current || controller.signal.aborted) break

      // 标记当前集为 generating
      setData(prev => {
        const eps = [...prev.episodes]
        if (eps[i]) eps[i] = { ...eps[i], status: 'generating' }
        return { ...prev, episodes: eps }
      })
      setSelected(i)
      setStreamBuf('')

      const d2 = dataRef.current
      const outline = d2.episodeMap[i]
      const currentOutline = outline?.raw || `第${i + 1}集`
      const prevSummaries = d2.episodes
        .slice(Math.max(0, i - 5), i)
        .filter(e => e.summary)
        .map(e => e.summary)

      let epContent = ''
      let episodeError = false

      await new Promise<void>(resolve => {
        streamSSE(
          {
            mode: 'write_episode',
            storyBible: d2.storyBible,
            episodeMapText: d2.episodeMapText.slice(0, 2000),
            episodeIndex: i,
            currentOutline,
            previousSummaries: prevSummaries,
            duration: params.duration,
            totalEpisodes: params.episodes,
          },
          chunk => { epContent += chunk; setStreamBuf(epContent) },
          _full => { resolve() },
          msg => { setError(`第${i + 1}集生成失败: ${msg}`); episodeError = true; resolve() },
          controller.signal,
        )
      })

      if (pauseRef.current || controller.signal.aborted) {
        setData(prev => {
          const eps = [...prev.episodes]
          if (eps[i]) eps[i] = { ...eps[i], status: 'pending' }
          return { ...prev, episodes: eps }
        })
        break
      }

      // 摘要（快速）
      let summary = ''
      if (!episodeError && epContent) {
        await new Promise<void>(resolve => {
          streamSSE(
            { mode: 'summarize_episode', episodeContent: epContent, episodeIndex: i },
            chunk => { summary += chunk },
            _full => { resolve() },
            _err => { resolve() },
            controller.signal,
          )
        })
      }

      // 保存这集
      setData(prev => {
        const eps = [...prev.episodes]
        if (eps[i]) eps[i] = {
          ...eps[i],
          content: epContent,
          summary: summary.trim(),
          status: episodeError ? 'error' : 'done',
        }
        const next = { ...prev, episodes: eps }
        // 每5集保存一次，最后一集一定保存
        if (i % 5 === 4 || i === params.episodes - 1) saveToServer(next)
        return next
      })
      setStreamBuf('')
    }

    setBusy(false)
    if (pauseRef.current) setPaused(true)
  }, [params.episodes, params.duration, saveToServer])

  const handleStartEpisodes = useCallback(() => {
    const startFrom = data.episodes.findIndex(e => e.status === 'pending' || e.status === 'error')
    generateEpisodesFrom(startFrom === -1 ? 0 : startFrom)
  }, [data.episodes, generateEpisodesFrom])

  const handlePause = useCallback(() => {
    pauseRef.current = true
  }, [])

  const handleResume = useCallback(() => {
    const nextPending = dataRef.current.episodes.findIndex(e => e.status === 'pending' || e.status === 'error')
    if (nextPending === -1) return
    generateEpisodesFrom(nextPending)
  }, [generateEpisodesFrom])

  // ── 提取资产 ─────────────────────────────────────────────
  const handleExtractAssets = useCallback(() => {
    if (!data.storyBible) return
    // 用前5集内容 + 故事圣经作为资产提取源
    const sampleContent = data.episodes
      .filter(e => e.content)
      .slice(0, 5)
      .map(e => e.content)
      .join('\n\n---\n\n')
    const source = data.storyBible + (sampleContent ? '\n\n' + sampleContent : '')
    // 保存到 localStorage 让 ExtractAssets 使用
    localStorage.setItem(`extract_src_${projectId}`, source)
    alert('请切换到生图模块使用资产提取功能（功能完善中）')
  }, [data, projectId])

  // ── 工具 ─────────────────────────────────────────────────
  const setParam = <K extends keyof GenerateParams>(k: K, v: GenerateParams[K]) =>
    setParams(p => ({ ...p, [k]: v }))

  const updateEpisodeContent = (index: number, content: string) => {
    setData(prev => {
      const eps = [...prev.episodes]
      if (eps[index]) eps[index] = { ...eps[index], content }
      return { ...prev, episodes: eps }
    })
  }

  // ── 当前显示内容 ──────────────────────────────────────────
  const mainContent = () => {
    if (selected === 'params') return null  // 由下面的 ParamsForm 处理
    if (selected === 'bible') {
      const text = (busy && streamBuf && selected === 'bible') ? streamBuf : data.storyBible
      return <MarkdownView text={text} T={T} streaming={busy && selected === 'bible'} />
    }
    if (selected === 'map') {
      const text = (busy && streamBuf && selected === 'map') ? streamBuf : data.episodeMapText
      return <MarkdownView text={text} T={T} streaming={busy && selected === 'map'} />
    }
    if (typeof selected === 'number') {
      const ep = data.episodes[selected]
      const isGeneratingThis = busy && typeof selected === 'number'
        && data.episodes[selected]?.status === 'generating'
      const displayText = isGeneratingThis ? streamBuf : (ep?.content || '')
      return (
        <EpisodeContentView
          index={selected}
          content={displayText}
          streaming={isGeneratingThis}
          T={T}
          onChange={c => updateEpisodeContent(selected, c)}
        />
      )
    }
    return null
  }

  // ── 阶段指示器状态 ────────────────────────────────────────
  const phase =
    !hasBible ? 1 :
    !hasMap   ? 2 :
    doneCount < totalEps ? 3 : 4

  // ── 渲染 ─────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', background: T.canvasBg, overflow: 'hidden' }}>

      {/* ── 顶部导航 ───────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: T.headerBg, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <button onClick={onHome} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '3px 8px', borderRadius: 8 }}
          onMouseEnter={e => (e.currentTarget.style.background = T.nodeSubtle)}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(201,152,42,0.12)', border: '1px solid rgba(201,152,42,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/logo.svg" style={{ width: 13, height: 13 }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>壹镜</span>
        </button>
        <div style={{ width: 1, height: 16, background: T.border }} />
        <span style={{ fontSize: 13, color: T.textSub, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projectName}</span>
        <div style={{ width: 1, height: 16, background: T.border }} />
        <div style={{ display: 'flex', gap: 2, background: T.nodeSubtle, border: `1px solid ${T.border}`, borderRadius: 8, padding: 3 }}>
          <button style={{ fontSize: 12, fontWeight: 600, padding: '4px 14px', borderRadius: 6, border: 'none', cursor: 'default', background: theme === 'dark' ? 'rgba(201,152,42,0.18)' : 'rgba(184,135,14,0.12)', color: T.accent }}>剧本</button>
          <button onClick={onSwitchToCanvas} style={{ fontSize: 12, fontWeight: 400, padding: '4px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'transparent', color: T.textSub }}
            onMouseEnter={e => (e.currentTarget.style.color = T.text)}
            onMouseLeave={e => (e.currentTarget.style.color = T.textSub)}>生图</button>
        </div>
        <div style={{ flex: 1 }} />
        {busy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'rgba(201,152,42,0.1)', borderRadius: 6, border: '1px solid rgba(201,152,42,0.2)' }}>
            <span style={{ fontSize: 11, color: T.accent }}>
              {typeof selected === 'number'
                ? `生成第 ${selected + 1}/${totalEps} 集...`
                : selected === 'bible' ? '生成故事圣经...'
                : '生成集数大纲...'}
            </span>
          </div>
        )}
        {saveMsg && <span style={{ fontSize: 11, color: 'rgba(80,200,100,0.8)' }}>{saveMsg}</span>}
        {error && <span style={{ fontSize: 11, color: 'rgba(239,68,68,0.9)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={error}>{error}</span>}
        <button onClick={toggle} style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', padding: '3px 8px', color: T.textSub, borderRadius: 6 }}>
          {theme === 'dark' ? '◑ 浅色' : '◑ 深色'}
        </button>
      </div>

      {/* ── 阶段进度条 ─────────────────────────────────────── */}
      <PhaseBar phase={phase} doneCount={doneCount} totalEps={totalEps} T={T} />

      {/* ── 主体区域 ───────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* 左侧导航栏 */}
        <EpisodeNav
          data={data}
          selected={selected}
          busy={busy}
          streaming={busy ? streamBuf : ''}
          onSelect={setSelected}
          T={T}
          theme={theme}
        />

        {/* 主内容区 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'auto', padding: selected === 'params' ? 0 : 24 }}>
            {selected === 'params'
              ? (
                <ParamsForm
                  params={params}
                  setParam={setParam}
                  T={T}
                  theme={theme}
                  hasBible={hasBible}
                />
              )
              : mainContent()
            }
          </div>

          {/* 底部操作栏 */}
          <ActionBar
            phase={phase}
            busy={busy}
            paused={paused}
            hasBible={hasBible}
            hasMap={hasMap}
            doneCount={doneCount}
            totalEps={totalEps}
            allDone={allDone}
            onGenerateBible={handleGenerateBible}
            onGenerateMap={handleGenerateMap}
            onStartEpisodes={handleStartEpisodes}
            onPause={handlePause}
            onResume={handleResume}
            onSwitchToCanvas={onSwitchToCanvas}
            onExtractAssets={handleExtractAssets}
            T={T}
          />
        </div>
      </div>
    </div>
  )
}

// ── 阶段进度条 ───────────────────────────────────────────────
function PhaseBar({ phase, doneCount, totalEps, T }: { phase: number; doneCount: number; totalEps: number; T: any }) {
  const steps = [
    { n: 1, label: '① 生成配置' },
    { n: 2, label: '② 故事圣经' },
    { n: 3, label: '③ 集数大纲' },
    { n: 4, label: `④ 逐集生成 ${doneCount}/${totalEps}` },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 20px', borderBottom: `1px solid ${T.border}`, background: T.headerBg, flexShrink: 0, gap: 0 }}>
      {steps.map((s, i) => {
        const done = s.n < phase
        const active = s.n === phase
        return (
          <React.Fragment key={s.n}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 6,
              background: active ? 'rgba(201,152,42,0.12)' : 'transparent',
              border: active ? '1px solid rgba(201,152,42,0.3)' : '1px solid transparent',
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700,
                background: done ? 'rgba(80,200,100,0.2)' : active ? 'rgba(201,152,42,0.2)' : T.nodeSubtle,
                color: done ? 'rgba(80,200,100,0.9)' : active ? T.accent : T.textMuted,
                border: `1px solid ${done ? 'rgba(80,200,100,0.3)' : active ? 'rgba(201,152,42,0.4)' : T.border}`,
              }}>{done ? '✓' : s.n}</span>
              <span style={{ fontSize: 12, fontWeight: active ? 600 : 400, color: done ? 'rgba(80,200,100,0.8)' : active ? T.accent : T.textMuted }}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ width: 20, height: 1, background: T.border, margin: '0 2px' }} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ── 左侧导航 ─────────────────────────────────────────────────
function EpisodeNav({ data, selected, busy, streaming, onSelect, T, theme }: {
  data: ScriptData; selected: SelectedItem; busy: boolean; streaming: string
  onSelect: (s: SelectedItem) => void; T: any; theme: string
}) {
  const statusIcon = (ep: EpisodeDraft) => {
    if (ep.status === 'done') return '✓'
    if (ep.status === 'generating') return '⏳'
    if (ep.status === 'error') return '✗'
    return '○'
  }
  const statusColor = (ep: EpisodeDraft) => {
    if (ep.status === 'done') return 'rgba(80,200,100,0.8)'
    if (ep.status === 'generating') return T.accent
    if (ep.status === 'error') return 'rgba(239,68,68,0.8)'
    return T.textMuted
  }

  return (
    <div style={{
      width: 220, flexShrink: 0,
      borderRight: `1px solid ${T.border}`,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      background: theme === 'dark' ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)',
    }}>
      {/* 固定项：配置 / 故事圣经 / 集数大纲 */}
      <div style={{ flexShrink: 0, borderBottom: `1px solid ${T.border}` }}>
        {[
          { key: 'params' as SelectedItem, icon: '⚙️', label: '生成配置' },
          { key: 'bible' as SelectedItem, icon: '📖', label: '故事圣经', has: !!data.storyBible },
          { key: 'map' as SelectedItem, icon: '🗺', label: '集数大纲', has: data.episodeMap.length > 0 },
        ].map(item => (
          <button
            key={String(item.key)}
            onClick={() => onSelect(item.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '9px 14px', textAlign: 'left',
              background: selected === item.key ? (theme === 'dark' ? 'rgba(201,152,42,0.1)' : 'rgba(184,135,14,0.08)') : 'none',
              border: 'none', cursor: 'pointer',
              borderLeft: selected === item.key ? `2px solid ${T.accent}` : '2px solid transparent',
            }}
          >
            <span style={{ fontSize: 13 }}>{item.icon}</span>
            <span style={{ fontSize: 12, fontWeight: selected === item.key ? 600 : 400, color: selected === item.key ? T.text : T.textSub }}>
              {item.label}
            </span>
            {'has' in item && item.has && (
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(80,200,100,0.8)' }}>✓</span>
            )}
          </button>
        ))}
      </div>

      {/* 集数列表 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {data.episodes.length === 0 ? (
          <div style={{ padding: '12px 14px', fontSize: 11, color: T.textMuted, textAlign: 'center' }}>
            生成集数大纲后<br />此处显示集数列表
          </div>
        ) : (
          data.episodes.map((ep, i) => {
            const outline = data.episodeMap[i]
            const isSelected = selected === i
            return (
              <button
                key={i}
                onClick={() => onSelect(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '7px 14px', textAlign: 'left',
                  background: isSelected ? (theme === 'dark' ? 'rgba(201,152,42,0.1)' : 'rgba(184,135,14,0.08)') : 'none',
                  border: 'none', cursor: 'pointer',
                  borderLeft: isSelected ? `2px solid ${T.accent}` : '2px solid transparent',
                }}
              >
                <span style={{ fontSize: 10, color: statusColor(ep), width: 12, textAlign: 'center', flexShrink: 0 }}>
                  {statusIcon(ep)}
                </span>
                <span style={{
                  fontSize: 11,
                  fontWeight: isSelected ? 600 : 400,
                  color: ep.status === 'pending' ? T.textMuted : isSelected ? T.text : T.textSub,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  第{i + 1}集{outline?.title ? `《${outline.title}》` : ''}
                </span>
              </button>
            )
          })
        )}
      </div>

      {/* 进度摘要 */}
      {data.episodes.length > 0 && (
        <div style={{ flexShrink: 0, padding: '8px 14px', borderTop: `1px solid ${T.border}`, fontSize: 11, color: T.textMuted }}>
          {data.episodes.filter(e => e.status === 'done').length}/{data.episodes.length} 集已完成
        </div>
      )}
    </div>
  )
}

// ── 生成配置表单 ─────────────────────────────────────────────
function ParamsForm({ params, setParam, T, theme, hasBible }: {
  params: GenerateParams
  setParam: <K extends keyof GenerateParams>(k: K, v: GenerateParams[K]) => void
  T: any; theme: string; hasBible: boolean
}) {
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 7,
    border: `1px solid ${T.border}`, background: T.inputBg,
    color: T.text, fontSize: 13, outline: 'none',
  }
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 24px' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 6 }}>剧本生成配置</h2>
      <p style={{ fontSize: 13, color: T.textSub, marginBottom: 28 }}>
        填写完成后，系统将分三步自动生成：故事圣经 → 集数大纲 → 逐集剧本
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* 类型 */}
        <div>
          <label style={{ fontSize: 12, color: T.textMuted, display: 'block', marginBottom: 5 }}>短剧类型</label>
          <select value={params.genre} onChange={e => setParam('genre', e.target.value)} style={inputStyle}>
            {['都市', '古装', '悬疑', '甜宠', '逆袭', '职场', '家庭', '青春', '豪门', '其他'].map(g => <option key={g}>{g}</option>)}
          </select>
        </div>

        {/* 风格 */}
        <div>
          <label style={{ fontSize: 12, color: T.textMuted, display: 'block', marginBottom: 5 }}>叙事风格</label>
          <select value={params.style} onChange={e => setParam('style', e.target.value)} style={inputStyle}>
            {['爽文', '轻喜', '正剧', '虐恋', '悬疑烧脑', '热血励志', '甜宠'].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        {/* 总集数 */}
        <div>
          <label style={{ fontSize: 12, color: T.textMuted, display: 'block', marginBottom: 5 }}>总集数</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {[10, 20, 30, 60, 80, 100].map(n => (
              <button key={n} onClick={() => setParam('episodes', n)}
                style={{
                  padding: '4px 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer', border: `1px solid ${T.border}`,
                  background: params.episodes === n ? T.btnBg : T.nodeSubtle,
                  color: params.episodes === n ? T.btnText : T.textSub,
                }}>{n}集</button>
            ))}
          </div>
          <input type="number" min={1} max={200} value={params.episodes}
            onChange={e => setParam('episodes', Number(e.target.value))}
            style={inputStyle} placeholder="自定义集数" />
        </div>

        {/* 每集时长 */}
        <div>
          <label style={{ fontSize: 12, color: T.textMuted, display: 'block', marginBottom: 5 }}>每集时长</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ label: '1分钟', value: '1' }, { label: '3分钟', value: '3' }, { label: '5分钟', value: '5' }].map(d => (
              <button key={d.value} onClick={() => setParam('duration', d.value)}
                style={{
                  flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 12, cursor: 'pointer', border: `1px solid ${T.border}`,
                  background: params.duration === d.value ? T.btnBg : T.nodeSubtle,
                  color: params.duration === d.value ? T.btnText : T.textSub,
                }}>{d.label}</button>
            ))}
          </div>
        </div>

        {/* 主角设定 */}
        <div style={{ gridColumn: 'span 2' }}>
          <label style={{ fontSize: 12, color: T.textMuted, display: 'block', marginBottom: 5 }}>主角设定</label>
          <input type="text" value={params.protagonist} onChange={e => setParam('protagonist', e.target.value)}
            placeholder="例：28岁女律师，精英外表、内心脆弱，被前男友陷害入狱后重生复仇"
            style={inputStyle} />
        </div>

        {/* 题材/主题 */}
        <div style={{ gridColumn: 'span 2' }}>
          <label style={{ fontSize: 12, color: T.textMuted, display: 'block', marginBottom: 5 }}>题材 / 核心冲突</label>
          <input type="text" value={params.theme} onChange={e => setParam('theme', e.target.value)}
            placeholder="例：职场霸凌与重生复仇、豪门恩怨与身份揭秘、甜宠校园与隐婚秘密"
            style={inputStyle} />
        </div>

        {/* 特殊要求 */}
        <div style={{ gridColumn: 'span 2' }}>
          <label style={{ fontSize: 12, color: T.textMuted, display: 'block', marginBottom: 5 }}>特殊要求（可选）</label>
          <textarea value={params.requirements} onChange={e => setParam('requirements', e.target.value)}
            rows={3} placeholder="例：第一集必须以主角被陷害的场景开场；反派必须有合理的动机；结局要HE"
            style={{ ...inputStyle, resize: 'none', lineHeight: 1.6 }} />
        </div>
      </div>

      {hasBible && (
        <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(201,152,42,0.08)', border: '1px solid rgba(201,152,42,0.2)', borderRadius: 8, fontSize: 12, color: T.accent }}>
          ⚠️ 已有故事圣经。修改配置后重新生成将覆盖现有内容。
        </div>
      )}
    </div>
  )
}

// ── Markdown 内容查看器 ──────────────────────────────────────
function MarkdownView({ text, T, streaming }: { text: string; T: any; streaming: boolean }) {
  if (!text) return (
    <div style={{ textAlign: 'center', paddingTop: 80, color: T.textMuted }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
      <div style={{ fontSize: 13 }}>内容将在生成后显示在此处</div>
    </div>
  )
  return (
    <div style={{ fontSize: 13, lineHeight: 1.9, color: T.text, maxWidth: 720 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      {streaming && <span style={{ color: T.accent }}>▌</span>}
    </div>
  )
}

// ── 单集内容查看/编辑器 ──────────────────────────────────────
function EpisodeContentView({ index, content, streaming, T, onChange }: {
  index: number; content: string; streaming: boolean; T: any; onChange: (c: string) => void
}) {
  const [editing, setEditing] = useState(false)
  if (!content && !streaming) return (
    <div style={{ textAlign: 'center', paddingTop: 80, color: T.textMuted }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
      <div style={{ fontSize: 13 }}>第 {index + 1} 集尚未生成</div>
    </div>
  )
  if (editing) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button onClick={() => setEditing(false)} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, background: T.btnBg, color: T.btnText, border: 'none', cursor: 'pointer' }}>
          完成编辑
        </button>
      </div>
      <textarea
        value={content}
        onChange={e => onChange(e.target.value)}
        style={{ flex: 1, padding: 16, border: `1px solid ${T.border}`, borderRadius: 8, background: T.inputBg, color: T.text, fontSize: 13, lineHeight: 1.8, resize: 'none', outline: 'none' }}
      />
    </div>
  )
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        {!streaming && (
          <button onClick={() => setEditing(true)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, background: T.nodeSubtle, border: `1px solid ${T.border}`, color: T.textSub, cursor: 'pointer' }}>
            ✏️ 编辑
          </button>
        )}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.9, color: T.text, whiteSpace: 'pre-wrap', fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif' }}>
        {content}
        {streaming && <span style={{ color: T.accent }}>▌</span>}
      </div>
    </div>
  )
}

// ── 底部操作栏 ───────────────────────────────────────────────
function ActionBar({ phase, busy, paused, hasBible, hasMap, doneCount, totalEps, allDone,
  onGenerateBible, onGenerateMap, onStartEpisodes, onPause, onResume, onSwitchToCanvas, onExtractAssets, T
}: {
  phase: number; busy: boolean; paused: boolean; hasBible: boolean; hasMap: boolean
  doneCount: number; totalEps: number; allDone: boolean
  onGenerateBible: () => void; onGenerateMap: () => void
  onStartEpisodes: () => void; onPause: () => void; onResume: () => void
  onSwitchToCanvas: () => void; onExtractAssets: () => void; T: any
}) {
  const btn = (label: string, onClick: () => void, primary = false, disabled = false): React.ReactNode => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '9px 20px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
        background: disabled ? T.nodeSubtle : primary ? T.btnBg : T.nodeSubtle,
        color: disabled ? T.textMuted : primary ? T.btnText : T.textSub,
        border: `1px solid ${disabled ? T.border : primary ? 'transparent' : T.border}`,
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s',
      }}
    >{label}</button>
  )

  return (
    <div style={{
      flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
      padding: '12px 24px', borderTop: `1px solid ${T.border}`, background: T.headerBg,
    }}>
      {/* Step 1 */}
      {btn(hasBible ? '↺ 重新生成故事圣经' : '① 生成故事圣经', onGenerateBible, !hasBible, busy)}

      {/* Step 2 */}
      {hasBible && btn(hasMap ? '↺ 重新生成集数大纲' : '② 生成集数大纲', onGenerateMap, !hasMap, busy)}

      {/* Step 3 */}
      {hasMap && !allDone && !busy && !paused && (
        btn(doneCount > 0 ? `③ 继续生成（${doneCount}/${totalEps}）` : '③ 开始逐集生成', onStartEpisodes, true, busy)
      )}
      {hasMap && busy && (
        <button onClick={onPause} style={{ padding: '9px 20px', borderRadius: 7, fontSize: 13, fontWeight: 600, border: '1px solid rgba(239,68,68,0.4)', cursor: 'pointer', background: 'rgba(239,68,68,0.08)', color: 'rgba(239,68,68,0.9)' }}>
          ⏸ 暂停
        </button>
      )}
      {paused && btn('▶ 继续生成', onResume, true)}

      <div style={{ flex: 1 }} />

      {/* 完成后的选项 */}
      {allDone && (
        <>
          {btn('→ 进入生图模块', onSwitchToCanvas, true)}
        </>
      )}
      {hasBible && (
        <div style={{ fontSize: 11, color: T.textMuted }}>
          {doneCount > 0 ? `${doneCount}/${totalEps} 集` : ''}
        </div>
      )}
    </div>
  )
}
