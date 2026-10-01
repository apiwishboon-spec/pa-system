import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'

const FILE = 'settings.json'

export function settingsPath(): string {
  return path.join(app.getPath('userData'), FILE)
}

export function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Settings> & { closeTime?: string | null }
    return sanitise({ ...DEFAULT_SETTINGS, ...parsed })
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Drop unknown keys, clamp levels and validate times. Configs written by an
 * older build carry fields this one no longer uses (lang, volBell, bellTimes,
 * closeTime), so the object is rebuilt key by key rather than spread.
 */
function sanitise(s: Settings): Settings {
  const inputKind = s.inputKind === 'loopback' || s.inputKind === 'device' ? s.inputKind : 'off'
  const cueFiles: Settings['cueFiles'] = {}
  for (const kind of ['open', 'close', 'classEnd', 'emergency'] as const) {
    const v = s.cueFiles?.[kind]
    if (typeof v === 'string' && v) cueFiles[kind] = v
  }
  return {
    outputDeviceId: typeof s.outputDeviceId === 'string' ? s.outputDeviceId : null,
    master: clamp01(s.master),
    volAnnounce: clamp01(s.volAnnounce),
    volChime: clamp01(s.volChime),
    volEmergency: clamp01(s.volEmergency),
    volBgm: clamp01(s.volBgm),
    volInput: clamp01(s.volInput),
    bgmDuck: clamp01(s.bgmDuck),
    inputKind,
    inputDeviceId: typeof s.inputDeviceId === 'string' ? s.inputDeviceId : null,
    schedulePaused: s.schedulePaused === true,
    autostart: s.autostart !== false,
    fullscreen: s.fullscreen === true,
    bgmEnabled: s.bgmEnabled === true,
    bgmTrack: typeof s.bgmTrack === 'string' && s.bgmTrack ? s.bgmTrack : null,
    openTime: isHhMm(s.openTime) ? s.openTime : null,
    classEndTimes: [...new Set((s.classEndTimes ?? []).filter(isHhMm))].sort(),
    cueFiles,
  }
}

/**
 * Pending disk write. Sliders fire a change event per pixel of drag, so
 * writing synchronously on every tick stalls the event loop and the audio the
 * operator is adjusting. The sanitised settings are returned immediately and
 * the file is rewritten once the value settles.
 */
let pending: Settings | null = null
let timer: NodeJS.Timeout | null = null

export function saveSettings(settings: Settings): Settings {
  const clean = sanitise(settings)
  pending = clean
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushSettings, 400)
  return clean
}

/** Force any debounced write out now. Used on quit. */
export function flushSettings(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!pending) return
  const clean = pending
  pending = null
  try {
    const dir = path.dirname(settingsPath())
    fs.mkdirSync(dir, { recursive: true })
    const tmp = path.join(dir, `${FILE}.tmp`)
    fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf8')
    fs.renameSync(tmp, settingsPath())
  } catch {
    // A failed write must not break the running app; the in-memory copy stays
    // correct and the next change will retry.
  }
}

export function appendLog(level: 'info' | 'warn' | 'error', message: string): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    fs.appendFileSync(
      path.join(dir, `${day}.log`),
      `${new Date().toISOString()} [${level}] ${message}\n`,
      'utf8',
    )
  } catch {
    // Logging must never break playback.
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

export function isHhMm(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
}
