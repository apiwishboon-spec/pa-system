// Verifies the pure media logic against the real files. No Electron needed.
// Run: npm run verify:media
import { ANNOUNCEMENTS, classify, isAudio, normaliseFolder, stripExt, REQUIRED } from '../src/shared/types.ts'

let fail = 0
const check = (label: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  const g = typeof got === 'string' ? got : JSON.stringify(got)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(34)} ${g}${ok ? '' : `   expected ${JSON.stringify(want)}`}`)
}

console.log('classify(): folder decides the role')
for (const [folder, name, want] of [
  ['announcements', 'attention-chime-CANDIDATE', 'open'],
  ['announcements', 'whatever-they-called-it', 'open'],
  ['bells', 'class-end', 'classEnd'],
  ['bells', 'recording-2024', 'classEnd'],
  ['emergency', 'mp3-output-ttsfree(dot)com_with_music', 'emergency'],
  ['music', 'bgm-1', 'bgm'],
  ['announcements', 'bgm-1', 'open'],
  ['bells', 'bgm-1', 'classEnd'],
] as [string, string, string][]) {
  check(`${folder}/${name}`, classify(name, folder), want)
}

console.log('\nclassify(): the announcements folder holds both ends')
for (const [folder, name, want] of [
  ['announcements', 'open', 'open'],
  ['announcements', 'end', 'close'],
  ['announcements', 'close', 'close'],
  ['announcements', 'finish', 'close'],
  ['announcements', 'attention-chime-CANDIDATE', 'open'],
  ['announcements', 'recording-2024', 'open'],
  ['bells', 'end', 'classEnd'],
  ['emergency', 'close', 'emergency'],
] as [string, string, string][]) {
  check(`${folder}/${name}`, classify(name, folder), want)
}

console.log('\nclassify(): folder aliases and normalisation')
for (const [folder, want] of [
  ['ANNOUNCEMENTS', 'open'],
  ['Open', 'open'],
  ['class-end', 'classEnd'],
  ['ClassEnd', 'classEnd'],
  ['close', 'classEnd'],
  ['Emergencies', 'emergency'],
  ['alarm', 'emergency'],
  ['Music', 'bgm'],
] as [string, string][]) {
  check(folder, classify('x', folder), want)
}

console.log('\nclassify(): loose files fall back to the filename')
for (const [name, want] of [
  ['bgm-1', 'bgm'],
  ['school_bgm_looped', 'bgm'],
  ['planetarium_music_01', 'bgm'],
  ['tone-test', 'tone'],
  ['random-recording', 'other'],
  ['bell-class', 'other'],
  ['open-th', 'other'],
] as [string, string][]) {
  check(name, classify(name, null), want)
}

console.log('\nnormaliseFolder()')
for (const [f, want] of [
  ['announcements', 'announcements'],
  ['Class-End', 'classend'],
  ['  Music  ', 'music'],
  ['my_folder-2', 'myfolder2'],
] as [string, string][]) {
  check(f, normaliseFolder(f), want)
}

console.log('\nisAudio()')
for (const [f, want] of [
  ['x.wav', true], ['x.mp3', true], ['x.WAV', true], ['x.ogg', true],
  ['x.m4a', true], ['x.flac', true],
  ['x.txt', false], ['plain', false], ['x.png', false], ['.wav', false],
] as [string, boolean][]) {
  check(f, isAudio(f), want)
}

console.log('\nstripExt()')
for (const [f, want] of [['a.wav', 'a'], ['a.b.mp3', 'a.b'], ['plain', 'plain'], ['mp3-output-ttsfree(dot)com_with_music', 'mp3-output-ttsfree(dot)com_with_music']] as [string, string][]) {
  check(f, stripExt(f), want)
}

console.log('\nREQUIRED slots')
// The end sound is defined but optional, so it is absent from REQUIRED.
check('required announcements', REQUIRED.length, 3)
check('close is optional', REQUIRED.some((r) => r.kind === 'close'), false)
check('close is in ANNOUNCEMENTS', ANNOUNCEMENTS.some((a) => a.kind === 'close'), true)
check('kinds unique', new Set(REQUIRED.map((r) => r.kind)).size, REQUIRED.length)
check(
  'kinds are a subset of ANNOUNCEMENTS',
  REQUIRED.every((r) => ANNOUNCEMENTS.some((a) => a.kind === r.kind)),
  true,
)
check(
  'folders come from ANNOUNCEMENTS',
  REQUIRED.every((r) => ANNOUNCEMENTS.some((a) => a.folder === r.folder)),
  true,
)

console.log(`\n${fail === 0 ? 'PASS' : `FAIL: ${fail} assertion(s)`}`)
process.exit(fail === 0 ? 0 : 1)
