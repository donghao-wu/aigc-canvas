import type { ReactNode } from 'react'
import { Boxes, FileText, Home, Image, Moon, Sun } from 'lucide-react'
import { useTheme } from './ThemeContext'

export type StudioSection = 'script' | 'canvas' | 'assets'

interface StudioHeaderProps {
  projectName: string
  active: StudioSection
  onHome: () => void
  onSwitchToScript?: () => void
  onSwitchToCanvas?: () => void
  onSwitchToAssets?: () => void
  status?: ReactNode
  actions?: ReactNode
  floating?: boolean
}

const tabs: Array<{
  key: StudioSection
  label: string
  icon: typeof FileText
}> = [
  { key: 'script', label: '剧本', icon: FileText },
  { key: 'canvas', label: '生图', icon: Image },
  { key: 'assets', label: '资产库', icon: Boxes },
]

export default function StudioHeader({
  projectName,
  active,
  onHome,
  onSwitchToScript,
  onSwitchToCanvas,
  onSwitchToAssets,
  status,
  actions,
  floating = false,
}: StudioHeaderProps) {
  const { theme, T, toggle } = useTheme()

  const switchers: Record<StudioSection, (() => void) | undefined> = {
    script: onSwitchToScript,
    canvas: onSwitchToCanvas,
    assets: onSwitchToAssets,
  }

  const chromeBg = theme === 'dark'
    ? 'linear-gradient(135deg, rgba(12,13,16,0.96), rgba(22,18,12,0.92))'
    : 'linear-gradient(135deg, rgba(255,253,246,0.96), rgba(244,239,226,0.94))'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minHeight: 52,
        padding: floating ? '8px 10px' : '8px 18px',
        background: chromeBg,
        border: `1px solid ${floating ? T.borderMid : T.border}`,
        borderLeft: floating ? `1px solid ${T.borderMid}` : 'none',
        borderRight: floating ? `1px solid ${T.borderMid}` : 'none',
        borderTop: floating ? `1px solid ${T.borderMid}` : 'none',
        borderBottom: `1px solid ${T.border}`,
        borderRadius: floating ? 14 : 0,
        boxShadow: floating
          ? (theme === 'dark' ? '0 18px 50px rgba(0,0,0,0.42)' : '0 16px 38px rgba(75,57,24,0.14)')
          : (theme === 'dark' ? '0 12px 40px rgba(0,0,0,0.22)' : '0 10px 28px rgba(75,57,24,0.08)'),
        backdropFilter: 'blur(26px)',
        flexShrink: 0,
        zIndex: 20,
      }}
    >
      <button
        onClick={onHome}
        title="返回项目首页"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 6px',
          borderRadius: 10,
          color: T.text,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = T.nodeSubtle)}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <div style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: 'rgba(201,152,42,0.14)',
          border: '1px solid rgba(201,152,42,0.26)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
        }}>
          <img src="/logo.svg" alt="" style={{ width: 16, height: 16 }} />
        </div>
        <div style={{ display: floating ? 'none' : 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, lineHeight: 1.1 }}>壹镜 Studio</span>
          <span style={{ fontSize: 10, color: T.textMuted, lineHeight: 1.3 }}>Production Console</span>
        </div>
        {floating && <Home size={15} />}
      </button>

      <div style={{ width: 1, alignSelf: 'stretch', minHeight: 24, background: T.border }} />

      <div style={{ minWidth: floating ? 92 : 160, maxWidth: floating ? 140 : 260, overflow: 'hidden' }}>
        <div style={{
          fontSize: 10,
          color: T.textMuted,
          lineHeight: 1.3,
          textTransform: 'uppercase',
        }}>
          Current Project
        </div>
        <div style={{
          fontSize: 13,
          fontWeight: 700,
          color: T.text,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {projectName}
        </div>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: theme === 'dark' ? 'rgba(255,255,255,0.045)' : 'rgba(64,46,18,0.045)',
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: 4,
      }}>
        {tabs.map(tab => {
          const Icon = tab.icon
          const isActive = active === tab.key
          const onClick = isActive ? undefined : switchers[tab.key]
          return (
            <button
              key={tab.key}
              onClick={onClick}
              disabled={!onClick && !isActive}
              title={tab.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                minHeight: 30,
                padding: floating ? '6px 9px' : '6px 12px',
                borderRadius: 9,
                border: 'none',
                cursor: onClick ? 'pointer' : 'default',
                background: isActive
                  ? (theme === 'dark' ? 'rgba(201,152,42,0.18)' : 'rgba(184,135,14,0.13)')
                  : 'transparent',
                color: isActive ? T.accent : T.textSub,
                fontSize: 12,
                fontWeight: isActive ? 700 : 600,
                whiteSpace: 'nowrap',
                boxShadow: isActive ? 'inset 0 1px 0 rgba(255,255,255,0.08)' : 'none',
                opacity: !onClick && !isActive ? 0.55 : 1,
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = T.text }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = T.textSub }}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1 }} />

      {status && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          color: T.textSub,
        }}>
          {status}
        </div>
      )}

      {actions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {actions}
        </div>
      )}

      <button
        onClick={toggle}
        title={theme === 'dark' ? '切换浅色' : '切换深色'}
        style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 10,
          border: `1px solid ${T.border}`,
          background: theme === 'dark' ? 'rgba(255,255,255,0.045)' : 'rgba(64,46,18,0.045)',
          color: T.textSub,
          cursor: 'pointer',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.borderMid }}
        onMouseLeave={e => { e.currentTarget.style.color = T.textSub; e.currentTarget.style.borderColor = T.border }}
      >
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>
    </div>
  )
}
