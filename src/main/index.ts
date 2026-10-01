import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  powerSaveBlocker,
  screen,
  session,
  shell,
  Tray,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import AutoLaunch from 'auto-launch'
// electron-updater ships CommonJS, so a named ESM import fails at load time.
import electronUpdater from 'electron-updater'
import { isDev, rendererDir } from './env'
import { appendLog, flushSettings, loadSettings, saveSettings, settingsPath, tailLog } from './store'
import { handleMediaProtocol, registerSchemePrivileges, scanLibrary, bundledRoot, userRoot, toUrl } from './media'
import { Scheduler } from './scheduler'
import { isAudio, type FromMain, type Settings, type ToMain } from '../shared/types'

const { autoUpdater } = electronUpdater

registerSchemePrivileges()

/**
 * System-audio capture ("what you hear"). Electron exposes the render device
 * as a display source whose audio can be pulled in as loopback, which works on
 * Windows and on macOS 13+. The renderer asks for audio only, so the handler
 * can hand back loopback audio directly. Enumerating screen sources here
 * would be pointless and actively harmful: on macOS a missing Screen
 * Recording permission makes that call fail outright, and supplying a video
 * source that nobody asked for makes Electron throw "Video was requested, but
 * no video stream was provided".
 *
 * Note this captures EVERYTHING the system renders, including this app's own
 * announcements. The renderer warns about that and offers a device input as
 * the feedback-free alternative.
 */
function registerLoopbackCapture(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      callback({ audio: 'loopback' })
    },
    { useSystemPicker: false },
  )
}

let win: BrowserWindow | null = null
let settings: Settings = loadSettings()
let library = scanLibrary()
let blocker: number | null = null
let autoLauncher: AutoLaunch | null = null

const scheduler = new Scheduler(settings, {
  fire: (action, at) => {
    send({ type: 'cue', kind: action, source: 'schedule', at: at.getTime() })
    appendLog('info', `scheduled ${action}`)
  },
})

function send(msg: FromMain): void {
  if (win && !win.isDestroyed()) win.webContents.send('pa:msg', msg)
}

/**
 * Tray icon and background residency.
 *
 * A PA must keep announcing after the window is closed, so closing the window
 * hides to the tray instead of quitting. Quitting is only from the tray menu,
 * where it cannot happen by accident mid-announcement.
 */
let tray: Tray | null = null
let quitting = false

function trayIconPath(): string {
  // Prefer the @2x template so the menu bar icon stays crisp on Retina.
  // Candidates cover dev (project root), `electron out/main` runs, and the
  // packaged app (extraResources alongside the asar).
  const roots = isDev
    ? [app.getAppPath(), path.join(app.getAppPath(), '..'), process.cwd()]
    : [process.resourcesPath, path.join(process.resourcesPath, 'app.asar.unpacked')]
  const names = ['trayTemplate@2x.png', 'trayTemplate.png']
  for (const root of roots) {
    for (const name of names) {
      const p = path.join(root, 'build', name)
      if (fs.existsSync(p)) return p
    }
  }
  // Also try loose in resources, since extraResources strips the build/ folder.
  for (const root of roots) {
    for (const name of names) {
      const p = path.join(root, name)
      if (fs.existsSync(p)) return p
    }
  }
  return path.join(process.resourcesPath, 'trayTemplate@2x.png')
}

/**
 * Auto-update.
 *
 * Safe-by-default for a PA: a background check downloads the new installer but
 * never interrupts a running announcement. The update is applied on the next
 * clean quit (tray -> Quit, or a reboot), so the machine is never mid-install
 * while a bell or alarm could fire.
 *
 * macOS only accepts updates signed with a Developer ID certificate. An
 * unsigned build can never self-update, so the first failure there switches the
 * updater off instead of logging an error every hour.
 */
let updateDisabled = false

function setupAutoUpdate(): void {
  // Dev runs have no app-update.yml and no meaningful version to compare.
  if (!app.isPackaged || updateDisabled) {
    appendLog('info', 'autoupdate: not applicable to this run')
    return
  }

  const run = (): void => {
    if (updateDisabled) return
    void autoUpdater
      .checkForUpdatesAndNotify()
      .then((res) => {
        if (res?.updateInfo?.version) {
          appendLog('info', `autoupdate: ${res.updateInfo.version} available`)
        }
      })
      .catch((err: unknown) => {
        appendLog('warn', `autoupdate failed: ${String(err)}`)
        if (process.platform === 'darwin') {
          // Almost certainly an unsigned build. Stop retrying hourly.
          updateDisabled = true
          appendLog('warn', 'autoupdate disabled: macOS build is unsigned')
        }
      })
  }

  try {
    autoUpdater.autoDownload = true
    // Install on quit rather than yanking the app out from under the operator.
    autoUpdater.autoInstallOnAppQuit = true
    // Let the window come up and the first audio unlock settle first.
    setTimeout(run, 20_000)
    // Then hourly: one HTTP request against the release feed.
    setInterval(run, 60 * 60 * 1000)
  } catch (err) {
    updateDisabled = true
    appendLog('warn', `autoupdate unavailable: ${String(err)}`)
  }
}

function showWindow(): void {
  if (!win) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

function createTray(): void {
  if (tray) return
  const icon = trayIconPath()
  try {
    const img = nativeImage.createFromPath(icon)
    if (img.isEmpty()) throw new Error('icon did not load')
    // Template image on macOS so it follows light/dark menu bars.
    if (process.platform === 'darwin') img.setTemplateImage(true)
    tray = new Tray(img)
  } catch (err) {
    appendLog('error', `tray unavailable (${icon}): ${String(err)}`)
    return
  }
  tray.setToolTip('PA System')
  refreshTrayMenu()
  tray.on('click', () => showWindow())
}

function refreshTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'เปิด PA / Open PA', click: () => showWindow() },
      {
        label: 'หยุดชั่วคราว / Pause schedule',
        type: 'checkbox',
        checked: settings.schedulePaused === true,
        click: (item) => {
          // Reassign: scheduler.update() reads the in-memory copy, so saving
          // without updating it left the tray toggle looking broken.
          settings = saveSettings({ ...settings, schedulePaused: item.checked })
          scheduler.update(settings)
          appendLog('info', `schedule paused=${item.checked}`)
          refreshTrayMenu()
        },
      },
      { type: 'separator' },
      {
        label: 'ออกจากโปรแกรม / Quit',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
}

function createWindow(): void {
  const display = screen.getPrimaryDisplay().workAreaSize
  const w = new BrowserWindow({
    width: Math.min(1280, display.width),
    height: Math.min(800, display.height),
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    // Windows/Linux use the window icon; macOS takes the icon from the bundle.
    // Packaged builds ship build/icon.png as an extraResource, so it sits
    // beside the app rather than inside the asar where build.files excludes it.
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(app.getAppPath(), 'build', 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  win = w

  w.on('ready-to-show', () => {
    if (settings.fullscreen) w.setFullScreen(true)
    // Autostart at login should land in the tray, not in the operator's face.
    if (process.argv.includes('--hidden')) return
    w.show()
  })

  // Closing hides to the tray so scheduled announcements keep working. On
  // macOS the red button normally quits, which would stop the PA entirely.
  w.on('close', (e) => {
    if (quitting || tray === null) return
    e.preventDefault()
    w.hide()
    appendLog('info', 'window hidden to tray')
  })
  w.on('show', () => appendLog('info', 'window shown'))

  // Block navigation and popups: this is a kiosk-style console.
  w.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e) => e.preventDefault())

  if (isDev) {
    void w.loadFile(path.join(rendererDir(), 'index.html'))
    w.webContents.openDevTools({ mode: 'detach' })
  } else {
    void w.loadFile(path.join(app.getAppPath(), 'out/renderer/index.html'))
  }

  // A silent renderer failure looks like "nothing happens" on a kiosk PC, so
  // make both cases visible in the log.
  w.webContents.on('did-fail-load', (_e, code, desc, url) => {
    appendLog('error', `did-fail-load ${code} ${desc} ${url}`)
  })
  w.webContents.on('preload-error', (_e, preloadPath, err) => {
    appendLog('error', `preload-error ${preloadPath} ${String(err)}`)
  })
  w.webContents.on('render-process-gone', (_e, details) => {
    appendLog('error', `render-process-gone ${details.reason} (${details.exitCode})`)
  })
  w.webContents.on('did-finish-load', () => {
    appendLog('info', 'renderer loaded')
  })
}

function ensureDirs(): void {
  // The writable media tree and logs live under userData so the app works
  // from an installed location without admin rights.
  for (const d of [userRoot(), path.join(app.getPath('userData'), 'logs')]) {
    fs.mkdirSync(d, { recursive: true })
  }
}

function applyAutostart(): void {
  // isHiddenOnLaunch makes the login item pass --hidden, so a boot-time launch
  // lands in the tray instead of covering the screen mid-lesson.
  autoLauncher ??= new AutoLaunch({ name: 'PA System', isHidden: true })
  const launcher = autoLauncher
  const want = settings.autostart
  // auto-launch v5 is promise-based.
  void launcher
    .isEnabled()
    .then((enabled) => {
      if (enabled === want) return
      return want ? launcher.enable() : launcher.disable()
    })
    .catch((err) => appendLog('warn', `autostart: ${String(err)}`))
}

function pushSettings(): void {
  send({ type: 'settings', settings })
}

function pushLibrary(): void {
  library = scanLibrary()
  send({ type: 'library', library })
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle('pa:settings:get', () => settings)

ipcMain.handle('pa:settings:save', (_e, patch: Partial<Settings>) => {
  const prev = settings
  settings = saveSettings({ ...settings, ...patch })

  // Only the fields that actually matter to these are re-run. Doing this on
  // every slider tick would spawn a login-item query per pixel of drag.
  if (patch.autostart !== undefined && patch.autostart !== prev.autostart) {
    applyAutostart()
  }
  if (
    patch.openTime !== undefined ||
    patch.classEndTimes !== undefined ||
    patch.fullscreen !== undefined
  ) {
    scheduler.update(settings)
  }
  pushSettings()
  return settings
})

ipcMain.handle('pa:log', (_e, level: 'info' | 'warn' | 'error', message: string) => {
  appendLog(level, message)
  win?.webContents.send('pa:msg', { type: 'log', level, message, at: Date.now() })
})

ipcMain.handle('pa:logs:recent', () => tailLog())

ipcMain.handle('pa:logs:reveal', () => {
  const dir = path.join(app.getPath('userData'), 'logs')
  fs.mkdirSync(dir, { recursive: true })
  shell.openPath(dir)
})

ipcMain.handle('pa:library:get', () => library)

ipcMain.handle('pa:library:rescan', () => {
  pushLibrary()
  return library
})

ipcMain.handle('pa:media:open-folder', () => {
  void shell.openPath(userRoot())
  return userRoot()
})

/**
 * Let the operator add background music without touching the filesystem.
 * Copies the chosen files into userData/media/music so the installed app stays
 * writable without admin rights, then rescans.
 */
ipcMain.handle('pa:media:import-music', async () => {
  if (!win) return { added: [], error: 'no window' }
  const picked = await dialog.showOpenDialog(win, {
    title: 'เลือกเพลงพื้นหลัง / Choose background music',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'aac', 'flac'] }],
  })
  if (picked.canceled || picked.filePaths.length === 0) return { added: [], error: null }

  const dest = path.join(userRoot(), 'music')
  // The user media root is created at startup but the music folder is not, so
  // the first-ever import would fail with ENOENT on copy.
  fs.mkdirSync(dest, { recursive: true })
  const added: string[] = []
  const failures: string[] = []
  for (const src of picked.filePaths) {
    const base = path.basename(src)
    // The library scanner skips dotfiles, so importing one would create a file
    // the app can never see.
    if (base.startsWith('.') || !isAudio(base)) {
      appendLog('warn', `import skipped, not audio: ${base}`)
      continue
    }
    const ext = path.extname(src).toLowerCase()
    // Suffix with a counter so importing the same track twice does not silently
    // overwrite the copy already playing.
    let name = `${path.basename(src, ext)}${ext}`
    let n = 2
    while (fs.existsSync(path.join(dest, name))) name = `${path.basename(src, ext)}-${n++}${ext}`
    try {
      fs.copyFileSync(src, path.join(dest, name))
      added.push(name)
      appendLog('info', `imported music ${name}`)
    } catch (err) {
      failures.push(base)
      appendLog('error', `import failed ${src}: ${String(err)}`)
    }
  }
  pushLibrary()
  const skipped = picked.filePaths.length - added.length
  return {
    added,
    error: null,
    skipped,
    message:
      added.length === 0 && skipped > 0
        ? failures.length > 0
          ? `คัดลอกไฟล์ไม่สำเร็จ — ${failures[0]}`
          : 'ไม่มีไฟล์เสียงที่รองรับ — No supported audio files were selected'
        : null,
  }
})

ipcMain.handle('pa:app:version', () => app.getVersion())

ipcMain.on('pa:msg', (_e, msg: ToMain) => {
  switch (msg.type) {
    case 'library-rescan':
      pushLibrary()
      break
    case 'settings-save':
      settings = saveSettings({ ...settings, ...msg.patch })
      scheduler.update(settings)
      applyAutostart()
      pushSettings()
      break
    case 'reveal-media':
      void shell.openPath(userRoot())
      break
    case 'play':
    case 'emergency-stop':
    case 'bgm-set':
      // Playback is owned by the renderer audio engine; main only mirrors to
      // the log so a crash leaves a trace of what was triggered.
      appendLog('info', `cue ${msg.type}${msg.type === 'play' ? ` ${msg.kind}` : ''}`)
      break
  }
})

/**
 * Field diagnosis without devtools: `npm run selftest` prints the resolved
 * media paths, what the library scanner found, and what is still missing.
 */
async function runSelfTest(): Promise<void> {
  const bundled = bundledRoot()
  const user = userRoot()
  const lib = scanLibrary()
  let rendererOk = true

  console.log(`\nPA System self-test`)
  console.log(`  version      ${app.getVersion()}`)
  console.log(`  electron     ${process.versions.electron}`)
  console.log(`  platform     ${process.platform}`)
  console.log(`  appPath      ${app.getAppPath()}`)
  console.log(`  userData     ${app.getPath('userData')}`)
  console.log(`  bundledMedia ${bundled} (exists: ${fs.existsSync(bundled)})`)
  console.log(`  userMedia    ${user} (exists: ${fs.existsSync(user)})`)
  console.log(`  settings     ${settingsPath()} (exists: ${fs.existsSync(settingsPath())})`)
  console.log(`  autostart    ${settings.autostart}`)

  console.log(`\n  library (${lib.files.length} file${lib.files.length === 1 ? '' : 's'})`)
  for (const f of lib.files) {
    console.log(
      `    ${f.kind.padEnd(10)} ${`${f.folder}/`.padEnd(14)} ${f.name.padEnd(34)} ${String(f.bytes).padStart(8)} B${f.placeholder ? '  [bundled]' : ''}`,
    )
  }

  console.log(`\n  missing (${lib.missing.length})`)
  for (const m of lib.missing) console.log(`    ${m.label}  ->  put a file in ${m.folder}/`)

  // End-to-end check of the custom protocol the renderer uses to load audio.
  console.log('\n  media protocol')
  let protoOk = true
  for (const f of lib.files.slice(0, 3)) {
    try {
      const res = await net.fetch(f.url)
      const body = await res.arrayBuffer()
      const ok = res.ok && body.byteLength === f.bytes
      if (!ok) protoOk = false
      console.log(`    ${ok ? 'ok  ' : 'FAIL'} GET ${f.name} -> ${res.status}, ${body.byteLength} B (expected ${f.bytes})`)
    } catch (err) {
      protoOk = false
      console.log(`    FAIL GET ${f.name} -> ${String(err)}`)
    }
  }
  // Traversal attempts must be refused.
  for (const evil of ['/etc/passwd', path.join(bundled, '../../../../etc/hosts')]) {
    const res = await net.fetch(toUrl(evil))
    const blocked = res.status === 403 || res.status === 404
    if (!blocked) protoOk = false
    console.log(`    ${blocked ? 'ok  ' : 'FAIL'} blocked ${evil} -> ${res.status}`)
  }

  // The main-process fetch above cannot see the renderer's Content Security
  // Policy, and the renderer is what actually plays audio. Load a real window
  // and decode through the page so a CSP or scheme regression fails here
  // instead of silently producing a mute app.
  console.log('\n  renderer playback (CSP + decode)')
  const w = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  try {
    const target = isDev
      ? `file://${path.join(rendererDir(), 'index.html')}`
      : `file://${path.join(app.getAppPath(), 'out/renderer/index.html')}`
    await w.loadURL(target)
    for (const f of lib.files) {
      const res = (await w.webContents.executeJavaScript(`
        (async () => {
          try {
            const r = await fetch(${JSON.stringify(f.url)})
            if (!r.ok) return 'HTTP ' + r.status
            const b = await r.arrayBuffer()
            return 'ok ' + b.byteLength
          } catch (e) { return 'error ' + String(e) }
        })()
      `)) as string
      const ok = res.startsWith('ok ') && res.slice(3) === String(f.bytes)
      if (!ok) rendererOk = false
      console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${f.name} -> ${res} (expected ${f.bytes})`)
    }
  } catch (err) {
    rendererOk = false
    console.log(`    FAIL renderer could not be loaded: ${String(err)}`)
  } finally {
    w.destroy()
  }

  const bad = lib.missing.length > 0
  console.log(`\n  ${bad ? 'INCOMPLETE - app will still run using placeholders' : 'COMPLETE - every required slot has audio'}`)
  console.log(`  ${protoOk ? 'media protocol OK' : 'MEDIA PROTOCOL HAS PROBLEMS'}`)
  console.log(`  ${rendererOk ? 'renderer can load all media' : 'RENDERER CANNOT LOAD MEDIA (check CSP connect-src)'}\n`)
  app.exit(bad || !protoOk || !rendererOk ? 2 : 0)
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showWindow()
  })

  void app.whenReady().then(() => {
    ensureDirs()
    if (process.env.PA_SELFTEST === '1') {
      handleMediaProtocol()
      void runSelfTest()
      return
    }
    handleMediaProtocol()
    registerLoopbackCapture()
    applyAutostart()
    // Never let the planetarium PC sleep mid-announcement.
    blocker = powerSaveBlocker.start('prevent-app-suspension')
    createTray()
    createWindow()
    scheduler.start()
    setupAutoUpdate()
    // Stay in the tray rather than the Dock when launched by the scheduler, but
    // only if the tray really came up: hiding the Dock with no tray icon would
    // leave the app running with no way to reach its window.
    if (tray !== null && app.dock) app.dock.hide()
    appendLog('info', `app start ${app.getVersion()}`)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      showWindow()
    })
  })
}

// With a tray icon present the app stays resident, so closing every window is
// not a quit request. Only the tray's Quit, or a real shutdown, ends it.
app.on('window-all-closed', () => {
  if (tray === null) app.quit()
})

app.on('before-quit', () => {
  quitting = true
  scheduler.stop()
  flushSettings()
  if (blocker) powerSaveBlocker.stop(blocker)
  tray?.destroy()
  tray = null
})
