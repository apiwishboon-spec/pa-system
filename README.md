# PA System

**Offline school public-address system for Windows and macOS.**

Live announcements, scheduled bells, emergency alerts, background music, and
system-audio input — from one tray-resident desktop app that works without a
network connection.

Copyright © 2026 **Apiwish Anutaravanichkul**. Released under the
[MIT License](LICENSE).

---

## Features

| | |
|---|---|
| **Live announcements** | Push-to-talk PA with automatic audio ducking and an end-of-announcement sound |
| **Scheduled bells** | Per-weekday bell times with optional fullscreen takeover mode |
| **Emergency alerts** | Dedicated panic button with a blocking, non-interruptible cue |
| **Background music** | MP3 library that ducks automatically under every announcement |
| **TV test tone** | Steady 1 kHz beep or repeating `beep-beep-beep` interval signal |
| **System audio input** | Capture any application, or a line-in/microphone device, as the PA source |
| **Background operation** | Closes to the menu-bar/system tray, keeps the schedule running |
| **Auto-update** | Checks GitHub Releases hourly, installs on next quit |
| **Start at login** | Launches hidden to the tray so a schedule survives a reboot |

### Audio behaviour

Every announcement applies **ducking**: background music and the input source
are faded down rather than cut, then restored afterwards. All fades are
click-free, and the system applies `gain` automation over a short ramp so
there is no zipper noise.

Duck amount is adjustable in **Settings → BGM**, and can be turned off entirely
to hard-cut instead.

### Volume controls

Each sound class has its own trim in **Settings → Volume**, because a single
level never suits everything:

| Control | Applies to | Default |
|---|---|---|
| Master (รวม) | everything | 0.9 |
| Announcement (ประกาศ) | the bell and scheduled cues | 1.0 |
| PA Start / Finish chime | the `open` / `close` stings | 0.55 |
| Emergency (ฉุกเฉิน) | the panic alert | 0.8 |
| Background music | the music bus | 0.35 |
| Duck | how far music drops under a cue | 0.85 |

The chime gets its own control on purpose. PA Start and PA Finish are short
stings with a high peak level, so at the same nominal level as speech they
read as much louder. If they are still too loud, lower the chime slider rather
than the announcement slider, which would also soften the bell.

---

## Installation

### Windows

Download `PA-System-Setup-<version>.exe` from the
[Releases page](https://github.com/apiwishboon-spec/pa-system/releases) and run
it. The installer is per-user, so no administrator rights are required.

> **Windows SmartScreen warning.** Releases are not code-signed, so Windows will
> show "Windows protected your PC". Choose **More info → Run anyway**. There is
> no publisher name to check, so verify the release comes from this repository.

### macOS

macOS blocks self-update on unsigned apps, so updates are handled by a small
install script that always fetches the newest release for you:

```bash
curl -fsSL https://raw.githubusercontent.com/apiwishboon-spec/pa-system/main/install-macos.sh | bash
```

It finds the latest version on GitHub, downloads it, quits any running copy,
replaces the app in `/Applications`, clears the quarantine flag, and offers to
reopen it. Re-run it whenever you want to update — there is no version number
to look up.

You can also download the `.dmg` from the
[Releases page](https://github.com/apiwishboon-spec/pa-system/releases) and drag
the app to **Applications** by hand.

Nothing is ever uninstalled: settings, schedules and your music library live in
`~/Library/Application Support/pa-system` and are not touched by an update.

> **Why not true auto-update?** macOS only lets a signed, notarized app replace
> itself. PA System is unsigned, so this script stands in for the in-app
> updater. Windows installs auto-update with no help at all.

---

## Quick start

1. Launch PA System. It appears in the menu bar / system tray.
2. Open **Settings** and pick your audio output device if you have more than one.
3. Go to the **Input** tab and choose your source:
   - **System sound** — captures everything the machine plays (whole device)
   - **Device** — a line-in or microphone
4. Press **PA Start** (or hold `Space`) to speak. Press **PA Finish** (or `Esc`)
   to play the end sound and restore the music.

Closing the window with the `✕` button does **not** quit — it hides to the tray.
Use the tray menu to reopen, pause the schedule, or quit.

---

## Media library

Audio lives in two places, and the app merges them:

- `media/library/` — **bundled** with the app, read-only, shipped in the package
- `<userData>/media/` — **yours**, editable, where the Music tab imports files

On Windows `<userData>` is `%APPDATA%\pa-system`; on macOS it is
`~/Library/Application Support/pa-system`.

### Layout and meaning

Folder name determines the role. **Filenames do not matter.**

```
media/library/
├── announcements/     PA Start / end / other spoken announcements
│   ├── open.mp3       → played on PA Start
│   └── end.mp3        → played on PA Finish (added by you, not the app)
├── bells/             scheduled bell chimes
│   └── bell.mp3       → scheduled cues
├── emergency/         emergency alert
│   └── emergency.mp3  → panic button
└── music/             background music
    └── *.mp3          → BGM tracklist
```

### Announcement close aliases

The closing sound is found by name, so you can rename `end.mp3` to any of:

```
end   close   finish   finished   stop
bye   goodbye   out   dismiss   done
```

Files starting with `end-`, `close-` or `finish-` also work, which is how
`end-th.mp3` and `end-en.mp3` can select a language:

```
end.mp3          default closing sound
end-th.mp3       closing sound, Thai
end-en.mp3       closing sound, English
```

Required slots are verified at build and test time. **`end.mp3` is optional** —
if no closing sound matches, PA Finish simply ends without one.

---

## Auto-update

PA System checks [GitHub Releases](https://github.com/apiwishboon-spec/pa-system/releases)
every hour and **downloads in the background**.

Updates are **never installed mid-announcement**. The download completes
silently and the new version is applied on your next clean quit — from the tray
menu, or at the next reboot. The app is never taken out from under a bell.

Current version is shown in the app footer, and every check is written to the
log so it can be verified:

```
autoupdate: 0.3.0 available
autoupdate failed: ...
```

A failed check on an unsigned macOS build disables the updater permanently
rather than retrying hourly. On macOS, use `install-macos.sh` instead.

### One command to update on macOS

`install-macos.sh` is the whole installer. It is also safe to run when you are
already on the latest version — it detects that and does nothing.

```bash
# check only, change nothing
curl -fsSL https://raw.githubusercontent.com/apiwishboon-spec/pa-system/main/install-macos.sh -o pa-install.sh
bash pa-install.sh
```

To install somewhere other than `/Applications` (useful for testing):

```bash
PA_INSTALL_DIR="$HOME/Applications" bash pa-install.sh
```

### Releasing a new version

```bash
npm version patch          # or minor / major
npm run dist               # builds the Windows installer + update metadata
```

Push the tag. The [release workflow](.github/workflows/release.yml) then runs
the full test suite, builds both installers, and publishes everything:

```bash
git tag v0.3.0 && git push origin v0.3.0
```

Three files are required on the Release. `latest.yml` is the manifest that
tells installed copies a newer version exists; the `.blockmap` enables partial
downloads; the `.exe` is the installer. Uploading only the `.exe` will not
trigger an update.

To publish by hand instead:

```bash
npm run dist
gh release create v0.3.0 \
  release/PA-System-Setup-0.3.0.exe \
  release/PA-System-Setup-0.3.0.exe.blockmap \
  release/latest.yml \
  --generate-notes
```

---

## Development

```bash
npm install
npm run dev
```

| Command | Purpose |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm run build` | Compile main, preload and renderer to `out/` |
| `npm run typecheck` | Type-check both TS projects |
| `npm run verify:media` | Validate media layout and required slots |
| `npm run selftest` | Headless renderer + audio self-test |
| `npm run smoke` | Launch the built app and confirm it stays alive |
| `npm run dist` | Build the Windows NSIS installer |

`selftest` and `smoke` run against a **temporary userData directory**, so they
never touch your real settings or media library.

### Requirements

- Node.js 20+
- macOS 13+ for system-audio capture

---

## System-audio caveats

**System sound** capture records the *entire output device*, not one app. It
cannot be scoped to a single application.

This means the PA hears itself. If the announcement output and the capture
device are the same, you get feedback or echo. The app warns about this in the
Input tab. To avoid it, either:

- use a **line-in** source and route announcements to a separate output device,
  or
- use headphones so the PA is not in the acoustic path.

### Permissions

| Platform | Permission | Notes |
|---|---|---|
| macOS | Screen Recording | Required. Restart the app **after** granting it. |
| Windows | None | Uses the WASAPI loopback path. |

On macOS the permission must be granted to the app in **System Settings →
Privacy & Security → Screen Recording**.

---

## Project structure

```
src/
├── main/            Electron main process
│   ├── index.ts       lifecycle, tray, media import, input capture, auto-update
│   ├── media.ts       library scanning + pa-media:// protocol
│   ├── scheduler.ts   timed bell/announcement cues
│   ├── store.ts       settings persistence (debounced writes)
│   └── env.ts         dev vs packaged paths
├── preload/         contextBridge API surface
├── renderer/        React UI
│   ├── audio/engine.ts   Web Audio graph, buses, ducking, tones
│   └── components/       Console, Music, Schedule, Settings, Input panels
└── shared/types.ts  IPC contract shared by both processes

build/              icon.png, icon.icns, trayTemplate*.png
media/library/      bundled audio
scripts/            verify-media, selftest, smoke
install-macos.sh    one-command macOS install and update
```

### Architecture notes

- **Security.** `contextIsolation` on, `nodeIntegration` off. The renderer
  reaches the filesystem only through a narrow preload API and a registered
  `pa-media://` scheme instead of raw file paths.
- **Audio.** One `AudioContext` with separate buses for music, cues and input.
  Ducking is a `GainNode` ramp, not a restart, so playback never glitches.
- **Settings.** Writes are debounced to keep slider drags smooth, then flushed
  synchronously on quit so nothing is lost.

---

## Frequently asked

**The PA echoes or squeals.**
The input source is hearing the PA output. Use headphones, or separate the
capture and output devices. See [System-audio caveats](#system-audio-caveats).

**Nothing is capturable / no device shows up.**
Grant Screen Recording on macOS and **fully restart** the app afterwards.
Permission changes do not apply to a running process.

**Music is not playing.**
The Music tab must be switched on *and* have a track selected. Enabling music
with an empty library shows a warning instead of silently doing nothing.

**I closed the window and the schedule stopped.**
It should not — closing hides to the tray. Confirm a tray icon is present, and
check **Settings → Start at login** if you need it to survive a reboot.

**The schedule paused itself.**
The tray menu can pause the schedule to stop bells while the room is in use.

---

## Contributing

Issues and pull requests are welcome. Please include your OS, app version
(**Settings → About**) and the relevant log from:

- Windows: `%APPDATA%\pa-system\logs`
- macOS: `~/Library/Application Support/pa-system/logs`

Logs are plain text and safe to attach.

When changing anything audio-related, run `npm run typecheck`, `npm run
verify:media` and `npm run selftest` first.

---

## License

MIT © 2026 Apiwish Anutaravanichkul — see [LICENSE](LICENSE).

The PA System name, logo and bundled media are the property of their
respective owners. Bundled audio in `media/library/` is included for
convenience; replace it with your own recordings before using this in a real
deployment.
---

## Repository layout on GitHub

```
main/          source, MIT licensed
Actions/       CI runs verify + build on every push and PR
Releases/      installers and update metadata, one release per version
Issues         bug reports and feature requests
```

Releases are produced by CI from a version tag, not from a local machine, so
every published artifact is reproducible and tested.
