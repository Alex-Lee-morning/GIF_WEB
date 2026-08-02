interface ChatBubbleProps {
  input: string
  reply: string
  reasoning: string
  error: string
  streaming: boolean
  onInput: (value: string) => void
  onSend: () => void
  onClose: () => void
}

export function ChatBubble({
  input,
  reply,
  reasoning,
  error,
  streaming,
  onInput,
  onSend,
  onClose,
}: ChatBubbleProps) {
  return (
    <div className="chat-bubble">
      <div className="chat-header">
        <strong>像素对话</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      <div className="chat-body">
        {reasoning ? (
          <details className="reasoning" open={streaming && !reply}>
            <summary>思考中…</summary>
            <pre>{reasoning}</pre>
          </details>
        ) : null}
        {reply ? <p className="reply">{reply}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {!reply && !error && streaming ? <p className="muted">正在想事情…</p> : null}
        {!reply && !error && !streaming ? (
          <p className="muted">点我说话，或在下面输入消息。</p>
        ) : null}
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
