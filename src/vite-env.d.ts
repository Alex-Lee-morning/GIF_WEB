/// <reference types="vite/client" />

import type { PixelPetApi } from '../shared/types'

declare global {
  interface Window {
    pixelPet: PixelPetApi
  }
}

export {}
