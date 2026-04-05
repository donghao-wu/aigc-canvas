import React, { useState, useRef, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import axios from 'axios'
import { useTheme } from './ThemeContext'
import AssetPanel from './AssetPanel'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ── 类型 ─────────────────────────────────────────────────────
type Phase =
  | 'idle'
  | 'analyzing'
  | 'analyzed'      // 分析完成，等待用户选择（3个按钮）
  | 'chatting'      // AI 正在响应
  | 'chat_done'     // AI 回复完成，等待下一步（2个按钮）
  | 'outlining'
  | 'outline_ready'
  | 'generating'
  | 'done'

interface ChatMessage { role: 'user' | 'assistant'; content: string }

interface ShotItem {
  id: string
  header: string   // 镜头 01 | CU 特写 | 平视 | 静止
  details: string  // 画面：...\n叙事目的：...
  isGroup?: boolean  // 幕/场 分组标题，不可编辑
}

interface PromptCard { id: string; number: string; content: string }

const MAX_CHARS = 5000

// ── 解析多行大纲 ─────────────────────────────────────────────
// 标准景别缩写集合，用于判断第二字段是否为"地点"
const SHOT_TYPES = new Set(['LS','MS','CU','MCU','ECU','ELS','WS','MLS','VLS','BCU','XCU','EWS'])

// 从镜头行提取地点字段（第二 | 字段，非景别即地点）
function extractLocation(header: string): string {
  const parts = header.split('|')
  if (parts.length < 2) return ''
  const field = parts[1].trim()
  if (SHOT_TYPES.has(field.toUpperCase())) return ''
  return field
}

// 去掉镜头头部的地点字段，还原为标准格式：镜头 XX | 景别 | 角度 | 运动 — 叙事
function stripLocationField(header: string): string {
  const parts = header.split('|')
  if (parts.length < 2) return header
  const field = parts[1].trim()
  if (!SHOT_TYPES.has(field.toUpperCase()) && parts.length >= 3) {
    // 有地点字段，去掉它
    return parts[0].trimEnd() + ' |' + parts.slice(2).join('|')
  }
  return header
}

function parseOutline(raw: string): ShotItem[] {
  const shots: ShotItem[] = []
  let curHeader = ''
  let curDetails: string[] = []
  let counter = 0
  let lastLocation = ''
  let sceneCount = 0   // 场次计数，用于自动生成 "第N场·地点"

  const flush = () => {
    if (!curHeader) return

    // 地点变化时自动插入分组标题（第N场·地点）
    const loc = extractLocation(curHeader)
    if (loc && loc !== lastLocation) {
      sceneCount++
      shots.push({
        id: `group_${Date.now()}_${counter++}`,
        header: `第${sceneCount}场 · ${loc}`,
        details: '',
        isGroup: true,
      })
      lastLocation = loc
    }

    // 存储时去掉地点字段，保持卡片头部整洁
    shots.push({
      id: `shot_${Date.now()}_${counter++}`,
      header: stripLocationField(curHeader),
      details: curDetails.join('\n'),
    })
    curHeader = ''
    curDetails = []
  }

  for (const raw_line of raw.split('\n')) {
    const line = raw_line.trim()
    if (/^场景[：:]/.test(line)) {
      flush()
      const label = line.replace(/^场景[：:]\s*/, '')
      if (label) {
        sceneCount++
        shots.push({ id: `group_${Date.now()}_${counter++}`, header: `第${sceneCount}场 · ${label}`, details: '', isGroup: true })
        lastLocation = label
      }
    } else if (/^镜头\s*\d+\s*\|/.test(line)) {
      flush()
      curHeader = line
    } else if (curHeader && line && !/^(分镜大纲|共\s*\d+|等待|输出完整|以上是|请问|---)/.test(line)) {
      curDetails.push(line)
    }
  }
  flush()
  return shots
}

// ── 解析提示词输出 ────────────────────────────────────────────
function parsePrompts(raw: string): PromptCard[] {
  return raw
    .split(/(?=^镜头\s*\d+\s*\|)/m)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => ({
      id: `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      number: p.match(/^镜头\s*(\d+)/)?.[1] ?? '??',
      content: p,
    }))
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text) } catch {}
}

// ── Markdown 样式包装 ─────────────────────────────────────────
function MdContent({ content, color, subColor }: { content: string; color: string; subColor: string }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.85, color, fontFamily: 'inherit' }}
      className="md-content">
      <style>{`
        .md-content h1,.md-content h2,.md-content h3{font-weight:600;margin:1.2em 0 0.4em;color:${color}}
        .md-content h1{font-size:16px}.md-content h2{font-size:15px}.md-content h3{font-size:14px}
        .md-content p{margin:0.5em 0}
        .md-content ul,.md-content ol{margin:0.4em 0;padding-left:1.4em}
        .md-content li{margin:0.2em 0}
        .md-content strong{font-weight:600;color:${color}}
        .md-content em{color:${subColor}}
        .md-content code{font-size:11px;padding:1px 5px;border-radius:3px;background:rgba(128,128,128,0.12)}
        .md-content hr{border:none;border-top:1px solid rgba(128,128,128,0.2);margin:1em 0}
        .md-content blockquote{border-left:3px solid rgba(128,128,128,0.3);margin:0.5em 0;padding-left:10px;color:${subColor}}
        .md-content table{border-collapse:collapse;width:100%;margin:0.6em 0;font-size:12px}
        .md-content th,.md-content td{border:1px solid rgba(128,128,128,0.2);padding:6px 10px;text-align:left}
        .md-content th{background:rgba(128,128,128,0.08);font-weight:600;color:${color}}
        .md-content tr:nth-child(even) td{background:rgba(128,128,128,0.04)}
      `}</style>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

// ── 主组件 ───────────────────────────────────────────────────
export default function ScriptWorkbench({ projectId, projectName, onHome, onSwitchToCanvas }: { projectId: string; projectName: string; onHome: () => void; onSwitchToCanvas: () => void }) {
  const { theme, T, toggle } = useTheme()

  const [script,     setScript]     = useState('')
  const [phase,      setPhase]      = useState<Phase>('idle')
  const [streamText, setStreamText] = useState('')
  const [messages,   setMessages]   = useState<ChatMessage[]>([])
  const [chatInput,  setChatInput]  = useState('')
  const [shots,       setShots]       = useState<ShotItem[]>([])
  const [prompts,     setPrompts]     = useState<PromptCard[]>([])
  const [copiedId,      setCopiedId]      = useState<string | null>(null)
  const [history,       setHistory]       = useState<ChatMessage[]>([])
  const [showHistory,   setShowHistory]   = useState(false)
  const [showChatInput, setShowChatInput] = useState(false)
  const [analyzedScript, setAnalyzedScript] = useState('')
  const [wbSaveStatus,   setWbSaveStatus]   = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const wbSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [rightTab,      setRightTab]      = useState<'prompts' | 'assets'>('prompts')
  const [assets,        setAssets]        = useState<import('./AssetPanel').AssetItem[]>([])

  const streamRef     = useRef<string>('')
  const chatEndRef    = useRef<HTMLDivElement>(null)
  const wbInitialized = useRef(false)
  const scriptRef     = useRef(script)
  const shotsRef   = useRef(shots)
  const promptsRef = useRef(prompts)
  const assetsRef  = useRef(assets)
  useEffect(() => { scriptRef.current  = script  }, [script])
  useEffect(() => { shotsRef.current   = shots   }, [shots])
  useEffect(() => { promptsRef.current = prompts }, [prompts])
  useEffect(() => { assetsRef.current  = assets  }, [assets])

  // 卸载时立即保存（防止防抖未触发就退出）
  useEffect(() => {
    return () => {
      if (!wbInitialized.current) return
      fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify({ workbench: { script: scriptRef.current, shots: shotsRef.current, prompts: promptsRef.current, assets: assetsRef.current } }),
      }).catch(() => {})
    }
  }, [projectId])

  // 加载工作台数据
  useEffect(() => {
    wbInitialized.current = false
    fetch(`/api/projects/${projectId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      })
      .then(r => r.json())
      .then(data => {
        const wb = data.workbench
        if (wb) {
          if (wb.script)          setScript(wb.script)
          if (wb.shots?.length)   { setShots(wb.shots);   setPhase('outline_ready') }
          if (wb.prompts?.length) { setPrompts(wb.prompts); setPhase('done') }
          if (wb.assets?.length)  setAssets(wb.assets)
        }
        setTimeout(() => { wbInitialized.current = true; setWbSaveStatus('saved') }, 300)
      })
      .catch(() => { wbInitialized.current = true })
  }, [projectId])

  // 自动保存工作台（2 秒防抖）
  useEffect(() => {
    if (!wbInitialized.current) return
    setWbSaveStatus('unsaved')
    if (wbSaveTimer.current) clearTimeout(wbSaveTimer.current)
    wbSaveTimer.current = setTimeout(async () => {
      setWbSaveStatus('saving')
      try {
        await fetch(`/api/projects/${projectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
          body: JSON.stringify({ workbench: { script, shots, prompts, assets } }),
        })
        setWbSaveStatus('saved')
      } catch { setWbSaveStatus('unsaved') }
    }, 2000)
  }, [script, shots, prompts, assets, projectId])

  // 自动滚到底部
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamText])

  // ── 流式请求核心 ─────────────────────────────────────────
  const streamRequest = useCallback(async (
    payload: Record<string, unknown>,
    onDone: (full: string) => void,
  ) => {
    streamRef.current = ''
    setStreamText('')

    try {
      const res = await fetch('/api/script-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify(payload),
      })
      if (!res.body) throw new Error('No response body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data.trim() === '[DONE]') { onDone(streamRef.current); return }
          try {
            const p = JSON.parse(data)
            if (p.error) { setStreamText(prev => prev + `\n\n**错误：** ${p.error}`); onDone(streamRef.current); return }
            if (p.text) { streamRef.current += p.text; setStreamText(streamRef.current) }
          } catch {}
        }
      }
      onDone(streamRef.current)
    } catch (err) {
      setStreamText(prev => prev + `\n\n**网络错误：** ${String(err)}`)
      setPhase('analyzed')
    }
  }, [])

  // ── Mode A：分析剧本 ──────────────────────────────────────
  const handleAnalyze = useCallback(() => {
    if (!script.trim() || phase === 'analyzing') return
    setPhase('analyzing')
    setMessages([])
    setShots([])
    setPrompts([])
    setHistory([])
    setShowChatInput(false)
    streamRequest({ mode: 'analyze', script }, full => {
      const newHistory: ChatMessage[] = [
        { role: 'user', content: `【模式A · 剧本分析】\n\n${script}` },
        { role: 'assistant', content: full },
      ]
      setHistory(newHistory)
      setMessages([{ role: 'assistant', content: full }])
      setStreamText('')
      setAnalyzedScript(script)
      setPhase('analyzed')
    })
  }, [script, phase, streamRequest])

  // ── 一键同意修改（预设消息）────────────────────────────
  const handleAutoModify = useCallback(() => {
    const presetMsg = '请根据以上节奏分析，直接对剧本进行修改，输出完整的修改版本剧本，不要询问是否继续。'
    const userMsg: ChatMessage = { role: 'user', content: '同意修改，请直接输出修改后的完整剧本' }
    setMessages(prev => [...prev, userMsg])
    setShowChatInput(false)
    setPhase('chatting')
    const newHistory: ChatMessage[] = [...history, { role: 'user', content: presetMsg }]
    streamRequest({ mode: 'chat', message: presetMsg, script, history: newHistory }, full => {
      const aiMsg: ChatMessage = { role: 'assistant', content: full }
      setMessages(prev => [...prev, aiMsg])
      setHistory(prev => [...prev, userMsg, aiMsg])
      setStreamText('')
      setPhase('chat_done')
    })
  }, [history, script, streamRequest])

  // ── 自定义聊天 ────────────────────────────────────────────
  const handleChat = useCallback(() => {
    const msg = chatInput.trim()
    if (!msg || phase === 'chatting') return
    const userMsg: ChatMessage = { role: 'user', content: msg }
    setMessages(prev => [...prev, userMsg])
    setChatInput('')
    setShowChatInput(false)
    setPhase('chatting')
    const newHistory: ChatMessage[] = [...history, userMsg]
    streamRequest({ mode: 'chat', message: msg, script, history: newHistory }, full => {
      const aiMsg: ChatMessage = { role: 'assistant', content: full }
      setMessages(prev => [...prev, aiMsg])
      setHistory(prev => [...prev, userMsg, aiMsg])
      setStreamText('')
      setPhase('chat_done')
    })
  }, [chatInput, history, phase, script, streamRequest])

  // ── Mode B Step1：生成大纲 ────────────────────────────────
  const handleOutline = useCallback(() => {
    if (!script.trim() || phase === 'outlining') return
    setPhase('outlining')
    setMessages([])
    setShots([])
    setPrompts([])
    // 保留已有对话历史，让 AI 知道剧本修改上下文
    // Only pass history if script hasn't changed since last analysis
    const outlineHistory = script === analyzedScript ? history : []
    streamRequest({ mode: 'outline', script, history: outlineHistory }, full => {
      setShots(parseOutline(full))
      setHistory(prev => [
        ...prev,
        { role: 'user', content: `【模式B · 分镜大纲】\n\n${script}` },
        { role: 'assistant', content: full },
      ])
      setStreamText('')
      setPhase('outline_ready')
    })
  }, [script, phase, history, analyzedScript, streamRequest])

  // ── Mode B Step2：生成完整提示词 ──────────────────────────
  const handleGeneratePrompts = useCallback(() => {
    if (shots.length === 0 || phase === 'generating') return
    setPhase('generating')
    setPrompts([])
    const shotTexts = shots.map(s => `${s.header}\n${s.details}`)
    streamRequest({ mode: 'prompts', script, shots: shotTexts.map(t => ({ text: t })), history }, full => {
      setPrompts(parsePrompts(full))
      setStreamText('')
      setPhase('done')
    })
  }, [shots, phase, script, history, streamRequest])

  // ── 大纲编辑 ─────────────────────────────────────────────
  const updateShotHeader  = (id: string, v: string) => setShots(p => p.map(s => s.id === id ? { ...s, header: v } : s))
  const updateShotDetails = (id: string, v: string) => setShots(p => p.map(s => s.id === id ? { ...s, details: v } : s))
  const deleteShot        = (id: string) => setShots(p => p.filter(s => s.id !== id))
  const insertGroupHeader = (beforeId: string, type: '幕' | '场') => setShots(p => {
    const idx = p.findIndex(s => s.id === beforeId)
    if (idx === -1) return p
    // 自动计算编号
    const existingGroups = p.slice(0, idx).filter(s => s.isGroup && s.header.startsWith(type === '幕' ? '第' : '第') && s.header.includes(type))
    const num = existingGroups.length + 1
    const label = type === '幕' ? `第${num}幕 · 幕名` : `第${num}场 · 场景名`
    const g: ShotItem = { id: `group_${Date.now()}`, header: label, details: '', isGroup: true }
    return [...p.slice(0, idx), g, ...p.slice(idx)]
  })
  const addShot = () => setShots(p => [...p, {
    id: `shot_${Date.now()}`,
    header: `镜头 ${String(p.length + 1).padStart(2, '0')} | CU 特写 | 平视 | 静止`,
    details: '画面：\n叙事目的：',
  }])

  // ── 复制 ─────────────────────────────────────────────────
  const handleCopy = async (id: string, text: string) => {
    await copyText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 1500)
  }
  const handleCopyAll = async () => {
    await copyText(prompts.map(p => p.content).join('\n\n---\n\n'))
    setCopiedId('all'); setTimeout(() => setCopiedId(null), 1500)
  }

  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const handleSendPromptToCanvas = async (p: PromptCard, index: number) => {
    try {
      const { data: proj } = await axios.get(`/api/projects/${projectId}`, { headers: authHeaders() })
      const existingNodes: unknown[] = proj.nodes || []
      const newNode = {
        id: `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'textNode',
        position: { x: 4200, y: 2000 + index * 320 },
        data: { name: `镜头 ${p.number}`, content: p.content },
      }
      await axios.put(`/api/projects/${projectId}`, { nodes: [...existingNodes, newNode], edges: proj.edges || [] }, { headers: authHeaders() })
      window.dispatchEvent(new CustomEvent('canvas-refresh'))
      setSentIds(prev => new Set(prev).add(p.id))
      setTimeout(() => setSentIds(prev => { const s = new Set(prev); s.delete(p.id); return s }), 2000)
    } catch { /* ignore */ }
  }

  const isStreaming = ['analyzing', 'chatting', 'outlining', 'generating'].includes(phase)
  const overLimit = script.length > MAX_CHARS

  const realShotCount = shots.filter(s => !s.isGroup).length

  const centerTitle =
    phase === 'analyzing'    ? '分析中...' :
    phase === 'analyzed'     ? '分析报告' :
    phase === 'chatting'     ? '思考中...' :
    phase === 'chat_done'    ? '修改记录' :
    phase === 'outlining'    ? '大纲生成中...' :
    (phase === 'outline_ready' || phase === 'done') ? `分镜大纲 · ${realShotCount} 个镜头` : ''

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.canvasBg, color: T.text, overflow: 'hidden' }}>

      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', height: 50, flexShrink: 0, borderBottom: `1px solid ${T.border}`, background: T.headerBg, backdropFilter: 'blur(24px)' }}>
        {/* 返回按钮 */}
        <button
          onClick={onHome}
          className="btn-pill"
          style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600,
            color: T.text,
            background: 'rgba(201,152,42,0.1)',
            border: `1px solid rgba(201,152,42,0.2)`,
            borderRadius: 999, cursor: 'pointer', padding: '5px 12px 5px 8px',
          }}
        >
          <div style={{ width: 20, height: 20, borderRadius: 5, background: 'rgba(201,152,42,0.15)', border: '1px solid rgba(201,152,42,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/logo.svg" style={{ width: 12, height: 12 }} />
          </div>
          壹镜
        </button>

        <div style={{ width: 1, height: 14, background: T.border }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: T.textSub, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projectName}</span>
        <div style={{ width: 1, height: 14, background: T.border }} />

        {/* 分段控件 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: T.nodeSubtle, border: `1px solid ${T.border}`, borderRadius: 8, padding: 3 }}>
          <button
            onClick={onSwitchToCanvas}
            style={{ fontSize: 12, padding: '4px 11px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'transparent', color: T.textSub, transition: 'color 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.color = T.text)}
            onMouseLeave={e => (e.currentTarget.style.color = T.textSub)}
          >画布</button>
          <button style={{
            fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 6, border: 'none', cursor: 'default',
            background: theme === 'dark' ? 'rgba(201,152,42,0.15)' : 'rgba(184,135,14,0.12)',
            color: T.accent,
            boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
          }}>剧本工作台</button>
        </div>

        <div style={{ width: 1, height: 14, background: T.border }} />

        {/* 保存状态 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: wbSaveStatus === 'saved' ? 'rgba(80,200,100,0.7)' : wbSaveStatus === 'saving' ? 'rgba(201,152,42,0.9)' : 'rgba(255,120,100,0.7)',
            transition: 'background 0.3s',
          }} />
          <span style={{ fontSize: 11, color: wbSaveStatus === 'saving' ? 'rgba(201,152,42,0.8)' : T.textMuted }}>
            {wbSaveStatus === 'saved' ? '已保存' : wbSaveStatus === 'saving' ? '保存中' : '未保存'}
          </span>
        </div>

        <div style={{ flex: 1 }} />
        <button
          onClick={toggle}
          style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6, color: T.textSub, transition: 'color 0.15s, background 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.background = T.nodeSubtle }}
          onMouseLeave={e => { e.currentTarget.style.color = T.textSub; e.currentTarget.style.background = 'none' }}
        >
          {theme === 'dark' ? '◑ 浅色' : '◑ 深色'}
        </button>
      </div>

      {/* 主体三栏 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', gap: 10, padding: 10 }}>

        {/* ── 左栏：剧本输入 ── */}
        <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRadius: 12, background: T.nodeBg, border: `1px solid ${T.border}`, boxShadow: theme === 'dark' ? '0 2px 12px rgba(0,0,0,0.4)' : '0 2px 12px rgba(0,0,0,0.06)', padding: 16, gap: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>剧本</span>
            <span style={{ fontSize: 11, color: overLimit ? 'rgba(255,59,48,0.8)' : T.textMuted }}>{script.length} / {MAX_CHARS}</span>
          </div>

          <textarea
            value={script}
            onChange={e => setScript(e.target.value)}
            placeholder={'粘贴或输入剧本内容...\n\n建议单集或单场景，5000 字以内。'}
            style={{ flex: 1, resize: 'none', padding: 12, borderRadius: 8, fontSize: 12, lineHeight: 1.75, background: T.inputBg, border: `1px solid ${T.border}`, color: T.text, outline: 'none', fontFamily: 'inherit' }}
            onFocus={e => (e.target.style.borderColor = T.borderMid)}
            onBlur={e  => (e.target.style.borderColor = T.border)}
          />

          {overLimit && (
            <div style={{ fontSize: 11, color: 'rgba(255,59,48,0.8)', padding: '6px 10px', borderRadius: 6, background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)' }}>超出字数限制</div>
          )}
          {analyzedScript && script !== analyzedScript && !overLimit && (
            <div style={{ fontSize: 11, color: 'rgba(200,150,50,0.9)', padding: '6px 10px', borderRadius: 6, background: 'rgba(200,150,50,0.08)', border: '1px solid rgba(200,150,50,0.2)' }}>
              剧本已修改，建议重新分析后再生成分镜
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={handleAnalyze}
              disabled={!script.trim() || overLimit || isStreaming}
              style={{ padding: '9px 0', borderRadius: 7, fontSize: 12, fontWeight: 500, background: T.inputBg, border: `1px solid ${T.border}`, color: (!script.trim() || overLimit || isStreaming) ? T.textMuted : T.text, cursor: (!script.trim() || overLimit || isStreaming) ? 'not-allowed' : 'pointer' }}
            >{phase === 'analyzing' ? '分析中...' : '分析剧本节奏'}</button>

            <button
              onClick={handleOutline}
              disabled={!script.trim() || overLimit || isStreaming}
              style={{ padding: '9px 0', borderRadius: 7, fontSize: 12, fontWeight: 600, background: (!script.trim() || overLimit || isStreaming) ? T.nodeSubtle : T.btnBg, border: 'none', color: (!script.trim() || overLimit || isStreaming) ? T.textMuted : T.btnText, cursor: (!script.trim() || overLimit || isStreaming) ? 'not-allowed' : 'pointer' }}
            >{phase === 'outlining' ? '生成中...' : '生成分镜大纲'}</button>
          </div>

          <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.7, padding: '10px 12px', borderRadius: 7, background: T.nodeSubtle, border: `1px solid ${T.border}` }}>
            <div style={{ fontWeight: 500, marginBottom: 4, color: T.textSub }}>工作流</div>
            <div>1. 输入剧本</div>
            <div>2. 可选：分析节奏并与 AI 讨论</div>
            <div>3. 生成分镜大纲，审核编辑</div>
            <div>4. 确认后生成 Seedance 提示词</div>
          </div>
        </div>

        {/* ── 中栏：分析/聊天/大纲 ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 12, background: T.nodeBg, border: `1px solid ${T.border}`, boxShadow: theme === 'dark' ? '0 2px 12px rgba(0,0,0,0.4)' : '0 2px 12px rgba(0,0,0,0.06)', minWidth: 0, overflow: 'hidden' }}>
          {/* 中栏标题 */}
          {phase !== 'idle' && (
            <div style={{ padding: '12px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: T.text }}>{centerTitle}</span>
              {(phase === 'outline_ready' || phase === 'done') && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {messages.length > 0 && (
                    <button
                      onClick={() => setShowHistory(v => !v)}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, background: showHistory ? T.borderMid : T.nodeSubtle, border: `1px solid ${T.border}`, color: T.textSub, cursor: 'pointer' }}
                    >{showHistory ? '隐藏对话' : '对话记录'}</button>
                  )}
                  <button onClick={addShot} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, background: T.nodeSubtle, border: `1px solid ${T.border}`, color: T.textSub, cursor: 'pointer' }}>+ 添加镜头</button>
                  {phase === 'outline_ready' && realShotCount > 0 && (
                    <button onClick={handleGeneratePrompts} style={{ fontSize: 11, padding: '4px 12px', borderRadius: 5, background: T.btnBg, border: 'none', color: T.btnText, cursor: 'pointer', fontWeight: 500 }}>确认，生成提示词</button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 中栏内容 */}
          <div style={{ flex: 1, overflow: 'auto', padding: phase === 'analyzed' || phase === 'chatting' ? '0' : '20px' }}>

            {/* 空状态 */}
            {phase === 'idle' && (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center', color: T.textMuted }}>
                  <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>✦</div>
                  <div style={{ fontSize: 13 }}>输入剧本，点击左侧按钮开始</div>
                </div>
              </div>
            )}

            {/* 分析中：流式 Markdown */}
            {phase === 'analyzing' && (
              <div style={{ padding: 20 }}>
                <MdContent content={streamText + (isStreaming ? ' ▌' : '')} color={T.text} subColor={T.textSub} />
              </div>
            )}

            {/* 分析完成 / 修改中 / 修改完成 */}
            {(phase === 'analyzed' || phase === 'chatting' || phase === 'chat_done') && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {/* 消息列表 */}
                <div style={{ flex: 1, overflow: 'auto', padding: '20px 20px 0' }}>
                  {messages.map((msg, i) => (
                    <div key={i} style={{ marginBottom: 20 }}>
                      {msg.role === 'user' ? (
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <div style={{ maxWidth: '80%', padding: '8px 14px', borderRadius: 10, background: T.btnBg, color: T.btnText, fontSize: 13, lineHeight: 1.6 }}>
                            {msg.content}
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: '0 4px' }}>
                          <MdContent content={msg.content} color={T.text} subColor={T.textSub} />
                        </div>
                      )}
                    </div>
                  ))}
                  {/* 流式输出中 */}
                  {phase === 'chatting' && streamText && (
                    <div style={{ padding: '0 4px', marginBottom: 20 }}>
                      <MdContent content={streamText + ' ▌'} color={T.text} subColor={T.textSub} />
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* 底部操作区 */}
                <div style={{ padding: '12px 20px 16px', borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>

                  {/* 分析完成后：3 个选择按钮 */}
                  {phase === 'analyzed' && !showChatInput && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>选择下一步</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={handleAutoModify} style={{ flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 12, fontWeight: 600, background: T.btnBg, border: 'none', color: T.btnText, cursor: 'pointer' }}>
                          同意修改
                        </button>
                        <button onClick={handleOutline} style={{ flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 12, background: T.nodeSubtle, border: `1px solid ${T.border}`, color: T.text, cursor: 'pointer' }}>
                          直接输出分镜
                        </button>
                        <button onClick={() => { setShowChatInput(true); setTimeout(() => document.getElementById('chat-input')?.focus(), 50) }} style={{ flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 12, background: T.nodeSubtle, border: `1px solid ${T.border}`, color: T.textSub, cursor: 'pointer' }}>
                          自定义修改
                        </button>
                      </div>
                    </div>
                  )}

                  {/* AI 回复后：2 个选择按钮 */}
                  {phase === 'chat_done' && !showChatInput && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>选择下一步</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => { setShowChatInput(true); setTimeout(() => document.getElementById('chat-input')?.focus(), 50) }} style={{ flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 12, background: T.nodeSubtle, border: `1px solid ${T.border}`, color: T.textSub, cursor: 'pointer' }}>
                          继续修改
                        </button>
                        <button onClick={handleOutline} style={{ flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 12, fontWeight: 600, background: T.btnBg, border: 'none', color: T.btnText, cursor: 'pointer' }}>
                          输出分镜大纲
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 自定义输入框（仅在需要时出现）*/}
                  {showChatInput && phase !== 'chatting' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat() } }}
                        id="chat-input"
                        placeholder="输入修改意见，按 Enter 发送..."
                        style={{ flex: 1, padding: '8px 12px', borderRadius: 7, fontSize: 13, background: T.inputBg, border: `1px solid ${T.border}`, color: T.text, outline: 'none', fontFamily: 'inherit' }}
                        onFocus={e => (e.target.style.borderColor = T.borderMid)}
                        onBlur={e  => (e.target.style.borderColor = T.border)}
                      />
                      <button
                        onClick={handleChat}
                        disabled={!chatInput.trim()}
                        style={{ padding: '8px 16px', borderRadius: 7, fontSize: 12, fontWeight: 500, background: chatInput.trim() ? T.btnBg : T.nodeSubtle, border: 'none', color: chatInput.trim() ? T.btnText : T.textMuted, cursor: chatInput.trim() ? 'pointer' : 'not-allowed' }}
                      >发送</button>
                    </div>
                  )}

                  {/* 正在思考中提示 */}
                  {phase === 'chatting' && (
                    <div style={{ fontSize: 11, color: T.textMuted }}>AI 思考中...</div>
                  )}
                </div>
              </div>
            )}

            {/* 大纲生成中：流式 Markdown */}
            {phase === 'outlining' && (
              <MdContent content={streamText + ' ▌'} color={T.text} subColor={T.textSub} />
            )}

            {/* 大纲卡片（可编辑） */}
            {(phase === 'outline_ready' || phase === 'done') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                {/* 折叠的对话历史 */}
                {showHistory && messages.length > 0 && (
                  <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.border}`, marginBottom: 4 }}>
                    <div style={{ padding: '8px 12px', background: T.nodeSubtle, borderBottom: `1px solid ${T.border}`, fontSize: 11, color: T.textMuted }}>对话记录</div>
                    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 280, overflow: 'auto' }}>
                      {messages.map((msg, i) => (
                        <div key={i}>
                          {msg.role === 'user' ? (
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <div style={{ maxWidth: '80%', padding: '6px 12px', borderRadius: 8, background: T.btnBg, color: T.btnText, fontSize: 12, lineHeight: 1.6 }}>{msg.content}</div>
                            </div>
                          ) : (
                            <MdContent content={msg.content} color={T.text} subColor={T.textSub} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {realShotCount === 0 && shots.length === 0 && (
                  <div style={{ textAlign: 'center', color: T.textMuted, fontSize: 13, padding: '40px 0' }}>
                    未能解析出大纲，请点击「+ 添加镜头」手动添加
                  </div>
                )}
                {(() => {
                  let shotNum = 0

                  // 插入幕/场行 — 默认不可见，悬浮显示后不消失直到鼠标离开
                  const InsertRow = ({ beforeId }: { beforeId: string }) => (
                    <div style={{ display: 'flex', alignItems: 'center', height: 20, opacity: 0, transition: 'opacity 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                    >
                      <div style={{ flex: 1, borderTop: `1px dashed ${T.borderMid}` }} />
                      <button onClick={() => insertGroupHeader(beforeId, '幕')} style={{ fontSize: 10, padding: '1px 8px', margin: '0 3px', borderRadius: 3, background: 'transparent', border: `1px dashed ${T.borderMid}`, color: T.textSub, cursor: 'pointer' }}>+ 幕</button>
                      <button onClick={() => insertGroupHeader(beforeId, '场')} style={{ fontSize: 10, padding: '1px 8px', margin: '0 3px', borderRadius: 3, background: 'transparent', border: `1px dashed ${T.borderMid}`, color: T.textSub, cursor: 'pointer' }}>+ 场</button>
                      <div style={{ flex: 1, borderTop: `1px dashed ${T.borderMid}` }} />
                    </div>
                  )

                  return shots.map((shot, idx) => {
                    if (shot.isGroup) {
                      const isAct = /幕/.test(shot.header)
                      return (
                        <React.Fragment key={shot.id}>
                          <InsertRow beforeId={shot.id} />
                          {/* 幕/场 分割线 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: isAct ? '16px 0 8px' : '10px 0 4px' }}>
                            <div style={{ flex: 1, height: isAct ? 1 : 1, background: T.borderMid }} />
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <input
                                value={shot.header}
                                onChange={e => updateShotHeader(shot.id, e.target.value)}
                                style={{
                                  fontSize: isAct ? 12 : 11,
                                  fontWeight: isAct ? 700 : 500,
                                  color: isAct ? T.text : T.textSub,
                                  background: 'transparent', border: 'none', outline: 'none',
                                  textAlign: 'center', letterSpacing: '0.05em',
                                  minWidth: 60,
                                }}
                              />
                              <button onClick={() => deleteShot(shot.id)}
                                style={{ fontSize: 10, background: 'none', border: 'none', color: 'rgba(255,59,48,0.55)', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,59,48,0.8)')}
                                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,59,48,0.55)')}
                              >✕</button>
                            </div>
                            <div style={{ flex: 1, height: 1, background: T.borderMid }} />
                          </div>
                        </React.Fragment>
                      )
                    }

                    shotNum++
                    const num = shotNum
                    // 解析镜头头部为结构化部分
                    const parts = shot.header.split('|').map(s => s.trim())
                    const shotCode = parts[0] ?? ''   // 镜头 01
                    const shotType = parts[1] ?? ''   // ELS
                    const motionRaw = parts.slice(2).join('|')  // 仰视·固定 — 叙事
                    const dashIdx = motionRaw.indexOf('—')
                    const motion = dashIdx >= 0 ? motionRaw.slice(0, dashIdx).trim() : motionRaw.trim()
                    const desc   = dashIdx >= 0 ? motionRaw.slice(dashIdx + 1).trim() : ''
                    const isParsed = parts.length >= 3

                    return (
                      <React.Fragment key={shot.id}>
                        <InsertRow beforeId={shot.id} />
                        <div
                          style={{ borderRadius: 7, background: T.nodeBg, border: `1px solid ${T.border}`, overflow: 'hidden' }}
                          onMouseEnter={e => { const btn = e.currentTarget.querySelector<HTMLElement>('.del-btn'); if (btn) btn.style.opacity = '1' }}
                          onMouseLeave={e => { const btn = e.currentTarget.querySelector<HTMLElement>('.del-btn'); if (btn) btn.style.opacity = '0' }}
                        >
                          {isParsed ? (
                            // 结构化显示
                            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                              {/* 序号 */}
                              <span style={{ fontSize: 10, color: T.textSub, width: 30, textAlign: 'center', flexShrink: 0, fontVariantNumeric: 'tabular-nums', borderRight: `1px solid ${T.border}`, padding: '10px 0' }}>{num}</span>
                              {/* 景别 badge */}
                              <span style={{ fontSize: 10, fontWeight: 600, color: T.text, background: T.nodeSubtle, padding: '10px 8px', borderRight: `1px solid ${T.border}`, flexShrink: 0, letterSpacing: '0.04em', fontFamily: 'monospace' }}>{shotType}</span>
                              {/* 角度/运动 */}
                              <span style={{ fontSize: 11, color: T.textSub, padding: '10px 8px', borderRight: `1px solid ${T.border}`, flexShrink: 0, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{motion}</span>
                              {/* 描述 */}
                              <span style={{ flex: 1, fontSize: 12, color: T.text, padding: '10px 10px', lineHeight: 1.4 }}>{desc || motionRaw}</span>
                              <button className="del-btn" onClick={() => deleteShot(shot.id)}
                                style={{ opacity: 0, transition: 'opacity 0.15s', fontSize: 11, padding: '10px 10px', background: 'none', border: 'none', color: 'rgba(255,59,48,0.7)', cursor: 'pointer', flexShrink: 0 }}
                              >✕</button>
                            </div>
                          ) : (
                            // 降级：直接编辑
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
                              <span style={{ fontSize: 10, color: T.textMuted, width: 20, textAlign: 'right', flexShrink: 0 }}>{num}</span>
                              <input value={shot.header} onChange={e => updateShotHeader(shot.id, e.target.value)}
                                style={{ flex: 1, fontSize: 12, background: 'transparent', border: 'none', outline: 'none', color: T.text, fontFamily: 'monospace' }} />
                              <button className="del-btn" onClick={() => deleteShot(shot.id)}
                                style={{ opacity: 0, transition: 'opacity 0.15s', fontSize: 11, padding: '2px 4px', background: 'none', border: 'none', color: 'rgba(255,59,48,0.7)', cursor: 'pointer' }}
                              >✕</button>
                            </div>
                          )}
                        </div>
                        {shot.details.trim() && (
                          <textarea value={shot.details} onChange={e => updateShotDetails(shot.id, e.target.value)}
                            rows={2} style={{ width: '100%', padding: '6px 10px 6px 38px', resize: 'none', background: T.nodeSubtle, border: `1px solid ${T.border}`, borderTop: 'none', borderRadius: '0 0 7px 7px', outline: 'none', fontSize: 11, lineHeight: 1.6, color: T.textSub, fontFamily: 'inherit', boxSizing: 'border-box' }}
                          />
                        )}
                      </React.Fragment>
                    )
                  })
                })()}

                {phase === 'outline_ready' && realShotCount > 0 && (
                  <button
                    onClick={handleGeneratePrompts}
                    style={{ marginTop: 4, padding: '10px 0', borderRadius: 7, fontSize: 12, fontWeight: 600, background: T.btnBg, border: 'none', color: T.btnText, cursor: 'pointer' }}
                  >确认大纲，生成 Seedance 提示词</button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── 右栏：提示词 / 资产 ── */}
        <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRadius: 12, background: T.nodeBg, border: `1px solid ${T.border}`, boxShadow: theme === 'dark' ? '0 2px 12px rgba(0,0,0,0.4)' : '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>

          {/* Tab 标题栏 */}
          <div style={{ padding: '0 16px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0, height: 44 }}>
            {(['prompts', 'assets'] as const).map(tab => (
              <button key={tab} onClick={() => setRightTab(tab)} style={{
                padding: '0 14px', height: '100%', fontSize: 12, fontWeight: rightTab === tab ? 600 : 400,
                background: 'none', border: 'none', cursor: 'pointer',
                color: rightTab === tab ? T.text : T.textMuted,
                borderBottom: rightTab === tab ? `2px solid ${T.text}` : '2px solid transparent',
                transition: 'color 0.15s',
              }}>
                {tab === 'prompts'
                  ? (phase === 'done' ? `提示词 · ${prompts.length} 镜头` : '提示词')
                  : '资产'}
              </button>
            ))}
            {/* 提示词 tab 的复制全部按钮 */}
            {rightTab === 'prompts' && phase === 'done' && prompts.length > 0 && (
              <>
                <div style={{ flex: 1 }} />
                <button onClick={handleCopyAll} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, background: copiedId === 'all' ? T.btnBg : T.nodeSubtle, border: `1px solid ${T.border}`, color: copiedId === 'all' ? T.btnText : T.textSub, cursor: 'pointer' }}>
                  {copiedId === 'all' ? '已复制' : '复制全部'}
                </button>
              </>
            )}
          </div>

          {/* 提示词 Tab 内容 */}
          {rightTab === 'prompts' && (
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {!['generating', 'done'].includes(phase) && (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ textAlign: 'center', color: T.textMuted, fontSize: 12 }}>确认大纲后，提示词将显示在这里</div>
                </div>
              )}
              {phase === 'generating' && (
                <pre style={{ fontSize: 11, lineHeight: 1.8, color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', margin: 0 }}>
                  {streamText}<span style={{ opacity: 0.5 }}>▌</span>
                </pre>
              )}
              {phase === 'done' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {prompts.map((p, idx) => (
                    <div key={p.id} style={{ borderRadius: 8, overflow: 'hidden', background: T.nodeBg, border: `1px solid ${T.border}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 12px', borderBottom: `1px solid ${T.border}`, background: T.nodeSubtle }}>
                        <span style={{ fontSize: 11, fontWeight: 500, color: T.textSub }}>镜头 {p.number}</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => handleSendPromptToCanvas(p, idx)} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: sentIds.has(p.id) ? T.btnBg : T.inputBg, border: `1px solid ${T.border}`, color: sentIds.has(p.id) ? T.btnText : T.textSub, cursor: 'pointer', transition: 'all 0.15s' }}>
                            {sentIds.has(p.id) ? '已发送' : '发送到画布'}
                          </button>
                          <button onClick={() => handleCopy(p.id, p.content)} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: copiedId === p.id ? T.btnBg : T.inputBg, border: `1px solid ${T.border}`, color: copiedId === p.id ? T.btnText : T.textSub, cursor: 'pointer', transition: 'all 0.15s' }}>
                            {copiedId === p.id ? '已复制' : '复制'}
                          </button>
                        </div>
                      </div>
                      <pre style={{ margin: 0, padding: '10px 12px', fontSize: 11, lineHeight: 1.75, color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' }}>
                        {p.content}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 资产 Tab 内容 */}
          {rightTab === 'assets' && (
            <AssetPanel promptTexts={prompts.map(p => p.content)} script={script} projectId={projectId} assets={assets} onAssetsChange={setAssets} />
          )}
        </div>

      </div>
    </div>
  )
}
