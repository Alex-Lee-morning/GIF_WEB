import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type { AppConfig, ChatMessage } from '../../shared/types'
import { DEFAULT_CONFIG, PET_SIZE_MAX, PET_SIZE_MIN } from '../../shared/types'
import { getDefaultPetSprites, getDefaultPetStill } from '../lib/defaultPet'
import { dragStateFromDelta, walkAnimForDir, type PetAnimState } from '../lib/animations'
import { PixelPet } from './PixelPet'
import { ChatBubble } from './ChatBubble'
import './pet.css'

export default function PetApp() {
  const api = typeof window !== 'undefined' ? window.pixelPet : null
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [anim, setAnim] = useState<PetAnimState>('idle')
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [reply, setReply] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const dragRef = useRef<{
    dragging: boolean
    startScreenX: number
    startScreenY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)
  const resumeAnimRef = useRef<PetAnimState>('idle')
  const petRef = useRef<HTMLDivElement>(null)
  const contextRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const userBusyRef = useRef(false)
  const autoWalkAbortRef = useRef(false)

  const photo = config.photoDataUrl ?? getDefaultPetStill()
  const sprites = config.petSprites ?? getDefaultPetSprites()
  const isFacePet = sprites.animStyle === 'face'

  useEffect(() => {
    if (!api) return
    let unsub = () => {}
    ;(async () => {
      const cfg = await api.getConfig()
      setConfig(cfg)
      unsub = api.onConfigUpdated(setConfig)
    })().catch(console.error)
    return () => unsub()
  }, [api])

  useEffect(() => {
    if (anim !== 'react') return
    const timer = window.setTimeout(() => {
      setAnim((current) => (current === 'react' ? 'idle' : current))
    }, 520)
    return () => window.clearTimeout(timer)
  }, [anim])

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  // Autonomous walk: body pets only. Face pets stay put (hand-pull on drag, ball-bonk idle).
  useEffect(() => {
    if (!api || isFacePet) {
      autoWalkAbortRef.current = true
      setAnim((a) => (a === 'dragLeft' || a === 'dragRight' ? 'idle' : a))
      return
    }
    autoWalkAbortRef.current = false
    let timeoutId = 0
    let rafId = 0

    const scheduleNext = () => {
      const delay = 3500 + Math.random() * 4500
      timeoutId = window.setTimeout(() => {
        void runWalk()
      }, delay)
    }

    const runWalk = async () => {
      if (autoWalkAbortRef.current) return
      if (
        userBusyRef.current ||
        chatOpen ||
        streaming ||
        menu ||
        dragRef.current?.dragging
      ) {
        scheduleNext()
        return
      }

      let dir: 1 | -1 = Math.random() < 0.5 ? -1 : 1
      const steps = 28 + Math.floor(Math.random() * 20)
      const stepPx = 2 + Math.floor(Math.random() * 2)
      const swap = Boolean(config.swapWalkDirection)
      setAnim(walkAnimForDir(dir, swap))

      let step = 0
      const tick = async () => {
        if (
          autoWalkAbortRef.current ||
          userBusyRef.current ||
          dragRef.current?.dragging ||
          chatOpen ||
          streaming
        ) {
          setAnim((a) => (a === 'dragLeft' || a === 'dragRight' ? 'idle' : a))
          scheduleNext()
          return
        }
        if (step >= steps) {
          setAnim('idle')
          scheduleNext()
          return
        }
        const result = await api.movePetWindow(window.screenX + dir * stepPx, window.screenY)
        if (result?.hitLeft) {
          dir = 1
          setAnim(walkAnimForDir(dir, swap))
        } else if (result?.hitRight) {
          dir = -1
          setAnim(walkAnimForDir(dir, swap))
        }
        step += 1
        rafId = window.setTimeout(() => {
          void tick()
        }, 90)
      }
      void tick()
    }

    scheduleNext()
    return () => {
      autoWalkAbortRef.current = true
      window.clearTimeout(timeoutId)
      window.clearTimeout(rafId)
    }
  }, [api, chatOpen, streaming, menu, config.swapWalkDirection, isFacePet])

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.chat-bubble') || target.closest('.context-menu')) return

    userBusyRef.current = true
    resumeAnimRef.current = streaming ? (reply ? 'talk' : 'think') : 'idle'
    const winX = window.screenX
    const winY = window.screenY
    dragRef.current = {
      dragging: true,
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      originX: winX,
      originY: winY,
      moved: false,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag?.dragging || !api) return
    const dx = e.screenX - drag.startScreenX
    const dy = e.screenY - drag.startScreenY
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      drag.moved = true
      setAnim(dragStateFromDelta(dx, dy, config.swapWalkDirection))
    }
    void api.movePetWindow(drag.originX + dx, drag.originY + dy)
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    const drag = dragRef.current
    dragRef.current = null
    userBusyRef.current = false
    if (!drag) return
    if (!drag.moved) {
      setAnim('react')
      setChatOpen(true)
    } else {
      setAnim(resumeAnimRef.current)
    }
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  const onContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const sendMessage = async () => {
    if (!api || !input.trim() || streaming) return
    const userText = input.trim()
    setInput('')
    setError('')
    setReply('')
    setReasoning('')
    setChatOpen(true)
    setStreaming(true)
    setAnim('think')

    const history: ChatMessage[] = [...messages.slice(-6), { role: 'user', content: userText }]
    setMessages(history)

    let content = ''
    let thinking = ''
    try {
      await api.chatStream(history, (chunk) => {
        if (chunk.type === 'reasoning' && chunk.text) {
          thinking += chunk.text
          setReasoning(thinking)
          setAnim('think')
        } else if (chunk.type === 'content' && chunk.text) {
          content += chunk.text
          setReply(content)
          setAnim('talk')
        } else if (chunk.type === 'error') {
          setError(chunk.text ?? '对话失败')
          setAnim('idle')
        } else if (chunk.type === 'done') {
          if (content) {
            setMessages((prev) => [...prev, { role: 'assistant', content }])
          }
          setAnim('idle')
        }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setAnim('idle')
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="pet-root" onContextMenu={onContextMenu}>
      <div
        className="pet-stage"
        ref={petRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {(anim === 'think' || reasoning) && (
          <div className="think-dots" aria-hidden>
            <span />
            <span />
            <span />
          </div>
        )}
        <PixelPet
          sprites={sprites}
          fallbackSrc={photo}
          size={config.petSize}
          state={anim}
          className={`pet-sprite state-${anim}`}
        />
      </div>

      {chatOpen && (
        <ChatBubble
          input={input}
          reply={reply}
          reasoning={reasoning}
          error={error}
          streaming={streaming}
          onInput={setInput}
          onSend={() => void sendMessage()}
          onClose={() => {
            setChatOpen(false)
            if (!streaming) setAnim('idle')
          }}
        />
      )}

      {menu && (
        <div
          className="context-menu"
          ref={contextRef}
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => { setChatOpen(true); setMenu(null) }}>
            和我聊天
          </button>
          <button
            type="button"
            onClick={() => {
              const next = Math.min(PET_SIZE_MAX, config.petSize + 16)
              void api?.resizePetWindow(next)
              setMenu(null)
            }}
          >
            变大
          </button>
          <button
            type="button"
            onClick={() => {
              const next = Math.max(PET_SIZE_MIN, config.petSize - 16)
              void api?.resizePetWindow(next)
              setMenu(null)
            }}
          >
            变小
          </button>
          {!isFacePet && (
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  const next = !config.swapWalkDirection
                  await api?.setConfig({ swapWalkDirection: next })
                  setConfig((c) => ({ ...c, swapWalkDirection: next }))
                  setMenu(null)
                })()
              }}
            >
              {config.swapWalkDirection ? '还原左右走动画' : '对调左右走动画'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void api?.openSettings()
              setMenu(null)
            }}
          >
            打开设置
          </button>
          <button
            type="button"
            onClick={() => {
              void api?.hidePet()
              setMenu(null)
            }}
          >
            隐藏桌宠
          </button>
        </div>
      )}
    </div>
  )
}
