import type { PaApi } from '../../preload'

declare global {
  interface Window {
    /** Kept in sync with the preload bridge by importing its type directly. */
    pa: PaApi
  }
}

export {}
