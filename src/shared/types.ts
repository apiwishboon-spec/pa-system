/**
 * The PA has exactly three recorded announcements plus optional background
 * music. A file's role is decided by the FOLDER it sits in, not its filename,
 * so recordings can be named anything the school prefers.
 *
 *   announcements/  -> PA เริ่ม (PA Start)
 *   bells/          -> Bell
 *   emergency/      -> Emergency
 *   music/          -> Background music (uploaded from the app)
 */

export type AnnouncementKind = 'open' | 'close' | 'classEnd' | 'emergency'

export type InputKind = 'off' | 'loopback' | 'device'

export type CueKind = AnnouncementKind | 'bgm' | 'tone' | 'other'

export interface LibraryFile {
  kind: CueKind
  /** base filename without extension, shown in the UI */
  name: string
  /** folder the file was found in, relative to the media root */
  folder: string
  url: string
  bytes: number
  /** true when the file came from the bundled library rather than user media */
  placeholder: boolean
}

export interface MissingSlot {
  kind: AnnouncementKind
  /** folder the school should drop a file into */
  folder: string
  label: string
}

export interface Library {
  files: LibraryFile[]
  missing: MissingSlot[]
  scannedAt: number
}

export interface Settings {
  /** null = follow the Windows default playback device (PA line-out) */
  outputDeviceId: string | null
  master: number
  volAnnounce: number
  volEmergency: number
  volBgm: number
  /** live input from another app or a line-in feed */
  volInput: number
  /** 0 = no ducking, 1 = fully muted under an announcement */
  bgmDuck: number
  /** 'off' | 'loopback' (system audio) | 'device' (line-in / virtual cable) */
  inputKind: InputKind
  /** deviceId for inputKind === 'device'; null = OS default input */
  inputDeviceId: string | null
  /** Tray-only switch: stop announcing without quitting the app. */
  schedulePaused: boolean
  autostart: boolean
  fullscreen: boolean
  bgmEnabled: boolean
  bgmTrack: string | null
  /** 'HH:MM' 24h, or null to disable */
  openTime: string | null
  classEndTimes: string[]
  /**
   * Manual override when a folder holds more than one recording. Keyed by
   * announcement kind, valued by base filename. Unset = use the first file
   * found in the matching folder.
   */
  cueFiles: Partial<Record<AnnouncementKind, string>>
}

export type ScheduleAction = AnnouncementKind

export type CueSource = 'manual' | 'schedule'

export type ToMain =
  | { type: 'play'; kind: AnnouncementKind | 'tone' }
  | { type: 'emergency-stop' }
  | { type: 'bgm-set'; on: boolean; track?: string | null }
  | { type: 'library-rescan' }
  | { type: 'settings-save'; patch: Partial<Settings> }
  | { type: 'reveal-media' }

export type FromMain =
  | { type: 'cue'; kind: CueKind; source: CueSource; at: number }
  | { type: 'emergency-stop' }
  | { type: 'settings'; settings: Settings }
  | { type: 'library'; library: Library }
  | { type: 'devices'; devices: OutputDevice[] }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; at: number }

export interface OutputDevice {
  deviceId: string
  label: string
}

export const DEFAULT_SETTINGS: Settings = {
  outputDeviceId: null,
  master: 0.9,
  volAnnounce: 1.0,
  volEmergency: 0.8,
  volBgm: 0.35,
  volInput: 0.8,
  bgmDuck: 0.85,
  inputKind: 'off',
  inputDeviceId: null,
  schedulePaused: false,
  autostart: true,
  fullscreen: false,
  bgmEnabled: false,
  bgmTrack: null,
  openTime: '08:00',
  classEndTimes: [],
  cueFiles: {},
}

export const ANNOUNCEMENTS: { kind: AnnouncementKind; folder: string; label: string }[] = [
  { kind: 'open', folder: 'announcements', label: 'PA เริ่ม (PA Start)' },
  // Not required: the end sound is optional, and the app just restores the
  // music silently if the folder has no matching file.
  { kind: 'close', folder: 'announcements', label: 'PA จบ (PA Finish)' },
  { kind: 'classEnd', folder: 'bells', label: 'กระดิ่ง (Bell)' },
  { kind: 'emergency', folder: 'emergency', label: 'ฉุกเฉิน (Emergency)' },
]

/**
 * Slots the app expects to find, used to show what is still missing. The end
 * sound is deliberately excluded: it is optional, and warning about a missing
 * `close.mp3` on a machine that never wanted one would be noise.
 */
export const REQUIRED: MissingSlot[] = ANNOUNCEMENTS.filter((a) => a.kind !== 'close').map(
  (a) => ({
    kind: a.kind,
    folder: a.folder,
    label: a.label,
  }),
)

const AUDIO = new Set(['.wav', '.mp3', '.ogg', '.m4a', '.aac', '.flac'])

/** Folder name -> role. Keys are already normalised by normaliseFolder. */
const FOLDER_KIND: Record<string, CueKind> = {
  announcements: 'open',
  announcement: 'open',
  open: 'open',
  bells: 'classEnd',
  bell: 'classEnd',
  classend: 'classEnd',
  close: 'classEnd',
  emergency: 'emergency',
  emergencies: 'emergency',
  alarm: 'emergency',
  music: 'bgm',
  bgm: 'bgm',
  sounds: 'tone',
}

export function normaliseFolder(dir: string): string {
  return dir.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Names that mean "plays when the announcement finishes", not "PA Start". */
const CLOSE_NAMES = /^(end|close|finish|finished|stop|bye|goodbye|out|dismiss|done)\b/i
const OPEN_NAMES = /^(open|start|begin|attention|hello)\b/i

/**
 * Folder wins. Filename is only consulted for music, so a file dropped loose
 * in the media root can still be used as BGM.
 *
 * The announcements folder is the one exception: it holds both ends of the
 * live announcement (start chime and end sound), so an obvious filename there
 * decides which end it is. Without this, `end.mp3` and `open.mp3` both
 * classify as 'open' and whichever sorts first wins.
 */
export function classify(base: string, folder: string | null): CueKind {
  const key = folder === null ? null : normaliseFolder(folder)
  const byFolder = key && FOLDER_KIND[key] ? FOLDER_KIND[key] : null

  if (byFolder === 'open') {
    if (CLOSE_NAMES.test(base)) return 'close'
    if (OPEN_NAMES.test(base)) return 'open'
  }

  if (byFolder) return byFolder

  const n = base.toLowerCase()
  if (n.includes('bgm') || n.includes('music')) return 'bgm'
  if (n.includes('tone') || n.includes('test')) return 'tone'
  return 'other'
}

export function isAudio(file: string): boolean {
  const i = file.lastIndexOf('.')
  return i > 0 && AUDIO.has(file.slice(i).toLowerCase())
}

export function stripExt(file: string): string {
  const i = file.lastIndexOf('.')
  return i > 0 ? file.slice(0, i) : file
}
