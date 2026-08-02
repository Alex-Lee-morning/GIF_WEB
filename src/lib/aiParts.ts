import type { BodyParts, Rect } from './detectParts'

/** Normalized rect: fractions of subject canvas width/height (0–1). */
export interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Cursor AI 手标部位（相对抠图画布 0–1）。
 * 主体：柯基三四分之三侧面朝右，短腿四足。
 */
export const CORGI_AI_PARTS_NORM = {
  label: 'Test Image.png · Pembroke Corgi · facing right',
  notes: [
    '头：含双耳与吻部上半',
    '双眼：深色像素簇，用于眨眼',
    '前腿：画面右侧短白腿（近/远各一）',
    '后腿：画面左侧后躯短腿',
    '腿带：整段下半身用于步伐位移',
  ],
  head: { x: 0.32, y: 0.0, w: 0.55, h: 0.42 },
  leftEye: { x: 0.48, y: 0.22, w: 0.055, h: 0.045 },
  rightEye: { x: 0.58, y: 0.24, w: 0.06, h: 0.048 },
  mouth: { x: 0.62, y: 0.32, w: 0.12, h: 0.08 },
  torso: { x: 0.12, y: 0.28, w: 0.7, h: 0.4 },
  // 四足：左后 / 右后 / 左前 / 右前（画面坐标）
  leftLeg: { x: 0.14, y: 0.62, w: 0.18, h: 0.36 },
  rightLeg: { x: 0.3, y: 0.6, w: 0.2, h: 0.38 },
  leftArm: { x: 0.52, y: 0.58, w: 0.16, h: 0.4 },
  rightArm: { x: 0.66, y: 0.56, w: 0.18, h: 0.42 },
  legs: { x: 0.12, y: 0.55, w: 0.78, h: 0.44 },
} as const

function denorm(n: NormRect, W: number, H: number): Rect {
  return {
    x: Math.max(0, Math.floor(n.x * W)),
    y: Math.max(0, Math.floor(n.y * H)),
    w: Math.max(1, Math.round(n.w * W)),
    h: Math.max(1, Math.round(n.h * H)),
  }
}

/** Build BodyParts from Cursor AI normalized annotations. */
export function bodyPartsFromAiNorm(
  W: number,
  H: number,
  norm: typeof CORGI_AI_PARTS_NORM = CORGI_AI_PARTS_NORM,
): BodyParts {
  return {
    head: denorm(norm.head, W, H),
    leftEye: denorm(norm.leftEye, W, H),
    rightEye: denorm(norm.rightEye, W, H),
    mouth: denorm(norm.mouth, W, H),
    torso: denorm(norm.torso, W, H),
    leftArm: denorm(norm.leftArm, W, H),
    rightArm: denorm(norm.rightArm, W, H),
    leftLeg: denorm(norm.leftLeg, W, H),
    rightLeg: denorm(norm.rightLeg, W, H),
    legs: denorm(norm.legs, W, H),
    hasEyes: true,
    hasMouth: true,
    fromPose: true,
    fromFace: true,
  }
}
