/**
 * AssetLibrary.tsx
 * 资产库页面 — 按类型分组网格 + 右侧详情面板
 * 支持多视角提示词（asset_prompts）、DNA 字段编辑、单角度重生图
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import { useTheme } from './ThemeContext'
import type { AssetType } from './types/asset'

// ── 类型 ───────────────────────────────────────────────────────
interface AssetPrompt {
  id: string
  assetId: string
  label: string       // e.g. "正面", "侧面", "背面", "特写"
  prompt: string
  imageUrl: string | null
  generatedAt: string | null
}

interface LibAsset {
  id: string
  projectId: string
  userId: string
  type: AssetType
  name: string
  description: string
  prompt: string
  imageUrl: string | null
  dna: string | null
  fields: Record<string, string> | null
  tags: string[]
  createdAt: string
  prompts?: AssetPrompt[]
}

interface Props {
  projectId: string
  projectName: string
  onHome: () => void
  onSwitchToCanvas: () => void
  onSwitchToWorkbench: () => void
}

// ── 常量 ───────────────────────────────────────────────────────
const TYPE_LABEL: Record<AssetType, string> = {
  CHARACTER: '角色',
  SCENE:     '场景',
  PROP:      '道具',
}

const TYPE_ORDER: AssetType[] = ['CHARACTER', 'SCENE', 'PROP']

const TYPE_ACCENT: Record<AssetType, string> = {
  CHARACTER: 'rgba(99,179,237,0.8)',
  SCENE:     'rgba(104,211,145,0.8)',
  PROP:      'rgba(246,173,85,0.8)',
}

const TYPE_BG: Record<AssetType, string> = {
  CHARACTER: 'rgba(99,179,237,0.1)',
  SCENE:     'rgba(104,211,145,0.1)',
  PROP:      'rgba(246,173,85,0.1)',
}

const DEFAULT_ANGLE_LABELS = ['正面', '侧面', '背面', '特写']

// ── 主组件 ────────────────────────────────────────────────────
export default function AssetLibrary({ projectId, projectName, onHome, onSwitchToCanvas, onSwitchToWorkbench }: Props) {
  const { theme, T, toggle } = useTheme()

  const [assets, setAssets]           = useState<LibAsset[]>([])
  const [loading, setLoading]         = useState(true)
  const [selected, setSelected]       = useState<LibAsset | null>(null)
  const [filterType, setFilterType]   = useState<AssetType | 'ALL'>('ALL')
  const [search, setSearch]           = useState('')

  // Detail-panel state
  const [editDna, setEditDna]         = useState('')
  const [dnaEditing, setDnaEditing]   = useState(false)
  const [dnaSaving, setDnaSaving]     = useState(false)
  const [prompts, setPrompts]         = useState<AssetPrompt[]>([])
  const [genLoading, setGenLoading]   = useState<Record<string, boolean>>({})
  const [addLabel, setAddLabel]       = useState('')
  const [addPrompt, setAddPrompt]     = useState('')
  const [addingPrompt, setAddingPrompt] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const dnaRef = useRef<HTMLTextAreaElement>(null)

  // ── Load asset list ───────────────────────────────────────────
  const loadAssets = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get<LibAsset[]>(`/api/assets?projectId=${projectId}`)
      setAssets(data)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { loadAssets() }, [loadAssets])

  // ── Load detail when selection changes ───────────────────────
  const loadDetail = useCallback(async (asset: LibAsset) => {
    setSelected(asset)
    setEditDna(asset.dna || '')
    setDnaEditing(false)
    setShowAddForm(false)
    try {
      const { data } = await axios.get<AssetPrompt[]>(`/api/assets/${asset.id}/prompts`)
      setPrompts(data)
    } catch {
      setPrompts([])
    }
  }, [])

  // ── Save DNA ─────────────────────────────────────────────────
  const saveDna = useCallback(async () => {
    if (!selected) return
    setDnaSaving(true)
    try {
      await axios.patch(`/api/assets/${selected.id}/dna`, { dna: editDna })
      setSelected(s => s ? { ...s, dna: editDna } : s)
      setAssets(a => a.map(x => x.id === selected.id ? { ...x, dna: editDna } : x))
      setDnaEditing(false)
    } finally {
      setDnaSaving(false)
    }
  }, [selected, editDna])

  // ── Add prompt angle ─────────────────────────────────────────
  const addPromptAngle = useCallback(async () => {
    if (!selected || !addLabel.trim() || !addPrompt.trim()) return
    setAddingPrompt(true)
    try {
      const { data } = await axios.post<AssetPrompt[]>(`/api/assets/${selected.id}/prompts`, {
        label: addLabel.trim(),
        prompt: addPrompt.trim(),
      })
      setPrompts(data)
      setAddLabel('')
      setAddPrompt('')
      setShowAddForm(false)
    } finally {
      setAddingPrompt(false)
    }
  }, [selected, addLabel, addPrompt])

  // ── Delete prompt angle ──────────────────────────────────────
  const deletePromptAngle = useCallback(async (promptId: string) => {
    if (!selected) return
    const { data } = await axios.delete<AssetPrompt[]>(`/api/assets/${selected.id}/prompts/${promptId}`)
    setPrompts(data)
  }, [selected])

  // ── Generate image for a prompt angle ────────────────────────
  const generateForAngle = useCallback(async (p: AssetPrompt) => {
    if (!selected) return
    setGenLoading(g => ({ ...g, [p.id]: true }))
    try {
      // Call the existing image-gen endpoint with the prompt
      const { data: genData } = await axios.post('/api/generate', {
        prompt: p.prompt,
        model: 'wanx2.1-t2i-turbo',
        size: '1024*1024',
      })
      const imageUrl = genData.imageUrl || genData.url
      if (!imageUrl) throw new Error('No image URL returned')

      // Upload to saved images and get CDN url
      const { data: saved } = await axios.post('/api/images/save', { imageUrl })
      const finalUrl = saved.url || imageUrl

      // Update prompt record
      const { data: updatedPrompts } = await axios.patch<AssetPrompt[]>(
        `/api/assets/${selected.id}/prompts/${p.id}/image`,
        { imageUrl: finalUrl }
      )
      setPrompts(updatedPrompts)

      // Also update asset cover image if it has no image yet
      if (!selected.imageUrl) {
        await axios.patch(`/api/assets/${selected.id}/image`, { imageUrl: finalUrl })
        setSelected(s => s ? { ...s, imageUrl: finalUrl } : s)
        setAssets(a => a.map(x => x.id === selected.id ? { ...x, imageUrl: finalUrl } : x))
      }
    } catch (e: any) {
      console.error('[gen angle]', e.message)
    } finally {
      setGenLoading(g => ({ ...g, [p.id]: false }))
    }
  }, [selected])

  // ── Generate cover image (main asset prompt) ─────────────────
  const generateCover = useCallback(async () => {
    if (!selected) return
    const pid = 'cover'
    setGenLoading(g => ({ ...g, [pid]: true }))
    try {
      const { data: genData } = await axios.post('/api/generate', {
        prompt: selected.prompt,
        model: 'wanx2.1-t2i-turbo',
        size: '1024*1024',
      })
      const imageUrl = genData.imageUrl || genData.url
      if (!imageUrl) throw new Error('No image URL returned')
      const { data: saved } = await axios.post('/api/images/save', { imageUrl })
      const finalUrl = saved.url || imageUrl
      await axios.patch(`/api/assets/${selected.id}/image`, { imageUrl: finalUrl })
      setSelected(s => s ? { ...s, imageUrl: finalUrl } : s)
      setAssets(a => a.map(x => x.id === selected.id ? { ...x, imageUrl: finalUrl } : x))
    } catch (e: any) {
      console.error('[gen cover]', e.message)
    } finally {
      setGenLoading(g => ({ ...g, [pid]: false }))
    }
  }, [selected])

  // ── Filtered asset list ───────────────────────────────────────
  const filtered = assets.filter(a => {
    if (filterType !== 'ALL' && a.type !== filterType) return false
    if (search && !a.name.includes(search) && !a.description.includes(search)) return false
    return true
  })

  const grouped = TYPE_ORDER.reduce<Record<AssetType, LibAsset[]>>((acc, t) => {
    acc[t] = filtered.filter(a => a.type === t)
    return acc
  }, { CHARACTER: [], SCENE: [], PROP: [] })

  // ── Styles ───────────────────────────────────────────────────
  const bg    = theme === 'dark' ? '#0D0B08' : '#EDE8DC'
  const panel = theme === 'dark' ? 'rgba(24,20,16,0.98)' : 'rgba(254,252,245,0.98)'
  const card  = theme === 'dark' ? 'rgba(30,24,16,0.9)' : 'rgba(255,252,244,0.9)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', background: bg, overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 16px',
        background: T.headerBg,
        borderBottom: `1px solid ${T.border}`,
        backdropFilter: 'blur(24px)',
        flexShrink: 0,
        zIndex: 10,
      }}>
        {/* Logo / home */}
        <button onClick={onHome} style={btnReset}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '3px 8px', borderRadius: 8,
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
          </div>
        </button>

        <div style={{ width: 1, height: 14, background: T.border }} />
        <span style={{ fontSize: 13, color: T.textSub, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {projectName}
        </span>

        <div style={{ width: 1, height: 14, background: T.border }} />

        {/* Tab switcher */}
        <div style={{
          display: 'flex', alignItems: 'center',
          background: T.nodeSubtle, border: `1px solid ${T.border}`,
          borderRadius: 8, padding: 3, gap: 2,
        }}>
          {[
            { label: '剧本',   active: false, onClick: onSwitchToWorkbench },
            { label: '生图',   active: false, onClick: onSwitchToCanvas },
            { label: '资产库', active: true,  onClick: undefined },
          ].map(item => (
            <button key={item.label} onClick={item.onClick} style={{
              fontSize: 12, fontWeight: item.active ? 600 : 400,
              padding: '4px 11px', borderRadius: 6, border: 'none', cursor: item.onClick ? 'pointer' : 'default',
              background: item.active ? (theme === 'dark' ? 'rgba(201,152,42,0.15)' : 'rgba(184,135,14,0.12)') : 'transparent',
              color: item.active ? T.accent : T.textSub,
              transition: 'all 0.15s',
            }}
              onMouseEnter={e => { if (!item.active) e.currentTarget.style.color = T.text }}
              onMouseLeave={e => { if (!item.active) e.currentTarget.style.color = T.textSub }}
            >{item.label}</button>
          ))}
        </div>

        {/* Search */}
        <div style={{ flex: 1, maxWidth: 260, marginLeft: 8 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索资产名称…"
            style={{
              width: '100%', padding: '5px 12px',
              background: T.inputBg, border: `1px solid ${T.border}`,
              borderRadius: 8, fontSize: 12, color: T.text,
              outline: 'none',
            }}
          />
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Type filter */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['ALL', ...TYPE_ORDER] as const).map(t => (
              <button key={t} onClick={() => setFilterType(t)} style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 6,
                border: `1px solid ${filterType === t ? T.accent : T.border}`,
                background: filterType === t ? (theme === 'dark' ? 'rgba(201,152,42,0.12)' : 'rgba(184,135,14,0.1)') : 'transparent',
                color: filterType === t ? T.accent : T.textSub,
                cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {t === 'ALL' ? '全部' : TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          <button onClick={toggle} style={{ ...btnReset, fontSize: 11, padding: '3px 8px', borderRadius: 6, color: T.textSub }}
            onMouseEnter={e => e.currentTarget.style.color = T.text}
            onMouseLeave={e => e.currentTarget.style.color = T.textSub}
          >
            {theme === 'dark' ? '◑ 浅色' : '◑ 深色'}
          </button>
        </div>
      </div>

      {/* ── Body: grid + detail panel ───────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Grid */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '20px 24px',
        }}>
          {loading ? (
            <div style={{ color: T.textMuted, fontSize: 13, paddingTop: 60, textAlign: 'center' }}>加载中…</div>
          ) : assets.length === 0 ? (
            <EmptyState T={T} />
          ) : (
            TYPE_ORDER.map(type => {
              const group = grouped[type]
              if (group.length === 0) return null
              return (
                <div key={type} style={{ marginBottom: 32 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <div style={{
                      width: 3, height: 14, borderRadius: 2,
                      background: TYPE_ACCENT[type],
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{TYPE_LABEL[type]}</span>
                    <span style={{ fontSize: 11, color: T.textMuted }}>({group.length})</span>
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                    gap: 12,
                  }}>
                    {group.map(asset => (
                      <AssetCard
                        key={asset.id}
                        asset={asset}
                        selected={selected?.id === asset.id}
                        onClick={() => loadDetail(asset)}
                        T={T}
                        theme={theme}
                        accent={TYPE_ACCENT[type]}
                        typeBg={TYPE_BG[type]}
                      />
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{
            width: 360, flexShrink: 0,
            background: panel,
            borderLeft: `1px solid ${T.border}`,
            display: 'flex', flexDirection: 'column',
            overflowY: 'auto',
          }}>
            {/* Cover image */}
            <div style={{
              width: '100%', aspectRatio: '1',
              background: T.nodeSubtle,
              position: 'relative', flexShrink: 0,
              overflow: 'hidden',
            }}>
              {selected.imageUrl ? (
                <img
                  src={selected.imageUrl}
                  alt={selected.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 10,
                }}>
                  <div style={{ fontSize: 32, opacity: 0.3 }}>🖼️</div>
                  <button
                    onClick={generateCover}
                    disabled={genLoading['cover']}
                    style={accentBtn(T, genLoading['cover'])}
                  >
                    {genLoading['cover'] ? '生成中…' : '生成封面图'}
                  </button>
                </div>
              )}
              {selected.imageUrl && (
                <button
                  onClick={generateCover}
                  disabled={genLoading['cover']}
                  title="重新生成封面"
                  style={{
                    position: 'absolute', top: 8, right: 8,
                    padding: '4px 10px', fontSize: 11,
                    background: 'rgba(0,0,0,0.55)', color: '#fff',
                    border: 'none', borderRadius: 6, cursor: 'pointer',
                    backdropFilter: 'blur(8px)',
                    opacity: genLoading['cover'] ? 0.6 : 1,
                  }}
                >
                  {genLoading['cover'] ? '…' : '↺'}
                </button>
              )}
            </div>

            {/* Info */}
            <div style={{ padding: '16px 18px', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Name + type badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{selected.name}</span>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 4,
                  background: TYPE_BG[selected.type],
                  color: TYPE_ACCENT[selected.type],
                  border: `1px solid ${TYPE_ACCENT[selected.type].replace('0.8', '0.3')}`,
                  fontWeight: 600,
                }}>
                  {TYPE_LABEL[selected.type]}
                </span>
              </div>

              {/* Description */}
              {selected.description && (
                <p style={{ fontSize: 12, color: T.textSub, lineHeight: 1.6, margin: 0 }}>
                  {selected.description}
                </p>
              )}

              {/* DNA field */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    DNA / 特征描述
                  </span>
                  {!dnaEditing && (
                    <button onClick={() => { setDnaEditing(true); setTimeout(() => dnaRef.current?.focus(), 50) }}
                      style={{ ...btnReset, fontSize: 11, color: T.accent }}>
                      编辑
                    </button>
                  )}
                </div>
                {dnaEditing ? (
                  <div>
                    <textarea
                      ref={dnaRef}
                      value={editDna}
                      onChange={e => setEditDna(e.target.value)}
                      rows={4}
                      style={{
                        width: '100%', resize: 'vertical',
                        background: T.inputBg, border: `1px solid ${T.borderMid}`,
                        borderRadius: 8, padding: '8px 10px',
                        fontSize: 12, color: T.text, lineHeight: 1.6,
                        outline: 'none', boxSizing: 'border-box',
                      }}
                      placeholder="描述该资产的核心外观特征，用于跨场景复用时保持一致性…"
                    />
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button onClick={saveDna} disabled={dnaSaving} style={accentBtn(T, dnaSaving)}>
                        {dnaSaving ? '保存中…' : '保存'}
                      </button>
                      <button onClick={() => { setEditDna(selected.dna || ''); setDnaEditing(false) }} style={ghostBtn(T)}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    fontSize: 12, color: editDna ? T.text : T.textMuted,
                    lineHeight: 1.6,
                    background: T.nodeSubtle, borderRadius: 8,
                    padding: '8px 10px',
                    minHeight: 48,
                    border: `1px solid ${T.border}`,
                  }}>
                    {editDna || '暂无 DNA 描述，点击"编辑"添加…'}
                  </div>
                )}
              </div>

              {/* Base prompt */}
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 6 }}>
                  基础提示词
                </span>
                <div style={{
                  fontSize: 11, color: T.textSub, lineHeight: 1.6,
                  background: T.nodeSubtle, borderRadius: 8,
                  padding: '8px 10px', border: `1px solid ${T.border}`,
                  maxHeight: 80, overflowY: 'auto',
                  fontFamily: 'monospace',
                }}>
                  {selected.prompt || '—'}
                </div>
              </div>

              {/* Multi-angle prompts */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    多视角提示词
                  </span>
                  <button onClick={() => setShowAddForm(v => !v)} style={{ ...btnReset, fontSize: 11, color: T.accent }}>
                    {showAddForm ? '收起' : '+ 添加角度'}
                  </button>
                </div>

                {/* Add form */}
                {showAddForm && (
                  <div style={{
                    background: T.nodeSubtle, border: `1px solid ${T.border}`,
                    borderRadius: 8, padding: '10px 12px', marginBottom: 10,
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    {/* Quick-pick labels */}
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {DEFAULT_ANGLE_LABELS.filter(l => !prompts.find(p => p.label === l)).map(l => (
                        <button key={l} onClick={() => setAddLabel(l)} style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 4,
                          border: `1px solid ${addLabel === l ? T.accent : T.border}`,
                          background: addLabel === l ? 'rgba(201,152,42,0.12)' : 'transparent',
                          color: addLabel === l ? T.accent : T.textSub,
                          cursor: 'pointer',
                        }}>{l}</button>
                      ))}
                    </div>
                    <input
                      value={addLabel}
                      onChange={e => setAddLabel(e.target.value)}
                      placeholder="角度名称（如：正面、四分之三侧面…）"
                      style={inputStyle(T)}
                    />
                    <textarea
                      value={addPrompt}
                      onChange={e => setAddPrompt(e.target.value)}
                      rows={3}
                      placeholder="该角度的完整提示词…"
                      style={{ ...inputStyle(T), resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
                    />
                    <button
                      onClick={addPromptAngle}
                      disabled={addingPrompt || !addLabel.trim() || !addPrompt.trim()}
                      style={accentBtn(T, addingPrompt || !addLabel.trim() || !addPrompt.trim())}
                    >
                      {addingPrompt ? '添加中…' : '添加'}
                    </button>
                  </div>
                )}

                {/* Prompt list */}
                {prompts.length === 0 ? (
                  <div style={{ fontSize: 12, color: T.textMuted, padding: '8px 0' }}>暂无多视角提示词</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {prompts.map(p => (
                      <PromptAngleCard
                        key={p.id}
                        prompt={p}
                        onGenerate={() => generateForAngle(p)}
                        onDelete={() => deletePromptAngle(p.id)}
                        generating={genLoading[p.id] || false}
                        T={T}
                        theme={theme}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Created at */}
              <div style={{ fontSize: 10, color: T.textMuted, marginTop: 'auto', paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
                创建于 {new Date(selected.createdAt).toLocaleDateString('zh-CN')}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── AssetCard ─────────────────────────────────────────────────
function AssetCard({ asset, selected, onClick, T, theme, accent, typeBg }: {
  asset: LibAsset
  selected: boolean
  onClick: () => void
  T: any
  theme: string
  accent: string
  typeBg: string
}) {
  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 10,
        background: selected
          ? (theme === 'dark' ? 'rgba(201,152,42,0.08)' : 'rgba(184,135,14,0.06)')
          : (theme === 'dark' ? 'rgba(30,24,16,0.9)' : 'rgba(255,252,244,0.9)'),
        border: `1.5px solid ${selected ? 'rgba(201,152,42,0.45)' : T.border}`,
        cursor: 'pointer',
        overflow: 'hidden',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: selected
          ? '0 0 0 2px rgba(201,152,42,0.15)'
          : (theme === 'dark' ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.06)'),
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = T.borderMid }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = T.border }}
    >
      {/* Image */}
      <div style={{
        width: '100%', aspectRatio: '1',
        background: typeBg,
        overflow: 'hidden', position: 'relative',
      }}>
        {asset.imageUrl ? (
          <img src={asset.imageUrl} alt={asset.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, opacity: 0.25,
          }}>
            {asset.type === 'CHARACTER' ? '👤' : asset.type === 'SCENE' ? '🏞️' : '🎭'}
          </div>
        )}
        {/* Type badge */}
        <div style={{
          position: 'absolute', top: 5, left: 5,
          fontSize: 9, padding: '1px 5px', borderRadius: 3,
          background: 'rgba(0,0,0,0.55)', color: accent,
          fontWeight: 600, backdropFilter: 'blur(4px)',
        }}>
          {asset.type === 'CHARACTER' ? '角色' : asset.type === 'SCENE' ? '场景' : '道具'}
        </div>
      </div>

      {/* Name */}
      <div style={{ padding: '7px 9px 8px' }}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: T.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {asset.name}
        </div>
        {asset.description && (
          <div style={{
            fontSize: 10, color: T.textMuted, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {asset.description}
          </div>
        )}
      </div>
    </div>
  )
}

// ── PromptAngleCard ───────────────────────────────────────────
function PromptAngleCard({ prompt, onGenerate, onDelete, generating, T, theme }: {
  prompt: AssetPrompt
  onGenerate: () => void
  onDelete: () => void
  generating: boolean
  T: any
  theme: string
}) {
  const [showPrompt, setShowPrompt] = useState(false)

  return (
    <div style={{
      background: T.nodeSubtle, border: `1px solid ${T.border}`,
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Image row */}
      {prompt.imageUrl ? (
        <div style={{ width: '100%', aspectRatio: '16/9', position: 'relative', overflow: 'hidden' }}>
          <img src={prompt.imageUrl} alt={prompt.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{
            position: 'absolute', inset: 0, opacity: 0, transition: 'opacity 0.15s',
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '0' }}
          >
            <button onClick={onGenerate} disabled={generating} style={{
              padding: '6px 14px', fontSize: 11, borderRadius: 6,
              background: 'rgba(201,152,42,0.9)', color: '#0D0B08',
              border: 'none', cursor: 'pointer', fontWeight: 600,
            }}>
              {generating ? '生成中…' : '↺ 重新生成'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{
          width: '100%', padding: '12px',
          display: 'flex', justifyContent: 'center',
          background: theme === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
        }}>
          <button onClick={onGenerate} disabled={generating} style={accentBtn(T, generating)}>
            {generating ? '生成中…' : '生成图片'}
          </button>
        </div>
      )}

      {/* Label row */}
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: T.text,
          background: 'rgba(201,152,42,0.1)', border: '1px solid rgba(201,152,42,0.2)',
          padding: '1px 7px', borderRadius: 4,
        }}>
          {prompt.label}
        </span>
        <button onClick={() => setShowPrompt(v => !v)} style={{ ...btnReset, fontSize: 10, color: T.textMuted }}>
          {showPrompt ? '收起' : '查看提示词'}
        </button>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={onDelete} title="删除" style={{ ...btnReset, fontSize: 12, color: T.textMuted, padding: '0 4px' }}
            onMouseEnter={e => e.currentTarget.style.color = 'rgba(239,68,68,0.8)'}
            onMouseLeave={e => e.currentTarget.style.color = T.textMuted}
          >✕</button>
        </div>
      </div>

      {showPrompt && (
        <div style={{
          margin: '0 10px 10px', padding: '7px 9px',
          background: T.inputBg, borderRadius: 6, border: `1px solid ${T.border}`,
          fontSize: 10, color: T.textSub, lineHeight: 1.6, fontFamily: 'monospace',
        }}>
          {prompt.prompt}
        </div>
      )}

      {prompt.generatedAt && (
        <div style={{ padding: '0 10px 8px', fontSize: 9, color: T.textMuted }}>
          生成于 {new Date(prompt.generatedAt).toLocaleString('zh-CN')}
        </div>
      )}
    </div>
  )
}

// ── EmptyState ────────────────────────────────────────────────
function EmptyState({ T }: { T: any }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      paddingTop: 80, gap: 16,
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16,
        background: 'rgba(201,152,42,0.06)',
        border: '1px solid rgba(201,152,42,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, opacity: 0.6,
      }}>🗃️</div>
      <div style={{ fontSize: 14, color: T.textMuted }}>暂无资产</div>
      <div style={{ fontSize: 12, color: T.textMuted, textAlign: 'center', maxWidth: 260, lineHeight: 1.6 }}>
        在剧本工作台的「资产登记」步骤完成后，角色、场景和道具资产会自动同步到这里。
      </div>
    </div>
  )
}

// ── Inline style helpers ──────────────────────────────────────
const btnReset: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
}

function accentBtn(T: any, disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 14px', fontSize: 12, borderRadius: 6,
    background: disabled ? 'rgba(201,152,42,0.3)' : T.btnBg,
    color: disabled ? T.textMuted : T.btnText,
    border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600, transition: 'background 0.15s',
  }
}

function ghostBtn(T: any): React.CSSProperties {
  return {
    padding: '6px 14px', fontSize: 12, borderRadius: 6,
    background: 'transparent', color: T.textSub,
    border: `1px solid ${T.border}`, cursor: 'pointer',
  }
}

function inputStyle(T: any): React.CSSProperties {
  return {
    width: '100%', padding: '6px 10px',
    background: T.inputBg, border: `1px solid ${T.border}`,
    borderRadius: 6, fontSize: 12, color: T.text, outline: 'none',
    boxSizing: 'border-box',
  }
}
