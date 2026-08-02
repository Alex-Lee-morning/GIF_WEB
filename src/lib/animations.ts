import type { PetSpriteState } from '../../shared/types'

export type PetAnimState = PetSpriteState

export interface AnimFrame {
  translateY: number
  rotate: number
  scaleX: number
  scaleY: number
  bounce: number
}

/** CSS fallback when no sprite sheet is available */
const IDLE_FRAMES: AnimFrame[] = [
  { translateY: 0, rotate: 0, scaleX: 1, scaleY: 1, bounce: 0 },
  { translateY: -3, rotate: -2, scaleX: 1.02, scaleY: 0.98, bounce: 1 },
  { translateY: 0, rotate: 0, scaleX: 1, scaleY: 1, bounce: 0 },
  { translateY: -2, rotate: 2, scaleX: 0.98, scaleY: 1.02, bounce: 1 },
]

const REACT_FRAMES: AnimFrame[] = [
  { translateY: -10, rotate: -8, scaleX: 0.95, scaleY: 1.08, bounce: 1 },
  { translateY: -2, rotate: 8, scaleX: 1.05, scaleY: 0.95, bounce: 0 },
  { translateY: -8, rotate: -4, scaleX: 0.98, scaleY: 1.04, bounce: 1 },
  { translateY: 0, rotate: 0, scaleX: 1, scaleY: 1, bounce: 0 },
]

const THINK_FRAMES: AnimFrame[] = [
  { translateY: -2, rotate: -3, scaleX: 1, scaleY: 1, bounce: 0 },
  { translateY: -4, rotate: 3, scaleX: 1.02, scaleY: 0.98, bounce: 1 },
]

const TALK_FRAMES: AnimFrame[] = [
  { translateY: -1, rotate: -2, scaleX: 1.03, scaleY: 0.97, bounce: 0 },
  { translateY: -3, rotate: 2, scaleX: 0.97, scaleY: 1.03, bounce: 1 },
]

const DRAG_FRAMES: Record<'dragUp' | 'dragDown' | 'dragLeft' | 'dragRight', AnimFrame> = {
  dragUp: { translateY: -6, rotate: 0, scaleX: 0.92, scaleY: 1.12, bounce: 0 },
  dragDown: { translateY: 4, rotate: 0, scaleX: 1.08, scaleY: 0.88, bounce: 0 },
  // Mild bob only — facing comes from flipped sprite frames, not CSS rotate
  dragLeft: { translateY: -2, rotate: 0, scaleX: 1.02, scaleY: 0.98, bounce: 0 },
  dragRight: { translateY: -2, rotate: 0, scaleX: 1.02, scaleY: 0.98, bounce: 0 },
}

export function getAnimFrame(state: PetAnimState, tick: number): AnimFrame {
  switch (state) {
    case 'dragUp':
    case 'dragDown':
    case 'dragLeft':
    case 'dragRight':
      return DRAG_FRAMES[state]
    case 'react':
      return REACT_FRAMES[tick % REACT_FRAMES.length]
    case 'think':
      return THINK_FRAMES[tick % THINK_FRAMES.length]
    case 'talk':
      return TALK_FRAMES[tick % TALK_FRAMES.length]
    case 'idle':
    default:
      return IDLE_FRAMES[tick % IDLE_FRAMES.length]
  }
}

export function frameIntervalMs(state: PetAnimState, animStyle?: 'body' | 'face'): number {
  if (animStyle === 'face') {
    switch (state) {
      case 'idle':
        return 130
      case 'dragLeft':
      case 'dragRight':
      case 'dragUp':
      case 'dragDown':
        return 100
      case 'react':
        return 120
      case 'talk':
        return 160
      case 'think':
        return 260
      default:
        return 160
    }
  }
  switch (state) {
    case 'react':
      return 120
    case 'talk':
      return 180
    case 'think':
      return 280
    case 'dragLeft':
    case 'dragRight':
      return 100
    case 'dragUp':
    case 'dragDown':
      return 110
    case 'idle':
      return 300
    default:
      return 300
  }
}

export function toCssTransform(frame: AnimFrame): string {
  return `translateY(${frame.translateY}px) rotate(${frame.rotate}deg) scale(${frame.scaleX}, ${frame.scaleY})`
}

export function dragStateFromDelta(
  dx: number,
  dy: number,
  swapWalkDirection = false,
): PetAnimState {
  if (Math.abs(dx) >= Math.abs(dy)) {
    const goingRight = dx >= 0
    if (swapWalkDirection) {
      return goingRight ? 'dragLeft' : 'dragRight'
    }
    return goingRight ? 'dragRight' : 'dragLeft'
  }
  return dy >= 0 ? 'dragDown' : 'dragUp'
}

/** Map movement direction to walk animation (after optional L/R swap). */
export function walkAnimForDir(dir: 1 | -1, swapWalkDirection = false): PetAnimState {
  const goingLeft = dir < 0
  if (swapWalkDirection) {
    return goingLeft ? 'dragRight' : 'dragLeft'
  }
  return goingLeft ? 'dragLeft' : 'dragRight'
}
