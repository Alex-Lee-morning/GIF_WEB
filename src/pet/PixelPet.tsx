import { useEffect, useMemo, useState } from 'react'
import type { PetSpriteSet } from '../../shared/types'
import { frameIntervalMs, getAnimFrame, toCssTransform, type PetAnimState } from '../lib/animations'

interface PixelPetProps {
  sprites: PetSpriteSet | null
  fallbackSrc: string
  size: number
  state: PetAnimState
  className?: string
}

export function PixelPet({ sprites, fallbackSrc, size, state, className }: PixelPetProps) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((t) => t + 1)
    }, frameIntervalMs(state, sprites?.animStyle))
    return () => window.clearInterval(id)
  }, [state, sprites?.animStyle])

  const frameList = sprites?.frames[state] ?? sprites?.frames.idle ?? null
  const src = useMemo(() => {
    if (frameList && frameList.length > 0) {
      return frameList[tick % frameList.length]
    }
    return fallbackSrc
  }, [fallbackSrc, frameList, tick])

  const cssFrame = getAnimFrame(state, tick)
  const useCssFallback = !frameList || frameList.length === 0

  return (
    <img
      src={src}
      alt="像素桌宠"
      className={className}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        imageRendering: 'pixelated',
        transform: useCssFallback ? toCssTransform(cssFrame) : undefined,
      }}
      draggable={false}
    />
  )
}
