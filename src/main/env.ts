import { app } from 'electron'
import path from 'node:path'

export const isDev = !app.isPackaged

/**
 * electron-vite writes renderer assets next to the main bundle during dev.
 * The exact path is only known at runtime, so resolve it from import.meta.
 */
export function rendererDir(): string {
  return path.join(import.meta.dirname, '../renderer')
}
