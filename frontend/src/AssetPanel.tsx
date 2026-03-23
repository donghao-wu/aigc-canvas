import { useState, useRef, useCallback, useEffect } from 'react'
import axios from 'axios'
import { useTheme } from './ThemeContext'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token')
  return token ? { 'Authorization': `Bearer ${token}` } : {}
}

// ── 类型 ─────────────────────────────────────────────────────
export interface AssetItem {
  id: string
  type: 'CHARACTER' | 'SCENE' | 'PROP'
  name: string
  desc: string
  prompt: string
  selected: boolean
}

type AssetMode  = 'simple' | 'detailed'
type AssetStyle = '2D' | '3D' | '仿真人' | 'custom'
type AssetPhase = 'idle' | 'generating' | 'ready'

interface Props {
  promptTexts: string[]                          // 已生成的 Seedance 提示词纯文本数组
  script: string                                 // 原始剧本，用于角色形象分析
  projectId: string                              // 当前项目 ID，直接发送到此项目
  assets: AssetItem[]                            // 由父组件持有，用于保存
  onAssetsChange: (assets: AssetItem[]) => void  // 更新父组件
}

// ── 解析 Agent 输出 ───────────────────────────────────────────
function parseAssets(raw: string): AssetItem[] {
  const items: AssetItem[] = []
  // 用正则提取 START...END 块，不受 AI 前后缀文字干扰
  const blockRe = /===ASSET_START===([\s\S]*?)===ASSET_END===/g
  let match
  while ((match = blockRe.exec(raw)) !== null) {
    const inner = match[1].trim()
    const get = (key: string) => {
      const m = inner.match(new RegExp(`^${key}:\\s*(.+)`, 'm'))
      return m ? m[1].trim() : ''
    }
    const type = get('TYPE') as AssetItem['type']
    if (!['CHARACTER', 'SCENE', 'PROP'].includes(type)) continue
    items.push({
      id: `asset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      name:   get('NAME') || '未命名',
      desc:   get('DESC'),
      prompt: get('PROMPT'),
      selected: true,
    })
  }
  return items
}

const TYPE_LABEL: Record<AssetItem['type'], string> = {
  CHARACTER: '角色',
  SCENE: '场景',
  PROP: '道具',
}

// ── 组件 ─────────────────────────────────────────────────────
export default function AssetPanel({ promptTexts, script, projectId, assets, onAssetsChange }: Props) {
  const { T } = useTheme()

  const [mode,       setMode]       = useState<AssetMode>('simple')
  const [style,      setStyle]      = useState<AssetStyle>('3D')
  const [customStyle,setCustomStyle]= useState('')
  const [phase,      setPhase]      = useState<AssetPhase>(assets.length > 0 ? 'ready' : 'idle')
  const [streamText, setStreamText] = useState('')

  // 代理 assets setter，同步到父组件
  const setAssets = (updater: AssetItem[] | ((prev: AssetItem[]) => AssetItem[])) => {
    const next = typeof updater === 'function' ? updater(assets) : updater
    onAssetsChange(next)
  }

  // assets 从父组件异步加载后，同步 phase
  useEffect(() => {
    if (assets.length > 0 && phase === 'idle') setPhase('ready')
  }, [assets.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // 发送到画布相关
  const [sendStatus, setSendStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const streamRef = useRef('')

  // ── 流式请求 ────────────────────────────────────────────────
  const generate = useCallback(async () => {
    if (!promptTexts.length || phase === 'generating') return
    setPhase('generating')
    setAssets([])
    setStreamText('')
    streamRef.current = ''

    try {
      const res = await fetch('/api/asset-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          promptTexts,
          script,
          mode,
          style,
          customStyle: style === 'custom' ? customStyle : '',
        }),
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
          if (data.trim() === '[DONE]') {
            const parsed = parseAssets(streamRef.current)
            setAssets(parsed)
            setPhase('ready')
            return
          }
          try {
            const p = JSON.parse(data)
            if (p.error) { setPhase('idle'); return }
            if (p.text) { streamRef.current += p.text; setStreamText(streamRef.current) }
          } catch {}
        }
      }
      const parsed = parseAssets(streamRef.current)
      setAssets(parsed)
      setPhase('ready')
    } catch {
      setPhase('idle')
    }
  }, [promptTexts, mode, style, customStyle, phase])

  // ── 全选 / 取消 ────────────────────────────────────────────
  const toggleAll   = (type?: AssetItem['type']) => {
    setAssets(prev => {
      const target  = type ? prev.filter(a => a.type === type) : prev
      const allSel  = target.every(a => a.selected)
      return prev.map(a => (!type || a.type === type) ? { ...a, selected: !allSel } : a)
    })
  }
  const toggleOne   = (id: string) => setAssets(prev => prev.map(a => a.id === id ? { ...a, selected: !a.selected } : a))
  const updatePrompt = (id: string, v: string) => setAssets(prev => prev.map(a => a.id === id ? { ...a, prompt: v } : a))

  // ── 直接发送到当前项目画布 ──────────────────────────────────
  const sendToCanvas = async () => {
    const selected = assets.filter(a => a.selected)
    if (!selected.length || sendStatus === 'loading') return
    setSendStatus('loading')

    try {
      const { data: proj } = await axios.get(`/api/projects/${projectId}`)
      const existingNodes: unknown[] = proj.nodes || []

      // 按类型分三列排布，避免与现有节点重叠（从 y=2000 往下）
      const colX: Record<AssetItem['type'], number> = { CHARACTER: 100, SCENE: 1460, PROP: 2820 }
      const colCount: Record<AssetItem['type'], number> = { CHARACTER: 0, SCENE: 0, PROP: 0 }

      const newNodes = selected.map(asset => {
        const x = colX[asset.type]
        const y = 2000 + colCount[asset.type] * 480
        colCount[asset.type]++
        return {
          id: `asset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'imageGen',
          position: { x, y },
          data: {
            name: `${TYPE_LABEL[asset.type]} · ${asset.name}`,
            presetPrompt: asset.prompt,
          },
        }
      })

      const updatedNodes = [...existingNodes, ...newNodes]
      await axios.put(`/api/projects/${projectId}`, { nodes: updatedNodes, edges: proj.edges || [] })
      window.dispatchEvent(new CustomEvent('canvas-refresh'))
      setSendStatus('done')
      setTimeout(() => setSendStatus('idle'), 2000)
    } catch {
      setSendStatus('error')
      setTimeout(() => setSendStatus('idle'), 2000)
    }
  }

  // ── 分组渲染 ────────────────────────────────────────────────
  const selectedCount = assets.filter(a => a.selected).length
  const groups: AssetItem['type'][] = mode === 'simple'
    ? ['CHARACTER', 'SCENE']
    : ['CHARACTER', 'SCENE', 'PROP']

  const btnBase = {
    padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', border: `1px solid ${T.border}`,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* 配置区 */}
      <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        {/* 风格选择 */}
        <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>视觉风格</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {(['2D', '3D', '仿真人', 'custom'] as AssetStyle[]).map(s => (
            <button key={s} onClick={() => setStyle(s)} style={{
              ...btnBase,
              background: style === s ? T.btnBg : T.nodeSubtle,
              color: style === s ? T.btnText : T.textSub,
              border: style === s ? 'none' : `1px solid ${T.border}`,
            }}>
              {s === 'custom' ? '自定义' : s}
            </button>
          ))}
        </div>
        {style === 'custom' && (
          <input
            value={customStyle}
            onChange={e => setCustomStyle(e.target.value)}
            placeholder="输入风格提示词，如：anime style, Studio Ghibli..."
            style={{ width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 11, background: T.inputBg, border: `1px solid ${T.border}`, color: T.text, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 10 }}
          />
        )}

        {/* 模式选择 */}
        <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>提取模式</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {(['simple', 'detailed'] as AssetMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              ...btnBase,
              background: mode === m ? T.btnBg : T.nodeSubtle,
              color: mode === m ? T.btnText : T.textSub,
              border: mode === m ? 'none' : `1px solid ${T.border}`,
            }}>
              {m === 'simple' ? '简单（角色+场景）' : '详细（+道具）'}
            </button>
          ))}
        </div>

        <button
          onClick={generate}
          disabled={!promptTexts.length || phase === 'generating'}
          style={{
            width: '100%', padding: '8px 0', borderRadius: 7, fontSize: 12, fontWeight: 600,
            background: (!promptTexts.length || phase === 'generating') ? T.nodeSubtle : T.btnBg,
            border: 'none',
            color: (!promptTexts.length || phase === 'generating') ? T.textMuted : T.btnText,
            cursor: (!promptTexts.length || phase === 'generating') ? 'not-allowed' : 'pointer',
          }}
        >{phase === 'generating' ? '分析中...' : '生成资产清单'}</button>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>

        {/* 生成中流式预览 */}
        {phase === 'generating' && (
          <pre style={{ fontSize: 11, color: T.textMuted, whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.7, margin: 0 }}>
            {streamText}<span style={{ opacity: 0.4 }}>▌</span>
          </pre>
        )}

        {/* 空状态 */}
        {phase === 'idle' && (
          <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textMuted, fontSize: 12, textAlign: 'center' }}>
            选择风格和模式后<br />点击生成资产清单
          </div>
        )}

        {/* 资产卡片 */}
        {phase === 'ready' && groups.map(type => {
          const list = assets.filter(a => a.type === type)
          if (!list.length) return null
          const allSel = list.every(a => a.selected)
          return (
            <div key={type} style={{ marginBottom: 16 }}>
              {/* 分组标题 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: T.textSub }}>
                  {TYPE_LABEL[type]}  ·  {list.length} 项
                </span>
                <button onClick={() => toggleAll(type)} style={{ ...btnBase, fontSize: 10, padding: '2px 8px', background: T.nodeSubtle, color: T.textMuted }}>
                  {allSel ? '取消全选' : '全选'}
                </button>
              </div>

              {list.map(asset => (
                <div key={asset.id} style={{
                  borderRadius: 8, overflow: 'hidden', background: T.nodeBg,
                  border: `1px solid ${asset.selected ? T.borderMid : T.border}`,
                  marginBottom: 8, opacity: asset.selected ? 1 : 0.5,
                  transition: 'opacity 0.15s, border-color 0.15s',
                }}>
                  {/* 卡片头 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: T.nodeSubtle, borderBottom: `1px solid ${T.border}` }}>
                    <input type="checkbox" checked={asset.selected} onChange={() => toggleOne(asset.id)}
                      style={{ cursor: 'pointer', accentColor: T.btnBg }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: T.text, flex: 1 }}>{asset.name}</span>
                    <span style={{ fontSize: 10, color: T.textMuted }}>{asset.desc}</span>
                  </div>
                  {/* 提示词（可编辑）*/}
                  <textarea
                    value={asset.prompt}
                    onChange={e => updatePrompt(asset.id, e.target.value)}
                    rows={3}
                    style={{ width: '100%', padding: '8px 10px', resize: 'vertical', background: 'transparent', border: 'none', outline: 'none', fontSize: 11, lineHeight: 1.65, color: T.textSub, fontFamily: 'inherit', boxSizing: 'border-box' }}
                  />
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* 底部操作栏 */}
      {phase === 'ready' && assets.length > 0 && (
        <div style={{ padding: '10px 16px', borderTop: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={() => toggleAll()} style={{ ...btnBase, background: T.nodeSubtle, color: T.textMuted, fontSize: 11 }}>
            {assets.every(a => a.selected) ? '取消全选' : '全选'}
          </button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: T.textMuted }}>{selectedCount} 项已选</span>
          <button
            onClick={sendToCanvas}
            disabled={selectedCount === 0 || sendStatus === 'loading'}
            style={{
              padding: '7px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600,
              background: selectedCount && sendStatus !== 'loading' ? T.btnBg : T.nodeSubtle,
              border: 'none',
              color: selectedCount && sendStatus !== 'loading' ? T.btnText : T.textMuted,
              cursor: selectedCount && sendStatus !== 'loading' ? 'pointer' : 'not-allowed',
            }}
          >
            {sendStatus === 'loading' ? '发送中...' : sendStatus === 'done' ? '已发送到画布' : sendStatus === 'error' ? '发送失败' : '发送到画布'}
          </button>
        </div>
      )}

    </div>
  )
}
