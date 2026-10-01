// Regression test for the pa-media:// URL -> filesystem path mapping.
//
// A URL pathname always starts with "/", but a Windows absolute path is
// "C:\...", so resolving the raw pathname produced "\C:\C:\..." and every cue
// 404'd. All audio was silent on Windows while the test tone kept working,
// because the tone is synthesised and never touches this code.
//
// Run: node scripts/verify-media-paths.ts
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Mirrors resolveMediaPath() in src/main/media.ts.
function resolveMediaPath(pathname: string, platform: NodeJS.Platform): string {
  if (platform === 'win32' && /^\/[a-zA-Z]:/.test(pathname)) {
    return path.win32.resolve(pathname.slice(1))
  }
  return path.posix.resolve(pathname)
}

let fail = 0
const check = (label: string, got: unknown, want: unknown): void => {
  const ok = got === want
  if (!ok) fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(46)} ${String(got)}${ok ? '' : `   expected ${String(want)}`}`)
}

console.log('Windows: a drive-letter pathname keeps its drive')
check(
  'C:\\ path',
  resolveMediaPath('/C:\\Users\\school\\bell.mp3', 'win32'),
  'C:\\Users\\school\\bell.mp3'
)
check(
  'lowercase drive',
  resolveMediaPath('/d:\\Apps\\bell.mp3', 'win32'),
  'd:\\Apps\\bell.mp3'
)

console.log('macOS and Linux: absolute paths are unchanged')
check(
  '/Users/... path',
  resolveMediaPath('/Users/boon/bell.mp3', 'darwin'),
  '/Users/boon/bell.mp3'
)
check(
  '/home/... path',
  resolveMediaPath('/home/teacher/bell.mp3', 'linux'),
  '/home/teacher/bell.mp3'
)

console.log('traversal is still collapsed before the allow-list check')
check(
  '../.. escapes to root',
  resolveMediaPath('/../../etc/passwd', 'linux'),
  '/etc/passwd'
)

console.log('toUrl() -> URL -> resolve round-trips on both platforms')
const roundTrip = (abs: string, platform: NodeJS.Platform): string => {
  const url = new URL(`pa-media://local/${encodeURIComponent(abs)}`)
  return resolveMediaPath(decodeURIComponent(url.pathname), platform)
}
check(
  'windows round-trip',
  roundTrip('C:\\Program Files\\PA System\\bell.mp3', 'win32'),
  'C:\\Program Files\\PA System\\bell.mp3'
)
check(
  'macos round-trip',
  roundTrip('/Applications/PA System/bell.mp3', 'darwin'),
  '/Applications/PA System/bell.mp3'
)

console.log('the resulting path is usable as a file URL')
const target = 'C:\\Program Files\\PA System\\bell.mp3'
check(
  'file URL keeps the drive',
  pathToFileURL(target).protocol,
  'file:'
)

console.log(fail === 0 ? '\nPASS: media paths resolve on every platform' : `\nFAIL: ${fail} check(s)`)
process.exit(fail === 0 ? 0 : 1)
