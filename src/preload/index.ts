import { contextBridge, ipcRenderer } from 'electron'
import type { FromMain, Library, Settings, ToMain } from '../shared/types'

const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('pa:settings:get'),
  saveSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('pa:settings:save', patch),

  getLibrary: (): Promise<Library> => ipcRenderer.invoke('pa:library:get'),
  rescanLibrary: (): Promise<Library> => ipcRenderer.invoke('pa:library:rescan'),
  openMediaFolder: (): Promise<string> => ipcRenderer.invoke('pa:media:open-folder'),

  getVersion: (): Promise<string> => ipcRenderer.invoke('pa:app:version'),

  play: (kind: 'open' | 'close' | 'classEnd' | 'emergency' | 'tone'): void =>
    api.send({ type: 'play', kind }),
  log: (level: 'info' | 'warn' | 'error', message: string): void => {
    void ipcRenderer.invoke('pa:log', level, message)
  },
  stopEmergency: (): void => api.send({ type: 'emergency-stop' }),
  importMusic: (): Promise<{ added: string[]; error: string | null; skipped: number; message: string | null }> =>
    ipcRenderer.invoke('pa:media:import-music'),
  setBgm: (on: boolean, track?: string | null): void => api.send({ type: 'bgm-set', on, track }),
  rescan: (): void => api.send({ type: 'library-rescan' }),
  revealMedia: (): void => api.send({ type: 'reveal-media' }),

  getLogs: (): Promise<{ level: 'info' | 'warn' | 'error'; message: string; at: number }[]> =>
    ipcRenderer.invoke('pa:logs:recent'),
  revealLog: (): void => {
    void ipcRenderer.invoke('pa:logs:reveal')
  },

  send: (msg: ToMain): void => ipcRenderer.send('pa:msg', msg),
  on: (handler: (msg: FromMain) => void): (() => void) => {
    const listener = (_e: unknown, msg: FromMain): void => handler(msg)
    ipcRenderer.on('pa:msg', listener)
    return () => ipcRenderer.removeListener('pa:msg', listener)
  },
}

export type PaApi = typeof api

contextBridge.exposeInMainWorld('pa', api)
