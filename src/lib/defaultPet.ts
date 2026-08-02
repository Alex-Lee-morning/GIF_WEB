import type { PetSpriteSet } from '../../shared/types'
import defaultJson from '../assets/defaultPetSprites.json'

/** Packaged default desktop pet: cartoon pixel corgi (generated under assets/). */
export function getDefaultPetSprites(): PetSpriteSet {
  return defaultJson as PetSpriteSet
}

export function getDefaultPetStill(): string {
  const sprites = getDefaultPetSprites()
  return sprites.frames.idle[0] ?? sprites.frames.dragRight[0]
}
