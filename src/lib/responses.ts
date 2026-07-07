export async function readResponseStream(response: Response, onDelta: (delta: string) => void) {
  if (!response.body) throw new Error('响应流为空')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace(/^data:\s?/, ''))
        .join('\n')

      if (!data || data === '[DONE]') continue

      try {
        const payload = JSON.parse(data)
        const delta = extractStreamDelta(payload)
        if (delta) onDelta(delta)
      } catch {
        // Ignore non-JSON event frames.
      }
    }
  }
}

export function extractStreamDelta(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''
  if ('delta' in payload && typeof payload.delta === 'string') return payload.delta
  if ('type' in payload && payload.type === 'response.output_text.delta' && 'delta' in payload && typeof payload.delta === 'string') {
    return payload.delta
  }
  return ''
}

export function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('output' in payload) || !Array.isArray(payload.output)) return ''

  return payload.output
    .flatMap((item) => {
      if (!item || typeof item !== 'object' || !('content' in item) || !Array.isArray(item.content)) return []
      return item.content.map((content: unknown) => {
        if (content && typeof content === 'object' && 'text' in content) {
          const text = content.text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
    })
    .join('')
}
