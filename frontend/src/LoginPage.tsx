import { useState } from 'react'
import axios from 'axios'
import { useTheme } from './ThemeContext'

interface Props {
  onLogin: (token: string, username: string) => void
}

export default function LoginPage({ onLogin }: Props) {
  const { T } = useTheme()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

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

  return (
    <div style={{
      minHeight: '100vh', background: T.canvasBg, color: T.text,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 360, padding: '40px 36px', borderRadius: 16,
        background: T.nodeBg, border: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', gap: 24,
      }}>
        {/* Logo / Title */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: T.text }}>Studio</span>
          <span style={{ fontSize: 13, color: T.textSub }}>登录以继续</span>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: T.textSub }}>用户名</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              style={{
                padding: '10px 12px', borderRadius: 8, fontSize: 14,
                background: T.inputBg, border: `1px solid ${T.borderMid}`,
                color: T.text, outline: 'none', width: '100%', boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: T.textSub }}>密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              style={{
                padding: '10px 12px', borderRadius: 8, fontSize: 14,
                background: T.inputBg, border: `1px solid ${T.borderMid}`,
                color: T.text, outline: 'none', width: '100%', boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <span style={{ fontSize: 12, color: 'rgba(255,69,58,0.9)' }}>{error}</span>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            style={{
              marginTop: 4, padding: '11px', borderRadius: 8, fontSize: 14, fontWeight: 500,
              background: T.btnBg, color: T.btnText, border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: (!username || !password) ? 0.5 : 1,
              transition: 'opacity 0.15s',
            }}
          >{loading ? '登录中...' : '登录'}</button>
        </form>
      </div>
    </div>
  )
}
