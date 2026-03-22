import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import { useTheme } from './ThemeContext'

interface GalleryItem {
  id: string
  url: string
  prompt: string
  model: string
  refCount: number
  createdAt: number
}

const MODEL_SHORT: Record<string, string> = {
  'gemini-3-pro-image-preview':     'Pro',
  'gemini-3.1-flash-image-preview': 'Flash',
  'gemini-2.5-flash-image':         'NB',
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)    return `${s}秒前`
  if (s < 3600)  return `${Math.floor(s / 60)}分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`
  return `${Math.floor(s / 86400)}天前`
}

export default function Gallery({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { T, theme } = useTheme()
  const [items, setItems]       = useState<GalleryItem[]>([])
  const [loading, setLoading]   = useState(false)
  const [lightbox, setLightbox] = useState<GalleryItem | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get<GalleryItem[]>('/api/gallery')
      setItems(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (visible) load()
  }, [visible, load])

  useEffect(() => {
    const handler = () => load()
    window.addEventListener('gallery-refresh', handler)
    return () => window.removeEventListener('gallery-refresh', handler)
  }, [load])

  const deleteItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await axios.delete(`/api/gallery/${id}`)
    setItems(prev => prev.filter(i => i.id !== id))
    if (lightbox?.id === id) setLightbox(null)
  }

  const download = (item: GalleryItem, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const a = document.createElement('a')
    a.href = item.url
    a.download = `aigc-${item.id}.jpg`
    a.target = '_blank'
    a.click()
  }

  if (!visible) return null

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-30"
        style={{ background: theme === 'dark' ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.2)' }}
        onClick={onClose}
      />

      {/* 面板 */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 z-40 flex flex-col"
        style={{
          width: 300,
          background: T.menuBg,
          borderLeft: `1px solid ${T.border}`,
          boxShadow: theme === 'dark'
            ? '-8px 0 32px rgba(0,0,0,0.6)'
            : '-8px 0 32px rgba(0,0,0,0.1)',
        }}
      >
        {/* 头部 */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: `1px solid ${T.border}` }}
        >
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>图片库</span>
            {items.length > 0 && (
              <span
                style={{
                  fontSize: 11, padding: '1px 6px', borderRadius: 10,
                  background: 'rgba(16,185,129,0.12)',
                  color: '#10b981',
                }}
              >
                {items.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              style={{ fontSize: 13, color: T.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
            >↻</button>
            <button
              onClick={onClose}
              style={{ fontSize: 16, lineHeight: 1, color: T.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}
            >✕</button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: 'thin' }}>
          {loading && items.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 128, color: T.textMuted, fontSize: 13 }}>
              加载中...
            </div>
          )}

          {!loading && items.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 192, gap: 8, color: T.textMuted }}>
              <span style={{ fontSize: 13 }}>还没有生成过图片</span>
            </div>
          )}

          {/* 2列网格 */}
          <div className="grid grid-cols-2 gap-2">
            {items.map(item => (
              <div
                key={item.id}
                onClick={() => setLightbox(item)}
                className="group relative rounded-xl overflow-hidden cursor-pointer transition-transform hover:scale-[1.02]"
                style={{
                  background: T.nodeBg,
                  border: `1px solid ${T.border}`,
                  aspectRatio: '1 / 1',
                }}
              >
                <img
                  src={item.url}
                  alt={item.prompt}
                  className="w-full h-full"
                  style={{ objectFit: 'cover' }}
                  loading="lazy"
                />

                {/* hover 遮罩（叠在图片上，保持深色渐变） */}
                <div
                  className="absolute inset-0 flex flex-col justify-between p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.7) 100%)' }}
                >
                  <div className="flex justify-end">
                    <button
                      onClick={e => deleteItem(item.id, e)}
                      style={{
                        width: 20, height: 20, borderRadius: '50%',
                        background: 'rgba(239,68,68,0.85)',
                        color: '#fff', fontSize: 10,
                        border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >✕</button>
                  </div>

                  <div className="flex items-end justify-between gap-1">
                    <span
                      style={{
                        fontSize: 11, padding: '2px 6px', borderRadius: 4, fontWeight: 500,
                        background: 'rgba(16,185,129,0.75)', color: '#fff', maxWidth: 70,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {MODEL_SHORT[item.model] ?? item.model.split('-')[0]}
                      {item.refCount > 0 ? ` +${item.refCount}` : ''}
                    </span>
                    <button
                      onClick={e => download(item, e)}
                      style={{
                        width: 22, height: 22, borderRadius: 4,
                        background: 'rgba(255,255,255,0.2)',
                        color: '#fff', fontSize: 12,
                        border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >↓</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative flex flex-col rounded-2xl overflow-hidden"
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              background: T.menuBg,
              border: `1px solid ${T.border}`,
              boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <img
              src={lightbox.url}
              alt={lightbox.prompt}
              style={{ maxWidth: '85vw', maxHeight: '75vh', objectFit: 'contain', display: 'block' }}
            />

            <div
              className="flex items-center justify-between gap-3 px-4 py-3"
              style={{ borderTop: `1px solid ${T.border}` }}
            >
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span style={{ fontSize: 12, color: T.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lightbox.prompt}</span>
                <span style={{ fontSize: 11, color: T.textMuted }}>{timeAgo(lightbox.createdAt)}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={e => deleteItem(lightbox.id, e)}
                  style={{
                    padding: '5px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                    background: 'rgba(239,68,68,0.1)', color: '#fca5a5',
                    border: '1px solid rgba(239,68,68,0.2)',
                  }}
                >删除</button>
                <button
                  onClick={() => download(lightbox)}
                  style={{
                    padding: '5px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                    background: 'rgba(16,185,129,0.1)', color: '#6ee7b7',
                    border: '1px solid rgba(16,185,129,0.2)',
                  }}
                >↓ 下载</button>
                <button
                  onClick={() => setLightbox(null)}
                  style={{ fontSize: 18, lineHeight: 1, color: T.textMuted, background: 'none', border: 'none', cursor: 'pointer', marginLeft: 4 }}
                >✕</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
