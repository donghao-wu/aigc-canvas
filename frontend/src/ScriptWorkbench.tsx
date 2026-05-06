import React, { useState, useRef, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import axios from 'axios'
import { useTheme } from './ThemeContext'
import StudioHeader from './StudioHeader'

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

interface StyleConfig {
  visualStyle: '2D漫画' | '3D渲染' | '写实'
  artStyle: string
  customStyle: string
}

const VISUAL_STYLES: Array<StyleConfig['visualStyle']> = ['2D漫画', '3D渲染', '写实']
const ART_STYLES = ['新海诚', '吉卜力', '国风漫画', '韩漫平涂', '欧美CG', '自定义'] as const
const DEFAULT_STYLE_CONFIG: StyleConfig = { visualStyle: '2D漫画', artStyle: '韩漫平涂', customStyle: '' }

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
  styleConfig: StyleConfig
  storyBible: string
  characterBios: string
  assetRegistry: string
  episodeMapText: string
  episodeMap: EpisodeOutline[]
  episodes: EpisodeDraft[]
}

type SelectedItem = 'params' | 'bible' | 'bios' | 'assets' | 'map' | number

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
  params: null, styleConfig: DEFAULT_STYLE_CONFIG,
  storyBible: '', characterBios: '', assetRegistry: '',
  episodeMapText: '', episodeMap: [], episodes: [],
}

// ── 下载工具 ─────────────────────────────────────────────────
function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
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
  onSwitchToAssets?: () => void
}

export default function ScriptWorkbench({ projectId, projectName, onHome, onSwitchToCanvas, onSwitchToAssets }: Props) {
  const { theme, T } = useTheme()

  // ── 核心状态 ───────────────────────────────────────────────
  const [data, setData]             = useState<ScriptData>(EMPTY_DATA)
  const [params, setParams]         = useState<GenerateParams>(DEFAULT_PARAMS)
  const [styleConfig, setStyleConfig] = useState<StyleConfig>(DEFAULT_STYLE_CONFIG)
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
          if (saved.styleConfig) setStyleConfig(saved.styleConfig)
          // 自动导航到合适位置
          if (saved.episodes?.length > 0) {
            const lastDone = saved.episodes.filter((e: EpisodeDraft) => e.status === 'done').length
            setSelected(lastDone > 0 ? lastDone - 1 : 'bible')
          } else if (saved.characterBios) {
            setSelected('bios')
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
  const hasBios     = !!data.characterBios
  const hasAssets   = !!data.assetRegistry
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
      { mode: 'story_bible', projectId, ...params },
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

  // ── Step 2: 生成角色小传 ─────────────────────────────────
  const handleGenerateBios = useCallback(() => {
    if (busy || !hasBible) return
    setBusy(true); setError(''); setStreamBuf(''); setSelected('bios')
    abortRef.current = new AbortController()

    let full = ''
    streamSSE(
      { mode: 'character_bios', projectId, storyBible: data.storyBible },
      chunk => { full += chunk; setStreamBuf(full) },
      fullText => {
        updateData({ characterBios: fullText }, true)
        setStreamBuf('')
        setBusy(false)
      },
      msg => { setError(msg); setBusy(false); setStreamBuf('') },
      abortRef.current.signal,
    )
  }, [busy, hasBible, data.storyBible, updateData])

  // ── Step 3: 生成资产登记册 ───────────────────────────────
  const handleGenerateAssets = useCallback(() => {
    if (busy || !hasBible || !hasBios) return
    setBusy(true); setError(''); setStreamBuf(''); setSelected('assets')
    abortRef.current = new AbortController()

    let full = ''
    streamSSE(
      { mode: 'asset_registry', projectId, storyBible: data.storyBible, characterBios: data.characterBios, styleConfig },
      chunk => { full += chunk; setStreamBuf(full) },
      fullText => {
        updateData({ assetRegistry: fullText, styleConfig }, true)
        setStreamBuf('')
        setBusy(false)
      },
      msg => { setError(msg); setBusy(false); setStreamBuf('') },
      abortRef.current.signal,
    )
  }, [busy, hasBible, hasBios, data.storyBible, data.characterBios, styleConfig, updateData])

  // ── Step 4: 生成集数大纲 ─────────────────────────────────
  const handleGenerateMap = useCallback(() => {
    if (busy || !hasBible || !hasBios || !hasAssets) return
    setBusy(true); setError(''); setStreamBuf(''); setSelected('map')
    abortRef.current = new AbortController()

    let full = ''
    streamSSE(
      { mode: 'episode_map', projectId, storyBible: data.storyBible, characterBios: data.characterBios, assetRegistry: data.assetRegistry, episodes: params.episodes },
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
  }, [busy, hasBible, hasBios, hasAssets, data.storyBible, data.characterBios, data.assetRegistry, params.episodes, updateData])

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
            projectId,
            storyBible: d2.storyBible,
            characterBios: d2.characterBios,
            assetRegistry: d2.assetRegistry,
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
            { mode: 'summarize_episode', projectId, episodeContent: epContent, episodeIndex: i },
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
  // ── 下载全集 ─────────────────────────────────────────────
  const handleDownloadAll = useCallback(() => {
    const done = data.episodes.filter(e => e.content)
    if (done.length === 0) return
    const content = done.map(e => e.content).join('\n\n' + '─'.repeat(40) + '\n\n')
    downloadText(`${projectName}-完整剧本.txt`, content)
  }, [data.episodes, projectName])

  const mainContent = () => {
    if (selected === 'params') return null  // 由下面的 ParamsForm 处理
    if (selected === 'bible') {
      const text = (busy && streamBuf && selected === 'bible') ? streamBuf : data.storyBible
      return <MarkdownView text={text} T={T} streaming={busy && selected === 'bible'}
        onDownload={data.storyBible && !busy ? () => downloadText(`${projectName}-故事圣经.md`, data.storyBible) : undefined} />
    }
    if (selected === 'bios') {
      const text = (busy && streamBuf && selected === 'bios') ? streamBuf : data.characterBios
      return <BiosView text={text} T={T} streaming={busy && selected === 'bios'}
        onDownload={data.characterBios && !busy ? () => downloadText(`${projectName}-角色小传.txt`, data.characterBios) : undefined} />
    }
    if (selected === 'assets') {
      const text = (busy && streamBuf && selected === 'assets') ? streamBuf : data.assetRegistry
      return <AssetRegistryView text={text} T={T} streaming={busy && selected === 'assets'} projectName={projectName}
        onDownload={data.assetRegistry && !busy ? () => downloadText(`${projectName}-资产登记册.txt`, data.assetRegistry) : undefined}
        onSwitchToCanvas={onSwitchToCanvas} />
    }
    if (selected === 'map') {
      const text = (busy && streamBuf && selected === 'map') ? streamBuf : data.episodeMapText
      return <EpisodeMapView text={text} T={T} streaming={busy && selected === 'map'}
        onDownload={data.episodeMapText && !busy ? () => downloadText(`${projectName}-集数大纲.txt`, data.episodeMapText) : undefined} />
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
    !hasBible   ? 1 :
    !hasBios    ? 2 :
    !hasAssets  ? 3 :
    !hasMap     ? 4 :
    doneCount < totalEps ? 5 : 6

  // ── 渲染 ─────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100vw',
      height: '100vh',
      background: theme === 'dark'
        ? 'radial-gradient(circle at top left, rgba(201,152,42,0.12), transparent 30%), #08090B'
        : 'radial-gradient(circle at top left, rgba(184,135,14,0.13), transparent 32%), #F3EFE4',
      overflow: 'hidden',
    }}>

      {/* ── 顶部导航 ───────────────────────────────────────── */}
      <StudioHeader
        projectName={projectName}
        active="script"
        projectId={projectId}
        onHome={onHome}
        onSwitchToCanvas={onSwitchToCanvas}
        onSwitchToAssets={onSwitchToAssets}
        status={(
          <>
            {busy && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'rgba(201,152,42,0.1)', borderRadius: 8, border: '1px solid rgba(201,152,42,0.2)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.accent }} />
                <span style={{ fontSize: 11, color: T.accent, whiteSpace: 'nowrap' }}>
                  {typeof selected === 'number'
                    ? `生成第 ${selected + 1}/${totalEps} 集`
                    : selected === 'bible'  ? '生成故事圣经'
                    : selected === 'bios'   ? '生成角色小传'
                    : selected === 'assets' ? '生成资产登记册'
                    : '生成集数大纲'}
                </span>
              </div>
            )}
            {saveMsg && <span style={{ fontSize: 11, color: 'rgba(80,200,100,0.85)' }}>{saveMsg}</span>}
            {error && <span style={{ fontSize: 11, color: 'rgba(239,68,68,0.92)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={error}>{error}</span>}
          </>
        )}
      />

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
                  styleConfig={styleConfig}
                  setStyleConfig={setStyleConfig}
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
            hasBios={hasBios}
            hasAssets={hasAssets}
            hasMap={hasMap}
            doneCount={doneCount}
            totalEps={totalEps}
            allDone={allDone}
            onGenerateBible={handleGenerateBible}
            onGenerateBios={handleGenerateBios}
            onGenerateAssets={handleGenerateAssets}
            onGenerateMap={handleGenerateMap}
            onStartEpisodes={handleStartEpisodes}
            onPause={handlePause}
            onResume={handleResume}
            onSwitchToCanvas={onSwitchToCanvas}
            onExtractAssets={handleExtractAssets}
            onDownloadAll={handleDownloadAll}
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
    { n: 1, label: '① 配置' },
    { n: 2, label: '② 故事圣经' },
    { n: 3, label: '③ 角色小传' },
    { n: 4, label: '④ 资产登记' },
    { n: 5, label: '⑤ 集数大纲' },
    { n: 6, label: `⑥ 逐集生成 ${doneCount}/${totalEps}` },
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
          { key: 'params'  as SelectedItem, icon: '⚙️', label: '生成配置' },
          { key: 'bible'   as SelectedItem, icon: '📖', label: '故事圣经', has: !!data.storyBible },
          { key: 'bios'    as SelectedItem, icon: '👥', label: '角色小传', has: !!data.characterBios },
          { key: 'assets'  as SelectedItem, icon: '🎨', label: '资产登记', has: !!data.assetRegistry },
          { key: 'map'     as SelectedItem, icon: '🗺', label: '集数大纲', has: data.episodeMap.length > 0 },
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
function ParamsForm({ params, setParam, styleConfig, setStyleConfig, T, theme, hasBible }: {
  params: GenerateParams
  setParam: <K extends keyof GenerateParams>(k: K, v: GenerateParams[K]) => void
  styleConfig: StyleConfig
  setStyleConfig: (c: StyleConfig) => void
  T: any; theme: string; hasBible: boolean
}) {
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 7,
    border: `1px solid ${T.border}`, background: T.inputBg,
    color: T.text, fontSize: 13, outline: 'none',
  }
  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: `1px solid ${T.border}`,
    background: active ? T.btnBg : T.nodeSubtle,
    color: active ? T.btnText : T.textSub,
    fontWeight: active ? 600 : 400,
    transition: 'all 0.15s',
  })

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 24px' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 6 }}>剧本生成配置</h2>
      <p style={{ fontSize: 13, color: T.textSub, marginBottom: 28 }}>
        填写完成后，系统将分步骤自动生成：故事圣经 → 角色小传 → 资产登记 → 集数大纲 → 逐集剧本
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

      {/* ── 视觉风格配置 ─────────────────────────────────────── */}
      <div style={{ marginTop: 24, padding: '16px 18px', background: T.nodeSubtle, border: `1px solid ${T.border}`, borderRadius: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🎨</span>
          <span>视觉风格配置</span>
          <span style={{ fontSize: 11, fontWeight: 400, color: T.textMuted }}>影响资产生图提示词</span>
        </div>

        {/* 画面类型 */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>画面类型</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {VISUAL_STYLES.map(v => (
              <button key={v} onClick={() => setStyleConfig({ ...styleConfig, visualStyle: v })}
                style={btnStyle(styleConfig.visualStyle === v)}>{v}</button>
            ))}
          </div>
        </div>

        {/* 画风 */}
        <div style={{ marginBottom: styleConfig.artStyle === '自定义' ? 10 : 0 }}>
          <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>画风</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ART_STYLES.map(a => (
              <button key={a} onClick={() => setStyleConfig({ ...styleConfig, artStyle: a })}
                style={btnStyle(styleConfig.artStyle === a)}>{a}</button>
            ))}
          </div>
        </div>

        {/* 自定义风格输入 */}
        {styleConfig.artStyle === '自定义' && (
          <div style={{ marginTop: 10 }}>
            <input
              type="text"
              value={styleConfig.customStyle}
              onChange={e => setStyleConfig({ ...styleConfig, customStyle: e.target.value })}
              placeholder="输入英文风格词，例：watercolor illustration, soft pastel tones, anime style"
              style={{ ...inputStyle, fontSize: 12 }}
            />
          </div>
        )}

        {/* 预览 */}
        <div style={{ marginTop: 10, fontSize: 11, color: T.textMuted, fontFamily: 'monospace', lineHeight: 1.5 }}>
          <span style={{ color: T.accent }}>风格标签预览：</span>{' '}
          {styleConfig.artStyle === '自定义'
            ? (styleConfig.customStyle || '请输入自定义风格词...')
            : ({
              '新海诚': 'Makoto Shinkai anime style, soft watercolor sky, natural lighting',
              '吉卜力': 'Studio Ghibli style, hand-drawn animation, warm earthy tones',
              '国风漫画': 'Chinese manhua style, ink wash aesthetics, elegant linework',
              '韩漫平涂': 'Korean webtoon style, flat color illustration, clean bold linework',
              '欧美CG': 'Western CG animation, Pixar-quality rendering, vibrant colors',
            }[styleConfig.artStyle] || '')
          }
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

// ── Markdown 内容查看器（故事圣经 / 角色小传）────────────────
function MarkdownView({ text, T, streaming, onDownload }: { text: string; T: any; streaming: boolean; onDownload?: () => void }) {
  if (!text) return (
    <div style={{ textAlign: 'center', paddingTop: 80, color: T.textMuted }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
      <div style={{ fontSize: 13 }}>内容将在生成后显示在此处</div>
    </div>
  )
  const mdComponents = {
    h1: ({ children }: any) => (
      <h1 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: '24px 0 10px', paddingBottom: 8, borderBottom: `2px solid ${T.accent}`, letterSpacing: 0.5 }}>{children}</h1>
    ),
    h2: ({ children }: any) => (
      <h2 style={{ fontSize: 15, fontWeight: 600, color: T.text, margin: '20px 0 8px', paddingBottom: 5, borderBottom: `1px solid ${T.border}` }}>{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 style={{ fontSize: 13, fontWeight: 600, color: T.accent, margin: '14px 0 5px' }}>{children}</h3>
    ),
    p: ({ children }: any) => (
      <p style={{ margin: '0 0 10px', lineHeight: 1.85, color: T.text }}>{children}</p>
    ),
    strong: ({ children }: any) => (
      <strong style={{ fontWeight: 700, color: T.text }}>{children}</strong>
    ),
    em: ({ children }: any) => (
      <em style={{ fontStyle: 'italic', color: T.textSub }}>{children}</em>
    ),
    hr: () => (
      <hr style={{ border: 'none', borderTop: `1px solid ${T.borderMid}`, margin: '18px 0' }} />
    ),
    ul: ({ children }: any) => (
      <ul style={{ paddingLeft: 20, margin: '4px 0 10px', listStyleType: 'disc' }}>{children}</ul>
    ),
    ol: ({ children }: any) => (
      <ol style={{ paddingLeft: 20, margin: '4px 0 10px' }}>{children}</ol>
    ),
    li: ({ children }: any) => (
      <li style={{ margin: '3px 0', lineHeight: 1.75, color: T.text }}>{children}</li>
    ),
    blockquote: ({ children }: any) => (
      <blockquote style={{ margin: '10px 0', paddingLeft: 14, borderLeft: `3px solid ${T.accent}`, color: T.textSub, fontStyle: 'italic' }}>{children}</blockquote>
    ),
    table: ({ children }: any) => (
      <div style={{ overflowX: 'auto', margin: '12px 0' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>{children}</table>
      </div>
    ),
    thead: ({ children }: any) => (
      <thead style={{ background: T.nodeSubtle }}>{children}</thead>
    ),
    th: ({ children }: any) => (
      <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 600, color: T.textSub, borderBottom: `1px solid ${T.borderMid}`, whiteSpace: 'nowrap' }}>{children}</th>
    ),
    td: ({ children }: any) => (
      <td style={{ padding: '5px 12px', borderBottom: `1px solid ${T.border}`, color: T.text, verticalAlign: 'top', lineHeight: 1.6 }}>{children}</td>
    ),
    code: ({ children, className }: any) => {
      const isBlock = className?.startsWith('language-')
      return isBlock
        ? <pre style={{ background: T.nodeSubtle, border: `1px solid ${T.border}`, borderRadius: 6, padding: '12px 16px', overflowX: 'auto', fontSize: 12, color: T.text, margin: '10px 0' }}><code>{children}</code></pre>
        : <code style={{ background: T.nodeSubtle, border: `1px solid ${T.border}`, borderRadius: 3, padding: '1px 5px', fontSize: 12, color: T.accent }}>{children}</code>
    },
  }
  return (
    <div style={{ fontSize: 13, lineHeight: 1.9, color: T.text, maxWidth: 760 }}>
      {!streaming && onDownload && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button onClick={onDownload} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, background: T.nodeSubtle, border: `1px solid ${T.border}`, color: T.textSub, cursor: 'pointer' }}>
            ↓ 下载
          </button>
        </div>
      )}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</ReactMarkdown>
      {streaming && <span style={{ color: T.accent }}>▌</span>}
    </div>
  )
}

// ── 角色小传卡片渲染器 ─────────────────────────────────────────
// 格式：7 行字段（姓名/年龄/对标演员/性格/背景故事/主要事件/人物关系），角色间空行分隔
const BIO_FIELDS = ['姓名', '年龄', '对标演员', '性格', '背景故事', '主要事件', '人物关系'] as const
const BIO_FIELD_ICONS: Record<string, string> = {
  姓名: '👤', 年龄: '🎂', 对标演员: '🎬', 性格: '🧠', 背景故事: '📖', 主要事件: '⚡', 人物关系: '🔗',
}

function parseBioBlock(block: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = block.split('\n')
  let currentField = ''
  let currentValue: string[] = []
  for (const line of lines) {
    const fieldMatch = line.match(/^([^\s：:]{1,6})[：:](.*)$/)
    if (fieldMatch && BIO_FIELDS.includes(fieldMatch[1] as any)) {
      if (currentField) result[currentField] = currentValue.join('\n').trim()
      currentField = fieldMatch[1]
      currentValue = [fieldMatch[2].trim()]
    } else if (currentField) {
      currentValue.push(line)
    }
  }
  if (currentField) result[currentField] = currentValue.join('\n').trim()
  return result
}

function BiosView({ text, T, streaming, onDownload }: { text: string; T: any; streaming: boolean; onDownload?: () => void }) {
  if (!text) return (
    <div style={{ textAlign: 'center', paddingTop: 80, color: T.textMuted }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>👥</div>
      <div style={{ fontSize: 13 }}>内容将在生成后显示在此处</div>
    </div>
  )

  // 按空行分割角色块
  const rawBlocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
  const parsed = rawBlocks.map(b => parseBioBlock(b))
  const hasCards = parsed.some(p => p['姓名'])

  // streaming 时如果还没解析出完整卡片，先显示纯文本
  if (streaming && !hasCards) {
    return (
      <div style={{ fontSize: 13, lineHeight: 1.85, color: T.text, whiteSpace: 'pre-wrap', maxWidth: 760 }}>
        {text}<span style={{ color: T.accent }}>▌</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 760 }}>
      {!streaming && onDownload && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button onClick={onDownload} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, background: T.nodeSubtle, border: `1px solid ${T.border}`, color: T.textSub, cursor: 'pointer' }}>
            ↓ 下载
          </button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {parsed.map((bio, i) => {
          const name = bio['姓名']
          if (!name) {
            // 非卡片块（可能是 AI 前言/后记）
            const raw = rawBlocks[i]
            return raw ? <div key={i} style={{ fontSize: 12, color: T.textSub, padding: '4px 0' }}>{raw}</div> : null
          }
          return (
            <div key={i} style={{
              border: `1px solid ${T.borderMid}`,
              borderRadius: 10,
              overflow: 'hidden',
              background: T.nodeSubtle,
            }}>
              {/* 角色头部 */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 16px',
                background: `${T.accent}18`,
                borderBottom: `1px solid ${T.borderMid}`,
              }}>
                <span style={{ fontSize: 22 }}>👤</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{name}</div>
                  <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>
                    {[bio['年龄'] && `${bio['年龄']}`, bio['对标演员'] && `对标：${bio['对标演员']}`].filter(Boolean).join('　')}
                  </div>
                </div>
              </div>
              {/* 字段列表 */}
              <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(['性格', '背景故事', '主要事件', '人物关系'] as const).map(field => {
                  if (!bio[field]) return null
                  return (
                    <div key={field}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                        <span style={{ fontSize: 11 }}>{BIO_FIELD_ICONS[field]}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: 0.5 }}>{field}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: T.text, lineHeight: 1.8, paddingLeft: 18, whiteSpace: 'pre-wrap' }}>
                        {bio[field]}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {streaming && <span style={{ color: T.accent, padding: '4px 0' }}>▌</span>}
      </div>
    </div>
  )
}

// ── 资产登记册渲染器 + 推送画布 ──────────────────────────────
interface AssetPrompt {
  label: string
  prompt: string
}

interface AssetItem {
  type: '人物' | '场景' | '道具' | string
  name: string
  fields: Record<string, string>   // 外形/描述等展示字段
  prompts: AssetPrompt[]           // 多条生图提示词
}

const ASSET_TYPE_ICON: Record<string, string> = { 人物: '👤', 场景: '🏛', 道具: '💎' }
const ASSET_TYPE_COLOR: Record<string, string> = { 人物: '#C9982A', 场景: '#2A9AC9', 道具: '#6AC92A' }

// 每类型对应的提示词标签颜色（循环用）
const PROMPT_LABEL_COLORS = ['#C9982A', '#2A9AC9', '#6AC92A', '#C92A8A', '#8A2AC9']

function parseAssets(text: string): AssetItem[] {
  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
  const items: AssetItem[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const obj: Record<string, string> = {}
    let currentKey = ''
    let currentVal: string[] = []
    for (const line of lines) {
      // Match field keys up to 12 chars (handles '提示词-三视图' etc.)
      const m = line.match(/^([^\s：:]{1,12})[：:](.*)$/)
      if (m) {
        if (currentKey) obj[currentKey] = currentVal.join('\n').trim()
        currentKey = m[1].trim()
        currentVal = [m[2].trim()]
      } else if (currentKey) {
        currentVal.push(line)
      }
    }
    if (currentKey) obj[currentKey] = currentVal.join('\n').trim()
    if (!obj['名称']) continue

    const prompts: AssetPrompt[] = []
    const fields: Record<string, string> = {}

    for (const [k, v] of Object.entries(obj)) {
      if (k === '类型' || k === '名称') continue
      if (k.startsWith('提示词-')) {
        prompts.push({ label: k.slice(4), prompt: v })  // slice '提示词-'
      } else if (k === '生图提示词') {
        // legacy single-prompt format
        prompts.push({ label: '生图', prompt: v })
      } else {
        fields[k] = v
      }
    }

    items.push({ type: obj['类型'] || '其他', name: obj['名称'], fields, prompts })
  }
  return items
}

function AssetRegistryView({ text, T, streaming, projectName, onDownload, onSwitchToCanvas }: {
  text: string; T: any; streaming: boolean; projectName: string
  onDownload?: () => void; onSwitchToCanvas?: () => void
}) {
  const [pushed, setPushed] = React.useState(false)
  const [copiedKey, setCopiedKey] = React.useState('')

  const copyPrompt = (prompt: string, key: string) => {
    navigator.clipboard.writeText(prompt).catch(() => {})
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(''), 2000)
  }

  if (!text) return (
    <div style={{ textAlign: 'center', paddingTop: 80, color: T.textMuted }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🎨</div>
      <div style={{ fontSize: 13 }}>资产将在生成后显示在此处</div>
    </div>
  )

  const assets = parseAssets(text)
  const groups: Record<string, AssetItem[]> = {}
  for (const a of assets) {
    if (!groups[a.type]) groups[a.type] = []
    groups[a.type].push(a)
  }

  // Count total prompt nodes to be pushed
  const totalPrompts = assets.reduce((acc, a) => acc + Math.max(a.prompts.length, 1), 0)

  const handlePushToCanvas = () => {
    const NODE_W = 300
    const NODE_H = 240
    const GAP_X  = 20
    const GAP_Y  = 56
    const typeOrder = ['人物', '场景', '道具']
    let globalRow = 0

    for (const type of typeOrder) {
      const list = groups[type] || []
      if (list.length === 0) continue

      list.forEach((asset, assetIdx) => {
        const icon = ASSET_TYPE_ICON[type] || ''
        const prompts = asset.prompts.length > 0 ? asset.prompts : [{ label: '生图', prompt: asset.fields['描述'] || asset.name }]
        prompts.forEach((p, pIdx) => {
          const col = assetIdx * prompts.length + pIdx
          const node = {
            id: `asset_${type}_${asset.name}_${p.label}_${Date.now()}_${col}`,
            type: 'imageGen',
            position: { x: col * (NODE_W + GAP_X), y: globalRow * (NODE_H + GAP_Y) },
            data: {
              name: `${icon} ${asset.name}・${p.label}`,
              presetPrompt: p.prompt,
            },
          }
          window.dispatchEvent(new CustomEvent('add-node-to-canvas', { detail: { node } }))
        })
      })
      globalRow++
    }
    setPushed(true)
    // 推送完成后自动跳到画布
    setTimeout(() => {
      onSwitchToCanvas?.()
    }, 800)
    setTimeout(() => setPushed(false), 3000)
  }

  // streaming 时先显示纯文本
  if (streaming && assets.length === 0) {
    return (
      <div style={{ fontSize: 13, lineHeight: 1.85, color: T.text, whiteSpace: 'pre-wrap', maxWidth: 860 }}>
        {text}<span style={{ color: T.accent }}>▌</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 860 }}>
      {/* 工具栏 */}
      {!streaming && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
          {onDownload && (
            <button onClick={onDownload} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, background: T.nodeSubtle, border: `1px solid ${T.border}`, color: T.textSub, cursor: 'pointer' }}>
              ↓ 下载
            </button>
          )}
          {assets.length > 0 && (
            <button
              onClick={handlePushToCanvas}
              style={{
                fontSize: 11, padding: '4px 14px', borderRadius: 5, cursor: 'pointer',
                background: pushed ? 'rgba(80,200,100,0.15)' : `${T.accent}22`,
                border: `1px solid ${pushed ? 'rgba(80,200,100,0.4)' : T.accent}`,
                color: pushed ? 'rgba(80,200,100,0.9)' : T.accent, fontWeight: 600,
                transition: 'all 0.3s',
              }}
            >
              {pushed ? '✓ 正在跳转到画布...' : `→ 发送 ${totalPrompts} 个节点到画布`}
            </button>
          )}
        </div>
      )}

      {/* 分组展示 */}
      {(['人物', '场景', '道具'] as const).map(type => {
        const list = groups[type]
        if (!list || list.length === 0) return null
        const color = ASSET_TYPE_COLOR[type] || T.accent
        return (
          <div key={type} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 15 }}>{ASSET_TYPE_ICON[type]}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color }}>{type}资产</span>
              <span style={{ fontSize: 11, color: T.textMuted }}>共 {list.length} 个 · {list.reduce((s, a) => s + a.prompts.length, 0)} 条提示词</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
              {list.map((asset, idx) => (
                <div key={idx} style={{
                  border: `1px solid ${T.border}`,
                  borderRadius: 10, overflow: 'hidden',
                  background: T.nodeSubtle,
                }}>
                  {/* 资产标题 */}
                  <div style={{
                    padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
                    background: `${color}14`, borderBottom: `1px solid ${T.border}`,
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{asset.name}</span>
                    {asset.fields['角色'] && <span style={{ fontSize: 11, color, background: `${color}22`, padding: '1px 6px', borderRadius: 4 }}>{asset.fields['角色']}</span>}
                    {asset.fields['环境'] && <span style={{ fontSize: 11, color, background: `${color}22`, padding: '1px 6px', borderRadius: 4 }}>{asset.fields['环境']}</span>}
                  </div>

                  <div style={{ padding: '8px 12px' }}>
                    {/* 描述字段 */}
                    {['外形', '描述'].map(f => asset.fields[f] ? (
                      <div key={f} style={{ fontSize: 12, color: T.textSub, marginBottom: 6, lineHeight: 1.6 }}>
                        <span style={{ fontWeight: 600, color: T.textSub }}>{f}：</span>{asset.fields[f]}
                      </div>
                    ) : null)}

                    {/* 多条提示词 */}
                    {asset.prompts.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {asset.prompts.map((p, pi) => {
                          const labelColor = PROMPT_LABEL_COLORS[pi % PROMPT_LABEL_COLORS.length]
                          const copyKey = `${asset.name}_${p.label}`
                          const isCopied = copiedKey === copyKey
                          return (
                            <div key={pi} style={{
                              borderRadius: 5, border: `1px solid ${T.border}`,
                              background: T.inputBg, overflow: 'hidden',
                            }}>
                              {/* 标签行 */}
                              <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '3px 8px', borderBottom: `1px solid ${T.border}`,
                                background: `${labelColor}12`,
                              }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: labelColor }}>{p.label}</span>
                                <button
                                  onClick={() => copyPrompt(p.prompt, copyKey)}
                                  style={{
                                    fontSize: 10, padding: '1px 7px', borderRadius: 3, cursor: 'pointer', border: 'none',
                                    background: isCopied ? 'rgba(80,200,100,0.2)' : `${labelColor}22`,
                                    color: isCopied ? 'rgba(80,200,100,0.9)' : labelColor,
                                    transition: 'all 0.2s',
                                  }}
                                >
                                  {isCopied ? '✓ 已复制' : '复制'}
                                </button>
                              </div>
                              {/* 提示词内容 */}
                              <div style={{
                                padding: '5px 8px',
                                fontSize: 11, color: T.textMuted, fontFamily: 'monospace',
                                lineHeight: 1.55, wordBreak: 'break-all',
                              }}>
                                {p.prompt}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      {streaming && <span style={{ color: T.accent }}>▌</span>}
    </div>
  )
}

// ── 集数大纲卡片渲染器 ─────────────────────────────────────────
function EpisodeMapView({ text, T, streaming, onDownload }: { text: string; T: any; streaming: boolean; onDownload?: () => void }) {
  if (!text) return (
    <div style={{ textAlign: 'center', paddingTop: 80, color: T.textMuted }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
      <div style={{ fontSize: 13 }}>内容将在生成后显示在此处</div>
    </div>
  )
  // 解析每行：第N集《集名》| 情节: ... | 钩子: ... | 结尾: ...
  const lines = text.split('\n').filter(l => l.trim())
  const episodes = lines.map(line => {
    const epMatch = line.match(/^第(\d+)集[《<]?([^》>|]*)[》>]?/)
    if (!epMatch) return { raw: line }
    const num = epMatch[1]
    const title = epMatch[2].trim()
    const rest = line.slice(epMatch[0].length)
    const fields: Record<string, string> = {}
    const fieldPattern = /[|｜]\s*(情节|钩子|结尾)\s*[:：]\s*([^|｜]*)/g
    let m
    while ((m = fieldPattern.exec(rest)) !== null) {
      fields[m[1]] = m[2].trim()
    }
    return { num, title, fields, raw: line }
  })

  return (
    <div style={{ maxWidth: 760 }}>
      {!streaming && onDownload && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button onClick={onDownload} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, background: T.nodeSubtle, border: `1px solid ${T.border}`, color: T.textSub, cursor: 'pointer' }}>
            ↓ 下载
          </button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {episodes.map((ep, i) => {
          if (!ep.num) {
            // 非集数行（可能是 AI 的前言）
            return ep.raw.trim() ? (
              <div key={i} style={{ fontSize: 12, color: T.textSub, padding: '4px 0' }}>{ep.raw}</div>
            ) : null
          }
          return (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '52px 1fr',
              gap: 0, borderRadius: 7,
              border: `1px solid ${T.border}`,
              overflow: 'hidden',
              background: T.nodeSubtle,
            }}>
              {/* 集号 */}
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '10px 4px', background: `${T.accent}18`,
                borderRight: `1px solid ${T.border}`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.accent }}>第</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: T.accent, lineHeight: 1 }}>{ep.num}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.accent }}>集</div>
              </div>
              {/* 内容 */}
              <div style={{ padding: '8px 12px' }}>
                {ep.title && (
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 5 }}>《{ep.title}》</div>
                )}
                {ep.fields && Object.entries(ep.fields).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 6, fontSize: 12, lineHeight: 1.6, marginTop: 2 }}>
                    <span style={{ color: T.accent, fontWeight: 600, whiteSpace: 'nowrap', minWidth: 28 }}>{k}</span>
                    <span style={{ color: T.textSub }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        {streaming && <span style={{ color: T.accent, padding: '4px 0' }}>▌</span>}
      </div>
    </div>
  )
}

// ── 剧本内容渲染器（△行 / 场景头 / 对白）────────────────────
function ScriptRenderer({ content, streaming, T }: { content: string; streaming: boolean; T: any }) {
  const lines = content.split('\n')
  const nodes: React.ReactNode[] = []

  lines.forEach((line, i) => {
    const raw = line

    // 空行
    if (!raw.trim()) {
      nodes.push(<div key={i} style={{ height: 6 }} />)
      return
    }

    // 集标题：第N集 标题（不含 |）
    if (/^第\d+集/.test(raw) && !raw.includes('|')) {
      nodes.push(
        <div key={i} style={{
          fontSize: 15, fontWeight: 800, color: T.text,
          padding: '6px 0 10px', marginTop: 8, letterSpacing: 1,
          borderBottom: `2px solid ${T.accent}`, marginBottom: 10,
        }}>{raw.trim()}</div>
      )
      return
    }

    // 场景头：N-M 场景名 内/外 日/夜
    if (/^\d+-\d+\s/.test(raw.trim())) {
      nodes.push(
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          margin: '14px 0 6px',
          padding: '5px 12px', borderRadius: 5,
          background: `${T.accent}22`,
          border: `1px solid ${T.accent}44`,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.accent, whiteSpace: 'nowrap' }}>【场景】</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{raw.trim()}</span>
        </div>
      )
      return
    }

    // 出场角色行
    if (/^出场角色[：:]/.test(raw.trim())) {
      const cast = raw.replace(/^出场角色[：:]/, '').trim()
      nodes.push(
        <div key={i} style={{ fontSize: 12, color: T.textSub, marginBottom: 6, paddingLeft: 2 }}>
          <span style={{ fontWeight: 600 }}>出场：</span>{cast}
        </div>
      )
      return
    }

    // △ 动作行
    if (/^△/.test(raw.trim())) {
      nodes.push(
        <div key={i} style={{
          fontSize: 12, color: T.textMuted, fontStyle: 'italic',
          paddingLeft: 16, margin: '2px 0', lineHeight: 1.7,
          borderLeft: `2px solid ${T.borderMid}`,
        }}>{raw.trim()}</div>
      )
      return
    }

    // 对白行：人名（情绪词）：台词 / 人名(OS)：... / 人名：...
    const dialogMatch = raw.trim().match(/^([^\s（(：:]{1,10}(?:[（(][^）)]*[）)])?)\s*[：:](.*)$/)
    if (dialogMatch) {
      const nameRaw = dialogMatch[1]
      const dialogue = dialogMatch[2].trim()
      // 解析括号情绪词 / OS / VO
      const nameClean = nameRaw.replace(/[（(][^）)]*[）)]/g, '').trim()
      const emotionMatch = nameRaw.match(/[（(]([^）)]*)[）)]/)
      const emotion = emotionMatch ? emotionMatch[1] : ''
      const isInner = emotion === 'OS' || emotion === 'VO'
      nodes.push(
        <div key={i} style={{ margin: '3px 0 3px 0', lineHeight: 1.85 }}>
          <span style={{ fontWeight: 700, color: T.text, fontSize: 13 }}>{nameClean}</span>
          {emotion && (
            <span style={{ fontSize: 11, color: isInner ? T.textMuted : T.accent, fontStyle: 'italic', marginLeft: 2 }}>（{emotion}）</span>
          )}
          <span style={{ color: T.textSub, fontSize: 11 }}>：</span>
          <span style={{ color: T.text, fontSize: 13, fontStyle: isInner ? 'italic' : 'normal' }}>{dialogue}</span>
        </div>
      )
      return
    }

    // 其他行（兜底）
    nodes.push(
      <div key={i} style={{ fontSize: 13, color: T.textSub, lineHeight: 1.75, margin: '2px 0' }}>{raw}</div>
    )
  })

  return <>{nodes}</>
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 12 }}>
        {!streaming && content && (
          <button
            onClick={() => downloadText(`第${index + 1}集.txt`, content)}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, background: T.nodeSubtle, border: `1px solid ${T.border}`, color: T.textSub, cursor: 'pointer' }}
          >
            ↓ 下载
          </button>
        )}
        {!streaming && (
          <button onClick={() => setEditing(true)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, background: T.nodeSubtle, border: `1px solid ${T.border}`, color: T.textSub, cursor: 'pointer' }}>
            ✏️ 编辑
          </button>
        )}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.9, color: T.text }}>
        <ScriptRenderer content={content} streaming={streaming} T={T} />
        {streaming && <span style={{ color: T.accent }}>▌</span>}
      </div>
    </div>
  )
}

// ── 底部操作栏 ───────────────────────────────────────────────
function ActionBar({ phase, busy, paused, hasBible, hasBios, hasAssets, hasMap, doneCount, totalEps, allDone,
  onGenerateBible, onGenerateBios, onGenerateAssets, onGenerateMap, onStartEpisodes, onPause, onResume, onSwitchToCanvas, onExtractAssets, onDownloadAll, T
}: {
  phase: number; busy: boolean; paused: boolean; hasBible: boolean; hasBios: boolean; hasAssets: boolean; hasMap: boolean
  doneCount: number; totalEps: number; allDone: boolean
  onGenerateBible: () => void; onGenerateBios: () => void; onGenerateAssets: () => void; onGenerateMap: () => void
  onStartEpisodes: () => void; onPause: () => void; onResume: () => void
  onSwitchToCanvas: () => void; onExtractAssets: () => void; onDownloadAll: () => void; T: any
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
      {/* Step 1 — 故事圣经 */}
      {btn(hasBible ? '↺ 重新生成故事圣经' : '① 生成故事圣经', onGenerateBible, !hasBible, busy)}

      {/* Step 2 — 角色小传 */}
      {hasBible && btn(hasBios ? '↺ 重新生成角色小传' : '② 生成角色小传', onGenerateBios, !hasBios, busy)}

      {/* Step 3 — 资产登记 */}
      {hasBios && btn(hasAssets ? '↺ 重新生成资产登记' : '③ 生成资产登记', onGenerateAssets, !hasAssets, busy)}

      {/* Step 4 — 集数大纲 */}
      {hasAssets && btn(hasMap ? '↺ 重新生成集数大纲' : '④ 生成集数大纲', onGenerateMap, !hasMap, busy)}

      {/* Step 5 — 逐集生成 */}
      {hasMap && !allDone && !busy && !paused && (
        btn(doneCount > 0 ? `⑤ 继续生成（${doneCount}/${totalEps}）` : '⑤ 开始逐集生成', onStartEpisodes, true, busy)
      )}
      {hasMap && busy && (
        <button onClick={onPause} style={{ padding: '9px 20px', borderRadius: 7, fontSize: 13, fontWeight: 600, border: '1px solid rgba(239,68,68,0.4)', cursor: 'pointer', background: 'rgba(239,68,68,0.08)', color: 'rgba(239,68,68,0.9)' }}>
          ⏸ 暂停
        </button>
      )}
      {paused && btn('▶ 继续生成', onResume, true)}

      <div style={{ flex: 1 }} />

      {/* 下载全集（有已完成集数时显示）*/}
      {doneCount > 0 && btn(`↓ 下载全部剧本（${doneCount}集）`, onDownloadAll)}

      {/* 完成后的选项 */}
      {allDone && btn('→ 进入生图模块', onSwitchToCanvas, true)}

      {hasBible && (
        <div style={{ fontSize: 11, color: T.textMuted }}>
          {doneCount > 0 ? `${doneCount}/${totalEps} 集` : ''}
        </div>
      )}
    </div>
  )
}
