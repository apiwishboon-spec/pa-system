import { app, net, protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  REQUIRED,
  classify,
  isAudio,
  stripExt,
  type CueKind,
  type Library,
  type LibraryFile,
} from '../shared/types'

export const SCHEME = 'pa-media'

/** Read-only media shipped with the app. */
export function bundledRoot(): string {
  return path.join(app.getAppPath(), 'media')
}

/** Writable media the school drops recordings into at runtime. */
export function userRoot(): string {
  return path.join(app.getPath('userData'), 'media')
}

export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ])
}

/** Only these directories may ever be read through the custom protocol. */
function allowedRoots(): string[] {
  return [bundledRoot(), userRoot()]
}

export function handleMediaProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const target = path.resolve(decodeURIComponent(url.pathname))
      const ok = allowedRoots().some((root) => {
        const rel = path.relative(root, target)
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
      })
      if (!ok) {
        return new Response('forbidden', { status: 403 })
      }
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        return new Response('not found', { status: 404 })
      }
      return await net.fetch(pathToFileURL(target).toString())
    } catch (err) {
      return new Response(`error: ${String(err)}`, { status: 500 })
    }
  })
}

export function toUrl(absPath: string): string {
  return `${SCHEME}://local/${encodeURIComponent(absPath)}`
}

interface Found {
  file: string
  /** folder name relative to the media root, e.g. "announcements" */
  folder: string
  placeholder: boolean
  priority: number
}

/**
 * Walk a media root one level of folders deep. A file's role comes from the
 * folder holding it, so a loose file in the root has no folder and falls back
 * to its filename.
 */
function walk(root: string, placeholder: boolean, priority: number, out: Found[]): void {
  if (!fs.existsSync(root)) return
  const seen = new Set<string>()

  const visit = (dir: string, folder: string | null): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        // One level only: nesting deeper makes the role ambiguous.
        if (folder === null) visit(full, e.name)
      } else if (e.isFile() && isAudio(e.name) && !seen.has(full)) {
        seen.add(full)
        out.push({ file: full, folder: folder ?? '', placeholder, priority })
      }
    }
  }

  visit(root, null)
}

export interface ScanRoots {
  bundled: string
  user: string
}

export function scanLibrary(roots: ScanRoots = { bundled: bundledRoot(), user: userRoot() }): Library {
  const found: Found[] = []
  // Bundled library first, then the writable user media. Each root is scanned
  // both at its top level and under `library/`, so files work whether they are
  // dropped into media/ directly or into media/library/.
  walk(roots.bundled, true, 0, found)
  walk(path.join(roots.bundled, 'library'), true, 0, found)
  walk(roots.user, false, 1, found)
  walk(path.join(roots.user, 'library'), false, 1, found)

  // Later sources win, so a recording dropped into userData replaces the
  // bundled library copy of the same announcement.
  const byKey = new Map<string, LibraryFile>()
  for (const f of found.sort((a, b) => a.priority - b.priority)) {
    const base = stripExt(path.basename(f.file))
    const kind = classify(base, f.folder || null)
    let bytes = 0
    try {
      bytes = fs.statSync(f.file).size
    } catch {
      continue
    }
    byKey.set(`${kind}:${f.folder}:${base}`, {
      kind,
      name: base,
      folder: f.folder,
      url: toUrl(f.file),
      bytes,
      placeholder: f.placeholder,
    })
  }

  const files = [...byKey.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  )
  const present = new Set(files.map((f) => f.kind))
  const missing = REQUIRED.filter((r) => !present.has(r.kind))

  return { files, missing, scannedAt: Date.now() }
}

/**
 * Resolve which file an announcement button should play: the operator's
 * override if set, otherwise the first file in the matching folder.
 */
export function pick(
  library: Library,
  kind: CueKind,
  preferred?: string | null,
): LibraryFile | null {
  if (preferred) {
    const exact = library.files.find((f) => f.name === preferred && f.kind === kind)
    if (exact) return exact
  }
  return library.files.find((f) => f.kind === kind) ?? null
}
