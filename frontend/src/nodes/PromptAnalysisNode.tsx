import { useState, useCallback } from 'react'
import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react'
import { useTheme } from '../ThemeContext'

// ── 类型定义 ────────────────────────────────────────────────────
export interface PromptAnalysis {
  characters: Array<{ description: string; position: string }>
  setting: { location: string; era: string; time_of_day: string }
  lighting: { type: string; direction: string; tone: string; quality: string }
  composition: { shot_type: string; angle: string; depth_of_field: string }
  color: { palette: string; grade: string; temperature: string }
  atmosphere: { mood: string; keywords: string[] }
  camera: { lens: string; bokeh: string }
  post_processing: { style: string; effects: string }
  style: { aesthetic: string; film_grain: boolean }
}

const EMPTY_ANALYSIS: PromptAnalysis = {
  characters: [],
  setting: { location: '', era: '', time_of_day: '' },
  lighting: { type: '', direction: '', tone: '', quality: '' },
  composition: { shot_type: '', angle: '', depth_of_field: '' },
  color: { palette: '', grade: '', temperature: '' },
  atmosphere: { mood: '', keywords: [] },
  camera: { lens: '', bokeh: '' },
  post_processing: { style: '', effects: '' },
  style: { aesthetic: '', film_grain: false },
}

export function buildPrompt(a: PromptAnalysis | null | undefined): string {
  if (!a) return ''
  const parts: string[] = []
  // 人物
  if (a.characters?.length)
    parts.push(a.characters.map(c => c.description).filter(Boolean).join('，'))
  // 场景
  if (a.setting?.location) parts.push(a.setting.location)
  if (a.setting?.time_of_day) parts.push(a.setting.time_of_day)
  if (a.setting?.era) parts.push(`${a.setting.era}风格`)
  // 光线
  if (a.lighting?.quality) parts.push(a.lighting.quality)
  if (a.lighting?.direction && a.lighting?.tone)
    parts.push(`${a.lighting.direction}${a.lighting.tone}光线`)
  else if (a.lighting?.tone) parts.push(`${a.lighting.tone}光线`)
  // 构图 & 镜头
  if (a.composition?.shot_type) parts.push(a.composition.shot_type)
  if (a.composition?.depth_of_field) parts.push(a.composition.depth_of_field)
  if (a.camera?.lens) parts.push(a.camera.lens)
  if (a.camera?.bokeh) parts.push(a.camera.bokeh)
  // 色彩
  if (a.color?.grade) parts.push(a.color.grade)
  if (a.color?.palette) parts.push(`${a.color.palette}色调`)
  if (a.color?.temperature) parts.push(`${a.color.temperature}色温`)
  // 氛围（情绪 + 英文关键词直接进提示词）
  if (a.atmosphere?.mood) parts.push(a.atmosphere.mood)
  if (a.atmosphere?.keywords?.length)
    parts.push(a.atmosphere.keywords.filter(Boolean).join(', '))
  // 风格 & 后期
  if (a.style?.aesthetic) parts.push(a.style.aesthetic)
  if (a.post_processing?.style) parts.push(a.post_processing.style)
  if (a.post_processing?.effects) parts.push(a.post_processing.effects)
  if (a.style?.film_grain) parts.push('film grain, 胶片质感')
  return parts.filter(Boolean).join('，')
}

export default function PromptAnalysisNode({ id, data }: NodeProps) {
  const { T, theme } = useTheme()
  const { setNodes, setEdges, getNode } = useReactFlow()

  const analysis = ((data as any).analysis ?? EMPTY_ANALYSIS) as PromptAnalysis
  const reconstructedPrompt = ((data as any).reconstructedPrompt ?? '') as string

  const SETTING_LABELS: Record<string, string>      = { location: '地点', era: '时代', time_of_day: '时间' }
  const LIGHTING_LABELS: Record<string, string>     = { type: '光源', direction: '方向', tone: '色调', quality: '质感' }
  const COMPOSITION_LABELS: Record<string, string>  = { shot_type: '景别', angle: '角度', depth_of_field: '景深' }
  const COLOR_LABELS: Record<string, string>        = { palette: '主色调', grade: '分级', temperature: '色温' }
  const ATMOSPHERE_LABELS: Record<string, string>   = { mood: '情绪' }
  const CAMERA_LABELS: Record<string, string>       = { lens: '镜头', bokeh: '虚化' }
  const POST_LABELS: Record<string, string>         = { style: '后期', effects: '特效' }
  const STYLE_LABELS: Record<string, string>        = { aesthetic: '美学' }

  const [tab, setTab] = useState<'fields' | 'json'>('fields')
  const [jsonText, setJsonText] = useState(() => JSON.stringify(analysis, null, 2))
  const [jsonError, setJsonError] = useState('')

  const setAnalysis = useCallback((next: PromptAnalysis) => {
    const prompt = buildPrompt(next)
    setNodes(nds => nds.map(n =>
      n.id === id ? { ...n, data: { ...n.data, analysis: next, reconstructedPrompt: prompt } } : n
    ))
    setJsonText(JSON.stringify(next, null, 2))
  }, [id, setNodes])

  const handleFieldChange = (path: string, value: string) => {
    const next = JSON.parse(JSON.stringify(analysis)) as PromptAnalysis
    const keys = path.split('.')
    let obj: any = next
    for (let i = 0; i < keys.length - 1; i++) {
      const k = isNaN(Number(keys[i])) ? keys[i] : Number(keys[i])
      obj = obj[k]
    }
    obj[keys[keys.length - 1]] = value
    setAnalysis(next)
  }

  const handleJsonChange = (raw: string) => {
    setJsonText(raw)
    try {
      const parsed = JSON.parse(raw)
      setJsonError('')
      const prompt = buildPrompt(parsed)
      setNodes(nds => nds.map(n =>
        n.id === id ? { ...n, data: { ...n.data, analysis: parsed, reconstructedPrompt: prompt } } : n
      ))
    } catch {
      setJsonError('JSON 格式错误')
    }
  }

  const handleGenerate = useCallback(() => {
    const self = getNode(id)
    const x = (self?.position.x ?? 0) + 360
    const y = self?.position.y ?? 0
    const newId = `pagen_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
    setNodes(nds => [...nds, {
      id: newId,
      type: 'imageGen',
      position: { x, y },
      data: { name: '生图（拆解）', presetPrompt: reconstructedPrompt },
    }])
    setEdges(eds => [...eds, { id: `e_${id}_${newId}`, source: id, target: newId }])
  }, [id, reconstructedPrompt, getNode, setNodes, setEdges])

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '4px 8px', borderRadius: 5, fontSize: 11,
    background: T.inputBg, border: `1px solid ${T.border}`,
    color: T.text, outline: 'none', boxSizing: 'border-box',
  }

  const SectionTitle = ({ label }: { label: string }) => (
    <div style={{
      fontSize: 10, fontWeight: 600, color: T.accent, marginBottom: 5,
      textTransform: 'uppercase', letterSpacing: '0.07em',
    }}>{label}</div>
  )

  const FieldRow = ({ label, path, value, placeholder }: {
    label: string; path: string; value: string; placeholder?: string
  }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ fontSize: 10, color: T.textMuted, width: 36, flexShrink: 0 }}>{label}</span>
      <input
        value={value ?? ''}
        onChange={e => handleFieldChange(path, e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  )

  return (
    <div style={{
      width: 320, background: T.nodeBg, border: `1px solid ${T.border}`,
      borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      overflow: 'hidden',
    }}>
      <Handle type="target" position={Position.Left} style={{ top: 22 }} />
      <Handle type="source" position={Position.Right} style={{ top: 22 }} />

      {/* 头部 */}
      <div className="drag-handle" style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 12px', borderBottom: `1px solid ${T.border}`,
        background: `rgba(201,152,42,0.07)`, cursor: 'grab',
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: T.accent, padding: '1px 6px', borderRadius: 3,
          background: `rgba(201,152,42,0.12)`, border: `1px solid rgba(201,152,42,0.2)`,
          flexShrink: 0,
        }}>Prompt</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.text, flex: 1 }}>
          结构化提示词
        </span>
      </div>

      {/* Tab 切换 */}
      <div style={{
        display: 'flex', gap: 2, padding: '6px 10px',
        borderBottom: `1px solid ${T.border}`,
        background: T.nodeSubtle,
      }}>
        {(['fields', 'json'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
            background: tab === t
              ? (theme === 'dark' ? 'rgba(201,152,42,0.18)' : 'rgba(184,135,14,0.12)')
              : 'transparent',
            color: tab === t ? T.accent : T.textSub,
            fontWeight: tab === t ? 600 : 400,
            transition: 'all 0.15s',
          }}>
            {t === 'fields' ? '字段' : 'JSON'}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="nodrag" style={{ padding: '10px 12px', maxHeight: 420, overflowY: 'auto' }}>
        {tab === 'fields' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* 人物 */}
            <div>
              <SectionTitle label="人物" />
              {(analysis?.characters ?? []).map((c, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
                  <input value={c.description ?? ''} onChange={e => handleFieldChange(`characters.${i}.description`, e.target.value)} placeholder="外貌、服装、表情" style={inputStyle} />
                  <input value={c.position ?? ''} onChange={e => handleFieldChange(`characters.${i}.position`, e.target.value)} placeholder="位置" style={inputStyle} />
                </div>
              ))}
              {(!analysis?.characters?.length) && (
                <input value="" readOnly placeholder="无人物" style={{ ...inputStyle, opacity: 0.4 }} />
              )}
            </div>

            {/* 场景 */}
            <div>
              <SectionTitle label="场景" />
              {(['location', 'era', 'time_of_day'] as const).map(k => (
                <FieldRow key={k} label={SETTING_LABELS[k]} path={`setting.${k}`} value={analysis?.setting?.[k] ?? ''} />
              ))}
            </div>

            {/* 光线 */}
            <div>
              <SectionTitle label="光线" />
              {(['type', 'direction', 'tone', 'quality'] as const).map(k => (
                <FieldRow key={k} label={LIGHTING_LABELS[k]} path={`lighting.${k}`} value={analysis?.lighting?.[k] ?? ''} />
              ))}
            </div>

            {/* 构图 */}
            <div>
              <SectionTitle label="构图" />
              {(['shot_type', 'angle', 'depth_of_field'] as const).map(k => (
                <FieldRow key={k} label={COMPOSITION_LABELS[k]} path={`composition.${k}`} value={analysis?.composition?.[k] ?? ''} />
              ))}
            </div>

            {/* 镜头 */}
            <div>
              <SectionTitle label="镜头" />
              {(['lens', 'bokeh'] as const).map(k => (
                <FieldRow key={k} label={CAMERA_LABELS[k]} path={`camera.${k}`} value={analysis?.camera?.[k] ?? ''} />
              ))}
            </div>

            {/* 色彩 */}
            <div>
              <SectionTitle label="色彩" />
              {(['palette', 'grade', 'temperature'] as const).map(k => (
                <FieldRow key={k} label={COLOR_LABELS[k]} path={`color.${k}`} value={analysis?.color?.[k] ?? ''} />
              ))}
            </div>

            {/* 氛围 */}
            <div>
              <SectionTitle label="氛围" />
              <FieldRow label={ATMOSPHERE_LABELS['mood']} path="atmosphere.mood" value={analysis?.atmosphere?.mood ?? ''} placeholder="如：孤独忧郁、温暖治愈" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: T.textMuted, width: 36, flexShrink: 0 }}>关键词</span>
                <input
                  value={(analysis?.atmosphere?.keywords ?? []).join(', ')}
                  onChange={e => {
                    const next = JSON.parse(JSON.stringify(analysis)) as PromptAnalysis
                    next.atmosphere = next.atmosphere ?? { mood: '', keywords: [] }
                    next.atmosphere.keywords = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    setAnalysis(next)
                  }}
                  placeholder="cinematic, ethereal, moody"
                  style={inputStyle}
                />
              </div>
            </div>

            {/* 后期 */}
            <div>
              <SectionTitle label="后期" />
              {(['style', 'effects'] as const).map(k => (
                <FieldRow key={k} label={POST_LABELS[k]} path={`post_processing.${k}`} value={analysis?.post_processing?.[k] ?? ''} />
              ))}
            </div>

            {/* 风格 */}
            <div>
              <SectionTitle label="美学" />
              <FieldRow label={STYLE_LABELS['aesthetic']} path="style.aesthetic" value={analysis?.style?.aesthetic ?? ''} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <input type="checkbox" id={`fg_${id}`} checked={!!analysis?.style?.film_grain}
                  onChange={e => {
                    const next = JSON.parse(JSON.stringify(analysis)) as PromptAnalysis
                    next.style.film_grain = e.target.checked
                    setAnalysis(next)
                  }} />
                <label htmlFor={`fg_${id}`} style={{ fontSize: 11, color: T.textSub, cursor: 'pointer' }}>胶片质感</label>
              </div>
            </div>

          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <textarea
              value={jsonText}
              onChange={e => handleJsonChange(e.target.value)}
              style={{
                width: '100%', minHeight: 280, padding: '8px', borderRadius: 6, fontSize: 10,
                lineHeight: 1.7, fontFamily: 'monospace',
                background: T.inputBg, border: `1px solid ${jsonError ? 'rgba(255,80,60,0.5)' : T.border}`,
                color: T.text, outline: 'none', resize: 'vertical', boxSizing: 'border-box',
              }}
            />
            {jsonError && <span style={{ fontSize: 10, color: 'rgba(255,80,60,0.8)' }}>{jsonError}</span>}
          </div>
        )}
      </div>

      {/* 重组提示词预览 */}
      <div style={{ padding: '6px 12px', borderTop: `1px solid ${T.border}`, background: T.nodeSubtle }}>
        <div style={{ fontSize: 9, color: T.textMuted, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>重组提示词</div>
        <div style={{ fontSize: 10, color: T.textSub, lineHeight: 1.5 }}>
          {reconstructedPrompt || '—'}
        </div>
      </div>

      {/* 底部操作 */}
      <div style={{ padding: '8px 12px', borderTop: `1px solid ${T.border}` }}>
        <button onClick={handleGenerate} style={{
          width: '100%', padding: '8px', borderRadius: 8, fontSize: 12, fontWeight: 600,
          background: T.accent, color: theme === 'dark' ? '#0D0B08' : '#fff',
          border: 'none', cursor: 'pointer',
          boxShadow: `0 3px 12px rgba(201,152,42,0.3)`,
          transition: 'opacity 0.15s',
        }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          用此结构生图 →
        </button>
      </div>
    </div>
  )
}
