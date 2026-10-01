import { useState } from 'react'
import type { Settings } from '@shared/types'

interface Props {
  settings: Settings
  onPatch: (patch: Partial<Settings>) => void
}

export function SchedulePanel({ settings, onPatch }: Props) {
  const [draft, setDraft] = useState('')

  const setTime = (key: 'openTime', v: string): void => {
    onPatch({ [key]: v || null } as Partial<Settings>)
  }

  const addClassEnd = (): void => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft)) return
    if (settings.classEndTimes.includes(draft)) {
      setDraft('')
      return
    }
    onPatch({ classEndTimes: [...settings.classEndTimes, draft].sort() })
    setDraft('')
  }

  return (
    <section className="panel">
      <h2>
        ตารางเวลา <small>Daily schedule</small>
      </h2>
      <p className="hint">เวลาเป็นนาฬิกา 24 ชั่วโมง (HH:MM) และทำซ้ำทุกวัน</p>

      <div className="grid2">
        <TimeField label="PA เริ่ม (PA Start)" value={settings.openTime} onChange={(v) => setTime('openTime', v)} />
      </div>

      <h3>เวลากระดิ่ง (Bell)</h3>
      {settings.classEndTimes.length === 0 && (
        <p className="hint">ยังไม่ได้ตั้งเวลา — กดปุ่ม “กระดิ่ง” ด้านบนเพื่อเล่นเองได้</p>
      )}
      <ul className="times">
        {settings.classEndTimes.map((t) => (
          <li key={t}>
            <code>{t}</code>
            <button
              className="x"
              onClick={() => onPatch({ classEndTimes: settings.classEndTimes.filter((b) => b !== t) })}
              title="ลบ"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="row">
        <input
          type="time"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          step={60}
          aria-label="เวลากระดิ่ง"
        />
        <button className="btn" onClick={addClassEnd} disabled={!draft}>
          เพิ่มเวลา Add
        </button>
      </div>
    </section>
  )
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | null
  onChange: (v: string) => void
}) {
  return (
    <label className="timefield">
      <span>{label}</span>
      <input
        type="time"
        step={60}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
