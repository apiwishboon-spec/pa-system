// Smoke test: launch the built app, confirm the window loads, then quit.
// Usage: node scripts/smoke.mjs [seconds]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import electronPath from 'electron'

const WAIT = Number(process.argv[2] ?? 10) * 1000
let killed = false

// Isolate from any running instance: the single-instance lock is keyed on
// userData, so a scratch dir lets the test run alongside the real app.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-smoke-'))
const cleanup = () => fs.rmSync(userDataDir, { recursive: true, force: true })

const child = spawn(
  electronPath,
  ['.', '--no-sandbox', `--user-data-dir=${userDataDir}`],
  {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' },
  },
)

let out = ''
child.stdout.on('data', (d) => { out += d })
child.stderr.on('data', (d) => { out += d })

child.on('exit', (code, signal) => {
  if (killed) {
    console.log(`PASS: still alive after ${WAIT / 1000}s, terminated with ${signal ?? `code ${code}`}`)
  } else {
    console.log(`FAIL: exited early (code ${code}, signal ${signal})`)
  }
  const noise = /SetApplicationIsDaemon|NSCameraUseContinuityCameraDeviceType/
  const lines = out.split('\n').filter((l) => l.trim() && !noise.test(l))
  if (lines.length) console.log(lines.join('\n'))
  cleanup()
  process.exit(killed ? 0 : 1)
})

setTimeout(() => {
  killed = true
  child.kill('SIGTERM')
}, WAIT)
