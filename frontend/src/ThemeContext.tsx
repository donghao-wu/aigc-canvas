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
  accent:       string
}

const dark: ThemeTokens = {
  canvasBg:   '#0D0B08',
  nodeBg:     '#181410',
  nodeSubtle: 'rgba(255,255,255,0.04)',
  border:     'rgba(255,255,255,0.08)',
  borderMid:  'rgba(255,255,255,0.14)',
  text:       'rgba(255,248,230,0.9)',
  textSub:    'rgba(255,236,200,0.44)',
  textMuted:  'rgba(255,225,170,0.24)',
  inputBg:    'rgba(255,255,255,0.055)',
  btnBg:      '#C9982A',
  btnText:    '#0D0B08',
  headerBg:   'rgba(13,11,8,0.92)',
  menuBg:     'rgba(20,16,10,0.97)',
  accent:     '#C9982A',
}

const light: ThemeTokens = {
  canvasBg:   '#EDE8DC',
  nodeBg:     '#FEFCF5',
  nodeSubtle: 'rgba(80,60,20,0.05)',
  border:     'rgba(80,60,20,0.1)',
  borderMid:  'rgba(80,60,20,0.18)',
  text:       'rgba(22,16,6,0.88)',
  textSub:    'rgba(40,28,8,0.5)',
  textMuted:  'rgba(40,28,8,0.3)',
  inputBg:    'rgba(80,60,20,0.05)',
  btnBg:      '#B8870E',
  btnText:    '#fff',
  headerBg:   'rgba(237,232,220,0.93)',
  menuBg:     'rgba(254,252,245,0.97)',
  accent:     '#B8870E',
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
