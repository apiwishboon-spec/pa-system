import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { engine, AudioEngine, type ToneKind } from './audio/engine'
import { Console, NowPlaying } from './components/Console'
import { Dashboard, type LogLine } from './components/Dashboard'
import { InputPanel } from './components/InputPanel'
import { MusicPanel } from './components/MusicPanel'
import { SchedulePanel } from './components/SchedulePanel'
import { SettingsPanel } from './components/SettingsPanel'
import type { AnnouncementKind, FromMain, Library, OutputDevice, Settings } from '@shared/types'

type Tab = 'dash' | 'input' | 'music' | 'schedule' | 'settings'

const EMPTY: Library = { files: [], missing: [], scannedAt: 0 }

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [library, setLibrary] = useState<Library>(EMPTY)
  const [devices, setDevices] = useState<OutputDevice[]>([])
  const [tab, setTab] = useState<Tab>('dash')
  const [nowPlaying, setNowPlaying] = useState<string | null>(null)
  const [emergencyOn, setEmergencyOn] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [toneOn, setToneOn] = useState(false)
  const [toneKind, setToneKind] = useState<ToneKind>('interval')
  const toneKindRef = useRef<ToneKind>('interval')
  const [clock, setClock] = useState(() => new Date())
  const [banner, setBanner] = useState<string | null>(null)
  const [sinkFailed, setSinkFailed] = useState(false)
  const [version, setVersion] = useState('')
  const [logs, setLogs] = useState<LogLine[]>([])
  const emergencyRef = useRef(false)
  const speakRef = useRef(false)

  // --- initial load -------------------------------------------------------
  useEffect(() => {
    let alive = true
    void (async () => {
      const [s, l, v, recent] = await Promise.all([
        window.pa.getSettings(),
        window.pa.getLibrary(),
        window.pa.getVersion(),
        window.pa.getLogs(),
      ])
      if (!alive) return
      setSettings(s)
      setLibrary(l)
      setVersion(v)
      setLogs(recent)
      setDevices(await AudioEngine.listOutputs())
    })()
    return () => {
      alive = false
    }
  }, [])

  // --- settings/library changes reach the audio engine --------------------
  useEffect(() => {
    if (settings && library) engine.attach(library, settings)
  }, [settings, library])

  useEffect(() => {
    if (settings) engine.applyVolumes()
  }, [settings])

  // Stop any live capture when the window goes away, so the OS recording
  // indicator does not stay lit after the app quits.
  useEffect(() => {
    return () => engine.stopInput()
  }, [])

  // --- clock --------------------------------------------------------------
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // --- messages from main (scheduler, etc.) -------------------------------
  // Held in a ref so the subscription is installed once and never sees a
  // stale settings snapshot.
  const runCueRef = useRef<(kind: AnnouncementKind, manual: boolean) => void>(() => {})
  const flashRef = useRef<(text: string) => void>(() => {})

  useEffect(() => {
    return window.pa.on((msg: FromMain) => {
      if (msg.type === 'settings') setSettings(msg.settings)
      else if (msg.type === 'library') setLibrary(msg.library)
      else if (msg.type === 'devices') setDevices(msg.devices)
      else if (msg.type === 'log') {
        // Bounded: a long shift should not grow this without limit.
        setLogs((prev) => [...prev, { level: msg.level, message: msg.message, at: msg.at }].slice(-200))
      }
      else if (msg.type === 'cue') {
        if (msg.kind === 'open' || msg.kind === 'classEnd' || msg.kind === 'emergency') {
          void runCueRef.current(msg.kind, msg.source === 'manual')
        }
      }
      else if (msg.type === 'emergency-stop') {
        engine.stopEmergency()
        emergencyRef.current = false
        setEmergencyOn(false)
        flashRef.current('หยุดเสียงฉุกเฉินแล้ว — All clear')
      }
    })
  }, [])

  const flash = useCallback((text: string) => {
    setBanner(text)
    setTimeout(() => setBanner((b) => (b === text ? null : b)), 4000)
  }, [])

  useEffect(() => {
    flashRef.current = flash
  }, [flash])

  // --- cue playback -------------------------------------------------------
  const runCue = useCallback(
    async (kind: AnnouncementKind | 'tone', manual = true) => {
      if (!settings) return
      const ok = await engine.unlock()
      if (!ok) {
        flash('ยังเปิดเสียงไม่ได้ — กดที่หน้าจออีกครั้ง')
        return
      }

      if (kind === 'tone') {
        // Synthesised, not a file: toggles on and off from one control.
        if (engine.toneActive) {
          engine.stopTone()
          setToneOn(false)
          setNowPlaying(null)
          flash('หยุดเสียงทดสอบแล้ว')
          return
        }
        await engine.startTone(toneKindRef.current)
        setToneOn(true)
        flash(
          toneKindRef.current === 'beep'
            ? 'เสียงทดสอบ 1 kHz — กดอีกครั้งเพื่อหยุด'
            : 'เสียงห้องพัก be-beep-beep — กดอีกครั้งเพื่อหยุด',
        )
        return
      }

      if (kind === 'emergency') {
        const file = engine.find('emergency', settings.cueFiles.emergency)
        if (!file) return flash('ไม่พบไฟล์ในโฟลเดอร์ emergency')
        const started = await engine.startEmergency(file)
        emergencyRef.current = started
        setEmergencyOn(started)
        window.pa.play('emergency')
        if (started) flash('เริ่มเสียงฉุกเฉิน — กดอีกครั้งเพื่อหยุด')
        return
      }

      if (kind === 'open' && manual) {
        // Starting: chime for attention, then hold the music down. Only a
        // manual press holds, so a scheduled open cannot latch the app.
        if (speakRef.current) {
          speakRef.current = false
          setSpeaking(false)
          // Play the end sound before lifting the duck, so it is heard over
          // the quiet music and then the music returns at full level.
          const end = engine.find('close', settings.cueFiles.close)
          if (end) {
            await engine.play(end, () => setNowPlaying(null))
            setNowPlaying(end.name)
          }
          engine.setSpeakMode(false)
          window.pa.play('close')
          flash(end ? 'จบการประกาศแล้ว — เพลงกลับมาระดับเดิม' : 'จบการประกาศแล้ว — เพลงกลับมาระดับเดิม')
          return
        }
        const chime = engine.find('open', settings.cueFiles.open)
        if (chime) {
          await engine.play(chime, () => setNowPlaying(null))
          setNowPlaying(chime.name)
        }
        window.pa.play('open')
        speakRef.current = true
        setSpeaking(true)
        engine.setSpeakMode(true)
        flash('เริ่มประกาศ — พูดได้เลย / กดอีกครั้งเมื่อพูดจบ')
        return
      }

      const file = engine.find(kind, settings.cueFiles[kind])
      if (!file) {
        const folder = kind === 'open' ? 'announcements' : 'bells'
        return flash(`ไม่พบไฟล์ในโฟลเดอร์ ${folder} — ใส่ไฟล์แล้วกด Rescan`)
      }
      const dur = await engine.play(file, () => setNowPlaying(null))
      if (dur == null) return flash(`เล่น ${file.name} ไม่สำเร็จ`)
      setNowPlaying(file.name)
      window.pa.play(kind)
    },
    [settings, flash],
  )

  useEffect(() => {
    runCueRef.current = runCue
  }, [runCue])

  // Escape is the fastest way to end a long announcement from the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return
        if (engine.toneActive) {
          engine.stopTone()
          setToneOn(false)
          flash('หยุดเสียงทดสอบแล้ว')
          return
        }
        if (speakRef.current) {
          speakRef.current = false
          setSpeaking(false)
          const end = engine.find('close')
          if (end) {
            void engine.play(end, () => setNowPlaying(null))
            setNowPlaying(end.name)
          }
          engine.setSpeakMode(false)
          flash('จบการประกาศแล้ว — เพลงกลับมาระดับเดิม')
        }
      }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flash])

  const toggleEmergency = useCallback(() => {
    if (emergencyRef.current) {
      engine.stopEmergency()
      emergencyRef.current = false
      setEmergencyOn(false)
      window.pa.stopEmergency()
      flash('หยุดเสียงฉุกเฉินแล้ว — All clear')
    } else {
      void runCue('emergency')
    }
  }, [runCue, flash])

  const patch = useCallback((p: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...p } : prev))
    void window.pa.saveSettings(p)
  }, [])

  const chooseDevice = useCallback(
    async (id: string | null) => {
      const ok = await engine.setOutputDevice(id)
      setSinkFailed(!ok)
      patch({ outputDeviceId: id })
      flash(ok ? 'เปลี่ยนอุปกรณ์เสียงแล้ว' : 'เลือกอุปกรณ์ไม่ได้ — ใช้ค่าเริ่มต้นของ Windows')
    },
    [patch, flash],
  )

  const rescan = useCallback(() => {
    window.pa.rescan()
    void window.pa.getLibrary().then(setLibrary)
  }, [])

  const missing = useMemo(() => library.missing, [library])
  const missingKinds = useMemo(() => library.missing.map((m) => m.kind), [library])

  if (!settings) {
    return <div className="boot">กำลังโหลด…</div>
  }

  return (
    <div className="app" onPointerDown={() => void engine.unlock()}>
      <header>
        <div className="brand">
          <strong>PA System</strong>
          <span className="ver">v{version}</span>
        </div>
        <NowPlaying name={nowPlaying} />
        <div className="clock">
          {clock.toLocaleTimeString('th-TH', { hour12: false })}
        </div>
      </header>

      {speaking && <div className="alarm-strip speak">กำลังประกาศ — พูดได้เลย / กด PA จบ เมื่อพูดจบ (Esc)</div>}
      {emergencyOn && <div className="alarm-strip">EMERGENCY ON — กดปุ่มฉุกเฉินเพื่อหยุด</div>}
      {banner && <div className="banner">{banner}</div>}

      {missing.length > 0 && (
        <div className="missing">
          <strong>ยังขาดไฟล์ ({missing.length}):</strong>{' '}
          {missing.map((m) => m.label).join(' · ')}
        </div>
      )}

      <Console
        emergencyOn={emergencyOn}
        speaking={speaking}
        missing={missingKinds}
        onCue={(k) => void runCue(k)}
        onToggleEmergency={toggleEmergency}
        onToggleSpeak={() => void runCue('open')}
      />

      <nav className="tabs">
        {(
          [
            ['dash', 'ภาพรวม Dashboard'],
            ['input', 'เสียงเข้า Input'],
            ['music', 'เพลง Music'],
            ['schedule', 'ตารางเวลา Schedule'],
            ['settings', 'ตั้งค่า Settings'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} className={`tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'dash' && settings && (
          <Dashboard
            settings={settings}
            library={library}
            nowPlaying={nowPlaying}
            speaking={speaking}
            emergencyOn={emergencyOn}
            toneOn={toneOn}
            schedulePaused={settings.schedulePaused}
            bgmOn={settings.bgmEnabled && settings.bgmTrack !== null}
            inputLabel={
              settings.inputKind === 'off'
                ? 'ไม่ได้ต่อ (off)'
                : settings.inputKind === 'loopback'
                  ? 'เสียงระบบ (system)'
                  : 'อุปกรณ์ (device)'
            }
            onGo={setTab}
            logs={logs}
          />
        )}
        {tab === 'input' && (
          <InputPanel
            settings={settings}
            onPatch={patch}
            outputDeviceId={settings.outputDeviceId}
          />
        )}
        {tab === 'music' && <MusicPanel library={library} settings={settings} onPatch={patch} />}
        {tab === 'schedule' && <SchedulePanel settings={settings} onPatch={patch} />}
        {tab === 'settings' && (
          <SettingsPanel
            settings={settings}
            library={library}
            devices={devices}
            onPatch={patch}
            onRescan={rescan}
            onOpenFolder={() => window.pa.revealMedia()}
            onDevice={(id) => void chooseDevice(id)}
            onTest={() => void runCue('tone')}
            toneOn={toneOn}
            toneKind={toneKind}
            onToneKind={(k) => {
              setToneKind(k)
              toneKindRef.current = k
            }}
            sinkFailed={sinkFailed}
          />
        )}
      </main>

      <footer className="foot">
        <span className="foot-school">
          Sirindhorn Planetarium Suankularb Wittayalai School
        </span>
        <span className="foot-meta">
          PA System v{version} &middot; &copy; 2026 Apiwish Anutaravanichkul &middot; MIT License
        </span>
      </footer>
    </div>
  )
}
