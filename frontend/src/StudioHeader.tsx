import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { Boxes, FileText, Home, Image, Moon, Sun, UserPlus, Users, X } from 'lucide-react'
import { useTheme } from './ThemeContext'

export type StudioSection = 'script' | 'canvas' | 'assets'

interface Member {
  userId: string
  username: string
  role: 'owner' | 'editor' | 'viewer'
}

interface StudioHeaderProps {
  projectName: string
  active: StudioSection
  projectId?: string          // enables member management when provided
  onHome: () => void
  onSwitchToScript?: () => void
  onSwitchToCanvas?: () => void
  onSwitchToAssets?: () => void
  status?: ReactNode
  actions?: ReactNode
  floating?: boolean
}

const tabs: Array<{ key: StudioSection; label: string; icon: typeof FileText }> = [
  { key: 'script', label: '剧本',  icon: FileText },
  { key: 'canvas', label: '生图',  icon: Image   },
  { key: 'assets', label: '资产库', icon: Boxes   },
]

function authHeaders() {
  const token = localStorage.getItem('auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export default function StudioHeader({
  projectName,
  active,
  projectId,
  onHome,
  onSwitchToScript,
  onSwitchToCanvas,
  onSwitchToAssets,
  status,
  actions,
  floating = false,
}: StudioHeaderProps) {
  const { theme, T, toggle } = useTheme()

  // ── 成员面板 ──────────────────────────────────────────────────
  const [showMembers, setShowMembers]   = useState(false)
  const [members,     setMembers]       = useState<Member[]>([])
  const [inviteUser,  setInviteUser]    = useState('')
  const [inviting,    setInviting]      = useState(false)
  const [inviteError, setInviteError]   = useState('')
  const [removing,    setRemoving]      = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const currentUsername = localStorage.getItem('auth_username') || ''

  const fetchMembers = useCallback(async () => {
    if (!projectId) return
    try {
      const { data } = await axios.get<Member[]>(`/api/projects/${projectId}/members`, { headers: authHeaders() })
      setMembers(data)
    } catch {
      setMembers([])
    }
  }, [projectId])

  // 打开面板时拉一次成员列表
  useEffect(() => {
    if (showMembers) fetchMembers()
  }, [showMembers, fetchMembers])

  // 点外部关闭面板
  useEffect(() => {
    if (!showMembers) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowMembers(false)
        setInviteError('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMembers])

  const handleInvite = async () => {
    const username = inviteUser.trim()
    if (!username || !projectId) return
    setInviting(true)
    setInviteError('')
    try {
      await axios.post(
        `/api/projects/${projectId}/members`,
        { username, role: 'editor' },
        { headers: authHeaders() },
      )
      setInviteUser('')
      fetchMembers()
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? '邀请失败') : '邀请失败'
      setInviteError(String(msg))
    } finally {
      setInviting(false)
    }
  }

  const handleRemove = async (userId: string) => {
    if (!projectId) return
    setRemoving(userId)
    try {
      await axios.delete(`/api/projects/${projectId}/members/${userId}`, { headers: authHeaders() })
      fetchMembers()
    } catch {}
    setRemoving(null)
  }

  // ── 样式常量 ──────────────────────────────────────────────────
  const switchers: Record<StudioSection, (() => void) | undefined> = {
    script: onSwitchToScript,
    canvas: onSwitchToCanvas,
    assets: onSwitchToAssets,
  }

  const chromeBg = theme === 'dark'
    ? 'linear-gradient(135deg, rgba(12,13,16,0.96), rgba(22,18,12,0.92))'
    : 'linear-gradient(135deg, rgba(255,253,246,0.96), rgba(244,239,226,0.94))'

  const ROLE_LABEL: Record<string, string> = { owner: '所有者', editor: '编辑', viewer: '只读' }

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          minHeight: 52,
          padding: floating ? '8px 10px' : '8px 18px',
          background: chromeBg,
          border: `1px solid ${floating ? T.borderMid : T.border}`,
          borderLeft:   floating ? `1px solid ${T.borderMid}` : 'none',
          borderRight:  floating ? `1px solid ${T.borderMid}` : 'none',
          borderTop:    floating ? `1px solid ${T.borderMid}` : 'none',
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
        {/* 返回首页 */}
        <button
          onClick={onHome}
          title="返回项目首页"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            minWidth: 0, background: 'transparent', border: 'none',
            cursor: 'pointer', padding: '4px 6px', borderRadius: 10, color: T.text,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = T.nodeSubtle)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'rgba(201,152,42,0.14)',
            border: '1px solid rgba(201,152,42,0.26)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
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

        {/* 项目名 */}
        <div style={{ minWidth: floating ? 92 : 160, maxWidth: floating ? 140 : 260, overflow: 'hidden' }}>
          <div style={{ fontSize: 10, color: T.textMuted, lineHeight: 1.3, textTransform: 'uppercase' }}>
            Current Project
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {projectName}
          </div>
        </div>

        {/* 模块切换 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: theme === 'dark' ? 'rgba(255,255,255,0.045)' : 'rgba(64,46,18,0.045)',
          border: `1px solid ${T.border}`,
          borderRadius: 12, padding: 4,
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
                  display: 'flex', alignItems: 'center', gap: 6,
                  minHeight: 30,
                  padding: floating ? '6px 9px' : '6px 12px',
                  borderRadius: 9, border: 'none',
                  cursor: onClick ? 'pointer' : 'default',
                  background: isActive
                    ? (theme === 'dark' ? 'rgba(201,152,42,0.18)' : 'rgba(184,135,14,0.13)')
                    : 'transparent',
                  color: isActive ? T.accent : T.textSub,
                  fontSize: 12, fontWeight: isActive ? 700 : 600,
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

        {/* 状态区 */}
        {status && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, color: T.textSub }}>
            {status}
          </div>
        )}

        {/* 自定义 actions */}
        {actions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {actions}
          </div>
        )}

        {/* 成员管理按钮（仅在有 projectId 时显示）*/}
        {projectId && (
          <button
            onClick={() => setShowMembers(v => !v)}
            title="项目成员"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              height: 32, padding: '0 10px',
              borderRadius: 10, border: `1px solid ${showMembers ? T.borderMid : T.border}`,
              background: showMembers
                ? (theme === 'dark' ? 'rgba(201,152,42,0.12)' : 'rgba(184,135,14,0.08)')
                : (theme === 'dark' ? 'rgba(255,255,255,0.045)' : 'rgba(64,46,18,0.045)'),
              color: showMembers ? T.accent : T.textSub,
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}
            onMouseEnter={e => { if (!showMembers) { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.borderMid } }}
            onMouseLeave={e => { if (!showMembers) { e.currentTarget.style.color = T.textSub; e.currentTarget.style.borderColor = T.border } }}
          >
            <Users size={14} />
            {!floating && <span>{members.length > 0 ? `${members.length}` : '成员'}</span>}
          </button>
        )}

        {/* 主题切换 */}
        <button
          onClick={toggle}
          title={theme === 'dark' ? '切换浅色' : '切换深色'}
          style={{
            width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 10, border: `1px solid ${T.border}`,
            background: theme === 'dark' ? 'rgba(255,255,255,0.045)' : 'rgba(64,46,18,0.045)',
            color: T.textSub, cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.borderMid }}
          onMouseLeave={e => { e.currentTarget.style.color = T.textSub; e.currentTarget.style.borderColor = T.border }}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      {/* ── 成员管理下拉面板 ───────────────────────────────────── */}
      {showMembers && projectId && (
        <div
          ref={panelRef}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            zIndex: 200,
            marginTop: 6,
            width: 300,
            background: theme === 'dark' ? 'rgba(18,20,24,0.97)' : 'rgba(255,252,245,0.97)',
            border: `1px solid ${T.borderMid}`,
            borderRadius: 14,
            boxShadow: theme === 'dark'
              ? '0 20px 60px rgba(0,0,0,0.55)'
              : '0 16px 44px rgba(75,57,24,0.2)',
            backdropFilter: 'blur(24px)',
            overflow: 'hidden',
          }}
        >
          {/* 面板头 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px 10px',
            borderBottom: `1px solid ${T.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Users size={13} color={T.accent} />
              <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>项目成员</span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 5,
                background: 'rgba(201,152,42,0.14)', color: T.accent,
              }}>{members.length}</span>
            </div>
            <button
              onClick={() => setShowMembers(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, padding: 2, borderRadius: 6 }}
              onMouseEnter={e => (e.currentTarget.style.color = T.text)}
              onMouseLeave={e => (e.currentTarget.style.color = T.textMuted)}
            >
              <X size={14} />
            </button>
          </div>

          {/* 成员列表 */}
          <div style={{ maxHeight: 200, overflowY: 'auto', padding: '8px 0' }}>
            {members.length === 0 ? (
              <div style={{ padding: '14px 14px', fontSize: 12, color: T.textMuted, textAlign: 'center' }}>
                加载中…
              </div>
            ) : members.map(m => (
              <div
                key={m.userId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  padding: '6px 14px',
                }}
              >
                {/* 头像 */}
                <div style={{
                  width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                  background: m.role === 'owner' ? 'rgba(201,152,42,0.18)' : 'rgba(255,255,255,0.07)',
                  border: `1px solid ${m.role === 'owner' ? 'rgba(201,152,42,0.3)' : T.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: m.role === 'owner' ? T.accent : T.textSub,
                }}>
                  {m.username.slice(0, 1).toUpperCase()}
                </div>
                {/* 名字 + 角色 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: T.text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {m.username}
                    {m.username === currentUsername && (
                      <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 5 }}>(你)</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: T.textMuted }}>{ROLE_LABEL[m.role] || m.role}</div>
                </div>
                {/* 移除按钮（非所有者 + 非自己）*/}
                {m.role !== 'owner' && m.username !== currentUsername && (
                  <button
                    onClick={() => handleRemove(m.userId)}
                    disabled={removing === m.userId}
                    title="移除成员"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: T.textMuted, padding: 4, borderRadius: 6,
                      opacity: removing === m.userId ? 0.4 : 1,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                    onMouseLeave={e => (e.currentTarget.style.color = T.textMuted)}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* 邀请区 */}
          <div style={{ padding: '10px 14px 14px', borderTop: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 7, display: 'flex', alignItems: 'center', gap: 5 }}>
              <UserPlus size={11} />
              邀请成员（编辑权限）
            </div>
            <div style={{ display: 'flex', gap: 7 }}>
              <input
                value={inviteUser}
                onChange={e => { setInviteUser(e.target.value); setInviteError('') }}
                onKeyDown={e => { if (e.key === 'Enter') handleInvite() }}
                placeholder="输入用户名"
                style={{
                  flex: 1, minWidth: 0,
                  background: T.inputBg, border: `1px solid ${inviteError ? 'rgba(248,113,113,0.5)' : T.border}`,
                  borderRadius: 8, padding: '6px 9px',
                  fontSize: 12, color: T.text, outline: 'none',
                }}
              />
              <button
                onClick={handleInvite}
                disabled={!inviteUser.trim() || inviting}
                style={{
                  padding: '6px 12px', borderRadius: 8, border: 'none',
                  background: !inviteUser.trim() || inviting ? 'rgba(201,152,42,0.2)' : T.accent,
                  color: !inviteUser.trim() || inviting ? T.textMuted : '#0D0B08',
                  fontSize: 12, fontWeight: 700,
                  cursor: !inviteUser.trim() || inviting ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {inviting ? '…' : '邀请'}
              </button>
            </div>
            {inviteError && (
              <div style={{ fontSize: 11, color: '#f87171', marginTop: 5 }}>{inviteError}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
