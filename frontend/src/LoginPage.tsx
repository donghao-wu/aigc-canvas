import { useState } from 'react'
import axios from 'axios'

interface Props {
  onLogin: (token: string, username: string) => void
}

export default function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [pwFocus, setPwFocus]   = useState(false)
  const [unFocus, setUnFocus]   = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await axios.post('/api/auth/login', { username, password })
      onLogin(data.token, data.username)
    } catch (err: any) {
      setError(err.response?.data?.error || '登录失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = (focused: boolean): React.CSSProperties => ({
    padding: '12px 16px',
    borderRadius: 10,
    fontSize: 15,
    background: focused ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${focused ? 'rgba(201,152,42,0.5)' : 'rgba(255,255,255,0.1)'}`,
    color: 'rgba(255,248,230,0.9)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s, background 0.2s',
    boxShadow: focused ? '0 0 0 3px rgba(201,152,42,0.1)' : 'none',
  })

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0D0B08',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* Radial spotlight */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse 60% 50% at 50% 45%, rgba(201,152,42,0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Dot grid */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'radial-gradient(circle, rgba(255,236,170,0.07) 1px, transparent 1px)',
        backgroundSize: '36px 36px',
        pointerEvents: 'none',
      }} />

      {/* Vignette */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(0,0,0,0.6) 100%)',
        pointerEvents: 'none',
      }} />

      {/* Card */}
      <div
        className="animate-fadeInScale"
        style={{
          position: 'relative',
          width: 380,
          padding: '44px 40px',
          borderRadius: 20,
          background: 'rgba(24,20,16,0.88)',
          border: '1px solid rgba(255,255,255,0.09)',
          backdropFilter: 'blur(32px)',
          boxShadow: '0 40px 100px rgba(0,0,0,0.7), 0 0 0 1px rgba(201,152,42,0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
        }}
      >
        {/* Brand */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 60, height: 60,
            borderRadius: 16,
            background: 'rgba(201,152,42,0.1)',
            border: '1px solid rgba(201,152,42,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 2,
          }}>
            <img src="/logo.svg" style={{ width: 36, height: 36 }} />
          </div>
          <div style={{
            fontSize: 26, fontWeight: 700,
            color: 'rgba(255,248,230,0.92)',
            letterSpacing: '-0.02em',
          }}>壹镜</div>
          <div style={{
            fontSize: 12, color: 'rgba(255,220,140,0.38)',
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>AI 影像创作平台</div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label style={{
              fontSize: 11, color: 'rgba(255,220,140,0.45)',
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>用户名</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              onFocus={() => setUnFocus(true)}
              onBlur={() => setUnFocus(false)}
              autoFocus
              autoComplete="username"
              style={inputStyle(unFocus)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label style={{
              fontSize: 11, color: 'rgba(255,220,140,0.45)',
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onFocus={() => setPwFocus(true)}
              onBlur={() => setPwFocus(false)}
              autoComplete="current-password"
              style={inputStyle(pwFocus)}
            />
          </div>

          {error && (
            <div style={{
              fontSize: 12, color: '#FF8080',
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(255,80,80,0.08)',
              border: '1px solid rgba(255,80,80,0.15)',
            }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            style={{
              marginTop: 6,
              padding: '13px',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              background: (!username || !password) ? 'rgba(201,152,42,0.3)' : '#C9982A',
              color: (!username || !password) ? 'rgba(13,11,8,0.5)' : '#0D0B08',
              border: 'none',
              cursor: (!username || !password || loading) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              letterSpacing: '0.02em',
              boxShadow: (!username || !password) ? 'none' : '0 4px 20px rgba(201,152,42,0.3)',
            }}
            onMouseEnter={e => {
              if (username && password && !loading)
                (e.currentTarget.style.transform = 'translateY(-1px)')
            }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
          >
            {loading ? '登录中...' : '进入'}
          </button>
        </form>
      </div>
    </div>
  )
}
