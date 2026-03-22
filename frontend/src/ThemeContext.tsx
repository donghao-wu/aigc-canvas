import { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

export interface ThemeTokens {
  canvasBg:     string
  nodeBg:       string
  nodeSubtle:   string
  border:       string
  borderMid:    string
  text:         string
  textSub:      string
  textMuted:    string
  inputBg:      string
  btnBg:        string
  btnText:      string
  headerBg:     string
  menuBg:       string
}

const dark: ThemeTokens = {
  canvasBg:   '#000',
  nodeBg:     '#111',
  nodeSubtle: 'rgba(255,255,255,0.04)',
  border:     'rgba(255,255,255,0.09)',
  borderMid:  'rgba(255,255,255,0.15)',
  text:       'rgba(255,255,255,0.82)',
  textSub:    'rgba(255,255,255,0.38)',
  textMuted:  'rgba(255,255,255,0.2)',
  inputBg:    'rgba(255,255,255,0.05)',
  btnBg:      'rgba(255,255,255,0.9)',
  btnText:    '#000',
  headerBg:   'rgba(0,0,0,0.88)',
  menuBg:     'rgba(20,20,20,0.96)',
}

const light: ThemeTokens = {
  canvasBg:   '#f0ece3',   // 温暖米黄
  nodeBg:     '#ffffff',
  nodeSubtle: 'rgba(0,0,0,0.03)',
  border:     'rgba(0,0,0,0.09)',
  borderMid:  'rgba(0,0,0,0.16)',
  text:       'rgba(0,0,0,0.82)',
  textSub:    'rgba(0,0,0,0.42)',
  textMuted:  'rgba(0,0,0,0.26)',
  inputBg:    'rgba(0,0,0,0.04)',
  btnBg:      'rgba(0,0,0,0.85)',
  btnText:    '#fff',
  headerBg:   'rgba(242,242,244,0.92)',
  menuBg:     'rgba(255,255,255,0.97)',
}

interface ThemeCtx {
  theme:  Theme
  T:      ThemeTokens
  toggle: () => void
}

const Ctx = createContext<ThemeCtx>({ theme: 'dark', T: dark, toggle: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem('theme') as Theme) || 'dark'
  )
  const T = theme === 'dark' ? dark : light

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.body.style.background = T.canvasBg
    localStorage.setItem('theme', theme)
  }, [theme, T.canvasBg])

  return (
    <Ctx.Provider value={{ theme, T, toggle: () => setTheme(t => t === 'dark' ? 'light' : 'dark') }}>
      {children}
    </Ctx.Provider>
  )
}

export const useTheme = () => useContext(Ctx)
