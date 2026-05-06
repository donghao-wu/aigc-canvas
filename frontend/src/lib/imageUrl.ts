/**
 * authImageUrl — 给本地生成图片的 URL 追加 ?token=... 认证参数。
 *
 * - 本地路径（/generated/... 或 /uploads/...）必须带 token，否则后端会返回 401。
 * - OSS 或其他 https:// 链接不需要 token，直接返回原 URL。
 * - 已包含 token 的 URL 不重复追加。
 */
export function authImageUrl(url: string | null | undefined): string {
  if (!url) return ''
  // OSS / 外部 URL 不需要处理
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  // 已包含 token
  if (url.includes('?token=') || url.includes('&token=')) return url
  const token = localStorage.getItem('auth_token')
  if (!token) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(token)}`
}
