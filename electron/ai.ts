import type { AppConfig, ChatMessage, ChatStreamChunk } from '../shared/types.js'

export async function* streamChat(
  config: AppConfig,
  messages: ChatMessage[],
): AsyncGenerator<ChatStreamChunk> {
  const apiKey = config.aiApiKey?.trim()
  const baseUrl = config.aiBaseUrl?.replace(/\/$/, '')
  const model = config.aiModel?.trim()

  if (!apiKey) {
    yield { type: 'error', text: '请先在设置中填写 API Key' }
    return
  }
  if (!baseUrl) {
    yield { type: 'error', text: '请先填写 API Base URL' }
    return
  }
  if (!model) {
    yield { type: 'error', text: '请先选择或填写模型名称' }
    return
  }

  const payloadMessages: ChatMessage[] = []
  if (config.systemPrompt?.trim()) {
    payloadMessages.push({ role: 'system', content: config.systemPrompt.trim() })
  }
  payloadMessages.push(...messages)

  let response: Response
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: payloadMessages,
        stream: true,
        temperature: 0.8,
      }),
    })
  } catch (err) {
    yield {
      type: 'error',
      text: `网络请求失败：${err instanceof Error ? err.message : String(err)}`,
    }
    return
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    yield {
      type: 'error',
      text: `API 错误 ${response.status}：${detail.slice(0, 240) || response.statusText}`,
    }
    return
  }

  if (!response.body) {
    yield { type: 'error', text: 'API 未返回流式内容' }
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || !line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') {
        yield { type: 'done' }
        return
      }
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{
            delta?: {
              content?: string | null
              reasoning_content?: string | null
            }
          }>
        }
        const delta = json.choices?.[0]?.delta
        if (delta?.reasoning_content) {
          yield { type: 'reasoning', text: delta.reasoning_content }
        }
        if (delta?.content) {
          yield { type: 'content', text: delta.content }
        }
      } catch {
        // ignore malformed chunk
      }
    }
  }

  yield { type: 'done' }
}
