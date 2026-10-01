import { useEffect, useState } from 'react'
import { engine } from '../audio/engine'
import type { Library, LibraryFile, Settings } from '@shared/types'

interface Props {
  library: Library
  settings: Settings
  onPatch: (patch: Partial<Settings>) => void
}

export function MusicPanel({ library, settings, onPatch }: Props) {
  const tracks = library.files.filter((f) => f.kind === 'bgm')
  const [on, setOn] = useState(settings.bgmEnabled)
  const [track, setTrack] = useState<string | null>(settings.bgmTrack)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setOn(settings.bgmEnabled), [settings.bgmEnabled])
  useEffect(() => setTrack(settings.bgmTrack), [settings.bgmTrack])

  useEffect(() => {
    if (!on || !track) {
      void engine.setBgm(null)
      return
    }
    let file = library.files.find((f) => f.name === track) ?? null
    if (!file) {
      // The saved track is gone (deleted or renamed). Fall back to whatever
      // is available rather than going silently mute with BGM switched on.
      file = tracks[0] ?? null
      if (file) {
        setTrack(file.name)
        onPatch({ bgmTrack: file.name })
      }
    }
    void engine.setBgm(file)
    // onPatch is stable enough here; the inputs below fully determine playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, track, library])

  const toggle = (): void => {
    const next = !on
    setOn(next)
    // Turning BGM on with no track selected would enable a switch that plays
    // silence, so fall back to the first available track.
    const chosen = track ?? tracks[0]?.name ?? null
    setTrack(chosen)
    onPatch({ bgmEnabled: next, bgmTrack: chosen })
  }

  // Main process shows the picker and copies the files into user media, then
  // pushes a fresh library. Auto-select the first thing added.
  const pick = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.pa.importMusic()
      if (res.error) {
        setError(`เพิ่มเพลงไม่สำเร็จ: ${res.error}`)
        return
      }
      if (res.added.length === 0) {
        setError(res.message ?? 'ไม่พบไฟล์ที่เพิ่มได้')
        return
      }
      const lib = await window.pa.getLibrary()
      const first = res.added
        .map((n: string) => lib.files.find((f: LibraryFile) => f.kind === 'bgm' && f.name === n))
        .find((f: LibraryFile | undefined) => f !== undefined)
      if (first) {
        setTrack(first.name)
        onPatch({ bgmTrack: first.name })
      }
    } catch (err) {
      setError(`เพิ่มเพลงไม่สำเร็จ: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <h2>
        เพลงพื้นหลัง <small>Background music</small>
      </h2>

      <div className="row">
        <button className={`btn${on ? ' on' : ''}`} onClick={toggle} disabled={tracks.length === 0}>
          {on ? 'หยุด' : 'เล่น'} {on ? 'Stop' : 'Play'}
        </button>
        <select
          value={track ?? ''}
          onChange={(e) => {
            const v = e.target.value || null
            setTrack(v)
            onPatch({ bgmTrack: v })
          }}
          disabled={tracks.length === 0}
        >
          <option value="">-- เลือกเพลง --</option>
          {tracks.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="btn" onClick={pick} disabled={busy}>
          {busy ? 'กำลังเพิ่ม…' : 'เพิ่มเพลง Add music'}
        </button>
      </div>

      {tracks.length === 0 && (
        <p className="hint">ยังไม่มีเพลง — กด “เพิ่มเพลง” เพื่อเลือกไฟล์จากเครื่อง</p>
      )}
      {on && tracks.length > 0 && !track && (
        <p className="hint err">เลือกเพลงที่จะเล่น — เลือกจากรายการด้านบน</p>
      )}
      {error && <p className="hint err">{error}</p>}

      <Slider label="ระดับเสียงเพลง" value={settings.volBgm} onChange={(v) => onPatch({ volBgm: v })} />
    </section>
  )
}

export function Slider({
  label,
  value,
  onChange,
  step = 0.01,
  max = 1,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  max?: number
}) {
  return (
    <label className="slider">
      <span className="slabel">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="sval">{Math.round(value * 100)}%</span>
    </label>
  )
}
