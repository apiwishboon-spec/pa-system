// Cross-platform self-test launcher: sets PA_SELFTEST and runs the built app.
// Uses a scratch userData dir so it can run while the app is already open.
// Set PA_USERDATA=<path> to inspect a real installation instead.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import electronPath from 'electron'

const real = process.env.PA_USERDATA
const userDataDir = real ?? fs.mkdtempSync(path.join(os.tmpdir(), 'pa-selftest-'))

const r = spawnSync(electronPath, ['.', '--no-sandbox', `--user-data-dir=${userDataDir}`], {
  stdio: 'inherit',
  env: { ...process.env, PA_SELFTEST: '1' },
})

if (!real) fs.rmSync(userDataDir, { recursive: true, force: true })
process.exit(r.status ?? 1)
