import { useEffect, useState } from 'react'
import { AudioEngine, engine } from '../audio/engine'
import { Slider } from './MusicPanel'
import type { InputKind, Settings } from '@shared/types'

interface Props {
  settings: Settings
  onPatch: (patch: Partial<Settings>) => void
  /** id of the device the PA is playing through, used for the feedback warning */
  outputDeviceId: string | null
}

export function InputPanel({ settings, onPatch, outputDeviceId }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState<InputKind>('off')
  const [inputs, setInputs] = useState<{ deviceId: string; label: string }[]>([])

  // Enumerated after a successful getUserMedia, which is when labels are
  // actually populated; before that they are empty strings.
  useEffect(() => {
    if (settings.inputKind !== 'device' || inputs.length > 0) return
    let alive = true
    void AudioEngine.listInputs().then((d) => alive && setInputs(d))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [settings.inputKind, inputs.length])

  const stop = (): void => {
    engine.stopInput()
    setLive('off')
    onPatch({ inputKind: 'off' })
  }

  const start = async (kind: Exclude<InputKind, 'off'>): Promise<void> => {
    setBusy(true)
    setError(null)
    const r = await engine.startInput(kind, settings.inputDeviceId ?? undefined)
    setBusy(false)
    if (!r.ok) {
      setError(r.error ?? 'เปิดไม่สำเร็จ')
      return
    }
    setLive(kind)
    onPatch({ inputKind: kind })
    if (kind === 'device') {
      const d = await AudioEngine.listInputs()
      setInputs(d)
    }
  }

  const on = live !== 'off'

  return (
    <section className="panel">
      <h2>
        เสียงจากเครื่องอื่น <small>External audio input</small>
      </h2>
      <p className="hint">
        เปิดเสียงจากโปรแกรมอื่นเข้ามากระจายในห้อง — เช่น เพลงจาก YouTube หรือเสียงจาก Google Meet
      </p>

      <div className="row">
        {on ? (
          <button className="btn on" onClick={stop}>
            หยุด Stop
          </button>
        ) : (
          <>
            <button className="btn" onClick={() => void start('loopback')} disabled={busy}>
              {busy ? 'กำลังเปิด…' : 'เสียงทั้งระบบ System audio'}
            </button>
            <button className="btn" onClick={() => void start('device')} disabled={busy}>
              อุปกรณ์เข้า Line-in
            </button>
          </>
        )}
        {on && <span className="tag on">กำลังรับเสียงอยู่</span>}
      </div>

      {on && live === 'loopback' && (
        <p className="hint warn">
          โหมดนี้จับเสียงที่คอมพิวเตอร์กำลังเล่นทั้งหมด รวมถึงเสียงประกาศของโปรแกรมนี้ด้วย
          ถ้าเสียงวนกลับเข้ามาให้ใช้โหมด Line-in แทน
        </p>
      )}

      {on && live === 'loopback' && outputDeviceId && (
        <p className="hint warn">
          ควรฟังผ่านหูฟังหรือเปลี่ยนอุปกรณ์เสียงออกก่อนเปิดโหมดนี้ เพื่อไม่ให้เกิดเสียงหอนวน
        </p>
      )}

      <h3>อุปกรณ์เข้า (Input device)</h3>
      <select
        value={settings.inputDeviceId ?? ''}
        onChange={(e) => onPatch({ inputDeviceId: e.target.value || null })}
        disabled={live === 'loopback'}
      >
        <option value="">ค่าเริ่มต้นของระบบ</option>
        {inputs.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
      {inputs.length === 0 && (
        <p className="hint">
          ถ้าต้องการส่งเสียงจากโปรแกรมอื่นเข้ามาโดยไม่ให้เกิดเสียงหอนวน ให้ติดตั้งตัวเชื่อมเสียงเสมือน
          (เช่น VB-CABLE บน Windows หรือ BlackHole บน macOS) แล้วเลือกช่องของมันที่นี่
        </p>
      )}

      <Slider
        label="ระดับเสียงเข้า (Input level)"
        value={settings.volInput}
        onChange={(v) => onPatch({ volInput: v })}
      />

      {error && <p className="hint err">{error}</p>}
    </section>
  )
}
