/**
 * Shared SSE streaming helper.
 * Reads a server-sent event stream from a fetch Response and calls handlers for
 * each text chunk and on completion.
 */
export async function streamSSE(
  response: Response,
  onChunk: (text: string) => void,
  onDone: () => void,
): Promise<void> {
  if (!response.body) throw new Error('No response body')
  const reader  = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data.trim() === '[DONE]') { onDone(); return }
      try {
        const p = JSON.parse(data)
        if (p.error) throw new Error(p.error)
        if (p.text) onChunk(p.text)
      } catch (err) {
        if (err instanceof Error && err.message !== 'Unexpected end of JSON input') throw err
      }
    }
  }
  onDone()
}
