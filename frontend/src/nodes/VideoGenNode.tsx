import { useState, useCallback, useEffect, useRef } from 'react'
import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react'
import EditableTitle from './EditableTitle'
import { useTheme } from '../ThemeContext'
import axios from 'axios'

// ── 模型配置 ─────────────────────────────────────────────────
const SORA_MODELS = [
  { id: 'sora_video2',               label: 'Sora 2 竖屏',    desc: '704×1280 · 10s' },
  { id: 'sora_video2-landscape',     label: 'Sora 2 横屏',    desc: '1280×704 · 10s' },
  { id: 'sora_video2-15s',           label: 'Sora 2 竖屏 长', desc: '704×1280 · 15s' },
  { id: 'sora_video2-landscape-15s', label: 'Sora 2 横屏 长', desc: '1280×704 · 15s' },
]

// 主题色（蓝紫）
const C = 'rgba(124,58,237,'

type VideoStatus = 'idle' | 'submitting' | 'processing' | 'completed' | 'failed'

// ── 进度条 ───────────────────────────────────────────────────
function ProgressBar({ progress }: { progress: number | null }) {
  const { T } = useTheme()
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height: 4, background: T.nodeSubtle }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: progress != null ? `${progress}%` : '100%',
          background: progress != null
            ? `linear-gradient(90deg, #7c3aed, #a78bfa)`
            : 'rgba(124,58,237,0.4)',
          animation: progress == null ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }}
      />
    </div>
  )
}

// ── 主组件 ───────────────────────────────────────────────────
export default function VideoGenNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow()
  const { T } = useTheme()
  const nodeName = (data as Record<string, unknown>)?.name as string || '生视频'
  const handleRename = (v: string) =>
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, name: v } } : n))
  const [model,     setModel]     = useState('sora_video2')
  const [prompt,    setPrompt]    = useState('')
  const [status,    setStatus]    = useState<VideoStatus>('idle')
  const [progress,  setProgress]  = useState<number | null>(null)
  const [videoUrl,  setVideoUrl]  = useState<string | null>(null)
  const [taskId,    setTaskId]    = useState<string | null>(null)
  const [taskType,  setTaskType]  = useState<'sora' | 'veo'>('sora')
  const [error,     setError]     = useState<string | null>(null)
  const [elapsed,   setElapsed]   = useState(0)

  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 停止轮询
  const stopPolling = useCallback(() => {
    if (pollRef.current)  { clearInterval(pollRef.current);  pollRef.current  = null }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  // 开始轮询
  const startPolling = useCallback((tId: string, tType: 'sora' | 'veo') => {
    setElapsed(0)
    let failCount = 0  // 连续失败计数，防止偶发 failed 误判

    // 计时器（每秒 +1）
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)

    // 状态轮询（每 5 秒）
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await axios.get('/api/video-status', {
          params: { type: tType, taskId: tId },
        })

        if (data.progress != null) setProgress(data.progress)

        if (data.status === 'completed' && data.videoUrl) {
          stopPolling()
          setVideoUrl(data.videoUrl)
          setStatus('completed')
          setProgress(100)
        } else if (data.status === 'failed') {
          failCount++
          // 连续 2 次 failed 才认定真正失败，避免偶发服务端错误
          if (failCount >= 2) {
            stopPolling()
            setStatus('failed')
            setError('视频生成失败，请重试')
          }
        } else {
          failCount = 0  // 有进展就重置
        }
      } catch (err) {
        console.warn('[VideoGenNode] 轮询出错，忽略', err)
      }
    }, 5000)
  }, [stopPolling])

  // 卸载时清理
  useEffect(() => () => stopPolling(), [stopPolling])

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim()
    if (!trimmed || status === 'submitting' || status === 'processing') return

    stopPolling()
    setStatus('submitting')
    setError(null)
    setVideoUrl(null)
    setProgress(null)
    setTaskId(null)

    try {
      const { data } = await axios.post('/api/generate-video', {
        prompt: trimmed,
        model,
      })

      const { taskId: tId, type: tType } = data
      setTaskId(tId)
      setTaskType(tType)
      setStatus('processing')
      startPolling(tId, tType)

    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data?.error ?? err.message)
        : (err instanceof Error ? err.message : '提交失败')
      setError(String(msg))
      setStatus('failed')
    }
  }, [prompt, model, status, stopPolling, startPolling])

  const isGenerating = status === 'submitting' || status === 'processing'
  const canGenerate  = !!prompt.trim() && !isGenerating

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return m > 0 ? `${m}分${sec}秒` : `${sec}秒`
  }

  return (
    <div
      className="relative flex flex-col rounded-2xl overflow-hidden"
      style={{
        width: 360,
        background: T.nodeBg,
        border: `1px solid ${T.border}`,
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      <Handle type="target" position={Position.Left}  style={{ top: 44 }} />
      <Handle type="source" position={Position.Right} style={{ top: 44 }} />

      {/* ── 头部 ── */}
      <div
        className="drag-handle flex items-center gap-2.5 px-4 py-3 cursor-grab active:cursor-grabbing select-none"
        style={{ borderBottom: `1px solid ${T.border}` }}
      >
        <EditableTitle
          value={nodeName}
          onChange={handleRename}
          className="text-xs font-medium flex-1"
          style={{ color: T.text }}
        />
        <span style={{ fontSize: 10, color: T.textMuted, fontFamily: 'monospace' }}>#{id}</span>
      </div>

      {/* ── 主体 ── */}
      <div className="flex flex-col gap-3 p-4">

        {/* 模型选择 */}
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          className="w-full outline-none cursor-pointer"
          style={{
            fontSize: 12, borderRadius: 8, padding: '6px 10px',
            background: T.inputBg, border: `1px solid ${T.border}`,
            color: T.text,
          }}
        >
          {SORA_MODELS.map(m => (
            <option key={m.id} value={m.id} style={{ background: T.nodeBg, color: T.text }}>
              {m.label}  ·  {m.desc}
            </option>
          ))}
        </select>

        {/* Prompt */}
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate() }}
          placeholder="描述你想要的视频内容...（Ctrl+Enter 生成）"
          rows={4}
          className="w-full resize-none outline-none transition-all"
          style={{
            fontSize: 13, borderRadius: 10, padding: '10px 12px',
            background: T.inputBg, border: `1px solid ${T.border}`,
            color: T.text, lineHeight: 1.6,
          }}
          onFocus={e => (e.target.style.borderColor = `${C}0.5)`)}
          onBlur={e  => (e.target.style.borderColor = T.border)}
        />

        {/* 生成按钮 */}
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95"
          style={{
            background: canGenerate
              ? 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)'
              : T.inputBg,
            color: canGenerate ? '#fff' : T.textMuted,
            cursor: canGenerate ? 'pointer' : 'not-allowed',
            boxShadow: canGenerate ? `0 4px 15px ${C}0.35)` : 'none',
          }}
        >
          {isGenerating ? '生成中...' : '生成视频'}
        </button>

        {/* 生成中状态 */}
        {isGenerating && (
          <div
            className="flex flex-col gap-2.5 rounded-xl p-3"
            style={{
              background: `${C}0.08)`,
              border: `1px solid ${C}0.2)`,
            }}
          >
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: '#a78bfa' }}>
                {status === 'submitting' ? '提交中...' : '视频生成中，请耐心等待'}
              </span>
              <span style={{ color: T.textMuted }}>{formatTime(elapsed)}</span>
            </div>
            <ProgressBar progress={progress} />
            {progress != null && (
              <div className="text-xs text-right" style={{ color: T.textMuted }}>
                {progress}%
              </div>
            )}
            {taskId && (
              <div className="text-xs font-mono truncate" style={{ color: T.textMuted }}>
                {taskId}
              </div>
            )}
          </div>
        )}

        {/* 错误提示 */}
        {error && status === 'failed' && (
          <div
            className="text-xs px-3 py-2.5 rounded-xl"
            style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.2)',
              color: '#fca5a5',
            }}
          >
            ❌ {error}
          </div>
        )}

        {/* 完成后的视频播放器 */}
        {status === 'completed' && videoUrl && (
          <div className="flex flex-col gap-2">
            {/* 完成信息 */}
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
              style={{
                background: 'rgba(16,185,129,0.08)',
                border: '1px solid rgba(16,185,129,0.2)',
                color: '#6ee7b7',
              }}
            >
              <span>✅</span>
              <span>视频生成完毕</span>
              <span className="ml-auto" style={{ color: T.textMuted }}>
                耗时 {formatTime(elapsed)}
              </span>
            </div>

            {/* 视频播放器 */}
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              <video
                src={videoUrl}
                controls
                autoPlay
                loop
                className="w-full block"
                style={{ maxHeight: 280, background: '#000' }}
              >
                你的浏览器不支持视频播放
              </video>
            </div>

            {/* 下载按钮 */}
            <a
              href={videoUrl}
              download={`video-${taskType}-${Date.now()}.mp4`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2 rounded-xl text-xs text-center transition-all block"
              style={{
                background: `${C}0.08)`,
                border: `1px solid ${C}0.2)`,
                color: '#c4b5fd',
                textDecoration: 'none',
              }}
            >
              ↓ 下载视频
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
