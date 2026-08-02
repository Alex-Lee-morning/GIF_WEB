import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../../shared/types'

interface ChatBubbleProps {
  messages: ChatMessage[]
  /** In-progress assistant reply (streaming) */
  reply: string
  input: string
  reasoning: string
  error: string
  streaming: boolean
  onInput: (value: string) => void
  onSend: () => void
  onClose: () => void
}

export function ChatBubble({
  messages,
  reply,
  input,
  reasoning,
  error,
  streaming,
  onInput,
  onSend,
  onClose,
}: ChatBubbleProps) {
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, reply, reasoning, error, streaming])

  const showPlaceholder = messages.length === 0 && !reply && !error && !streaming

  return (
    <div className="chat-bubble">
      <div className="chat-header">
        <strong>像素对话</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {showPlaceholder ? (
          <p className="muted">点我说话，或在下面输入消息。</p>
        ) : null}

        {messages.map((m, i) => (
          <div
            key={`${m.role}-${i}-${m.content.slice(0, 12)}`}
            className={`chat-msg chat-msg-${m.role}`}
          >
            <span className="chat-msg-role">{m.role === 'user' ? '你' : '桌宠'}</span>
            <p className="chat-msg-text">{m.content}</p>
          </div>
        ))}

        {streaming && reply ? (
          <div className="chat-msg chat-msg-assistant chat-msg-streaming">
            <span className="chat-msg-role">桌宠</span>
            <p className="chat-msg-text">{reply}</p>
          </div>
        ) : null}

        {reasoning ? (
          <details className="reasoning" open={streaming && !reply}>
            <summary>思考中…</summary>
            <pre>{reasoning}</pre>
          </details>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
        {!reply && !error && streaming ? <p className="muted">正在想事情…</p> : null}
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          onSend()
        }}
      >
        <input
          value={input}
          onChange={(e) => onInput(e.target.value)}
          placeholder="说点什么…"
          disabled={streaming}
        />
        <button type="submit" disabled={streaming || !input.trim()}>
          发送
        </button>
      </form>
    </div>
  )
}
