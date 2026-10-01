import { useMemo } from 'react'
import type { AnnouncementKind, Library, MissingSlot, Settings } from '@shared/types'

export interface LogLine {
  level: 'info' | 'warn' | 'error'
  message: string
  at: number
}

/**
 * Landing page: a read-only overview for the operator who just opened the app
 * on a morning shift. It answers "is this thing ready?" at a glance, without
 * hiding the controls they still need.
 *
 * Nothing here mutates settings. Live controls stay on the other tabs so an
 * accidental tap here cannot stop the schedule or kill an announcement.
 */

interface Props {
  settings: Settings
  library: Library
  nowPlaying: string | null
  speaking: boolean
  emergencyOn: boolean
  toneOn: boolean
  schedulePaused: boolean
  bgmOn: boolean
  inputLabel: string
  onGo: (tab: 'input' | 'music' | 'schedule' | 'settings') => void
  /** newest-last, newest at the bottom like a terminal */
  logs: LogLine[]
}

/** Minutes since midnight, or null when the time is unset or malformed. */
function parseTime(value: string | null): number | null {
  if (!value) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * Next scheduled cue, or null. Schedules can legitimately repeat (a bell at the
 * same time every day), so this scans forward day by day rather than assuming
 * the list is sorted or unique.
 */
function nextCue(
  settings: Settings,
  now: Date
): { label: string; at: Date; kind: AnnouncementKind } | null {
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const times: { label: string; value: string | null; kind: AnnouncementKind }[] = [
    { label: 'PA เริ่ม (PA Start)', value: settings.openTime, kind: 'open' },
    ...settings.classEndTimes.map((t) => ({
      label: 'กระดิ่ง (Bell)',
      value: t,
      kind: 'classEnd' as AnnouncementKind
    }))
  ]

  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const day = new Date(now)
    day.setDate(day.getDate() + dayOffset)
    let best: { label: string; at: Date; kind: AnnouncementKind } | null = null

    for (const entry of times) {
      const minutes = parseTime(entry.value)
      if (minutes === null) continue
      // Only today can already be past; later days are always in the future.
      if (dayOffset === 0 && minutes <= nowMinutes) continue
      const at = new Date(day)
      at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
      if (!best || at.getTime() < best.at.getTime()) {
        best = { label: entry.label, at, kind: entry.kind }
      }
    }

    if (best) return best
  }
  return null
}

function formatDayOffset(at: Date, now: Date): string {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const days = Math.round((at.getTime() - startOfToday.getTime()) / 86_400_000)
  if (days <= 0) return 'วันนี้ (today)'
  if (days === 1) return 'พรุ่งนี้ (tomorrow)'
  return at.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * Required slots with no file on disk. The main process already computes this
 * during the library scan, so reuse its labels rather than re-deriving it here.
 */
function missingRequired(library: Library): MissingSlot[] {
  return library.missing.filter((m) => m.kind !== 'close') // the end chime is optional
}

export function Dashboard({
  settings,
  library,
  nowPlaying,
  speaking,
  emergencyOn,
  toneOn,
  schedulePaused,
  bgmOn,
  inputLabel,
  onGo,
  logs
}: Props) {
  // Terminal convention: newest at the bottom.
  const lines = logs.slice(-14)
  const now = new Date()
  const upcoming = useMemo(() => nextCue(settings, now), [settings, now])
  const missing = useMemo(() => missingRequired(library), [library])
  const ready = missing.length === 0

  const cards: {
    key: string
    label: string
    value: string
    detail: string
    tone: 'ok' | 'warn' | 'live' | 'idle'
  }[] = [
    {
      key: 'next',
      label: 'รอบถัดไป (Next cue)',
      value: upcoming ? upcoming.at.toLocaleTimeString('th-TH', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '—',
      detail: upcoming ? `${upcoming.label} · ${formatDayOffset(upcoming.at, now)}` : 'ยังไม่ได้ตั้งเวลา (no schedule)',
      tone: upcoming ? 'ok' : 'idle'
    },
    {
      key: 'playing',
      label: 'กำลังเล่น (Now playing)',
      value: nowPlaying ?? 'ว่าง (idle)',
      detail: speaking ? 'กำลังประกาศ (live mic)' : emergencyOn ? 'ฉุกเฉิน (emergency)' : toneOn ? 'เสียงทดสอบ (test tone)' : bgmOn ? 'เพลงพื้นหลัง (BGM)' : 'เงียบ',
      tone: speaking || emergencyOn ? 'live' : 'idle'
    },
    {
      key: 'schedule',
      label: 'ตารางเวลา (Schedule)',
      value: schedulePaused ? 'หยุด (paused)' : 'ทำงาน (running)',
      detail: schedulePaused ? 'กระดิ่งจะไม่ดังจนกว่าจะกด Start' : `${settings.classEndTimes.length} รอบกระดิ่ง · ${settings.openTime ?? 'ไม่มี PA เริ่ม'}`,
      tone: schedulePaused ? 'warn' : 'ok'
    },
    {
      key: 'input',
      label: 'เสียงเข้า (Input)',
      value: inputLabel,
      detail: settings.inputKind === 'loopback' ? 'ระวังเสียงหอนกลับ (feedback risk)' : settings.inputKind === 'device' ? 'เสียงจากอุปกรณ์ที่เลือก' : 'ยังไม่ได้เลือกแหล่งเสียง',
      tone: settings.inputKind === 'off' ? 'warn' : 'ok'
    },
    {
      key: 'music',
      label: 'เพลง (Music)',
      value: bgmOn ? 'เปิด (on)' : 'ปิด (off)',
      detail: bgmOn ? 'ดังอยู่, จะถูกลดเสียงอัตโนมัติตอนประกาศ' : 'ไม่มีเพลงพื้นหลัง',
      tone: bgmOn ? 'ok' : 'idle'
    },
    {
      key: 'files',
      label: 'ไฟล์เสียง (Audio files)',
      value: ready ? 'ครบ (ready)' : `ขาด ${missing.length}`,
      detail: ready ? `พบ ${library.files.length} ไฟล์` : `ไม่พบ: ${missing.map((m) => m.label).join(', ')}`,
      tone: ready ? 'ok' : 'warn'
    }
  ]

// Each row navigates to the tab that actually owns that setting.
  const targetFor = (key: string): 'input' | 'music' | 'schedule' | 'settings' =>
    key === 'next' || key === 'schedule'
      ? 'schedule'
      : key === 'music'
        ? 'music'
        : key === 'input'
          ? 'input'
          : 'settings'

  return (
    <div className="dash">
      <section className={`dash-status${ready ? '' : ' warn'}`}>
        <span className="dash-status-dot" aria-hidden="true" />
        <div className="dash-status-text">
          <strong>{ready ? 'ระบบพร้อมใช้งาน (Ready)' : 'ยังไม่พร้อม (Needs setup)'}</strong>
          <p>
            {ready
              ? 'ทุกช่องเสียงที่จำเป็นมีไฟล์แล้ว กด PA เริ่มเพื่อประกาศ'
              : `ต้องเพิ่มไฟล์เสียงก่อน: ${missing.map((m) => m.label).join(', ')} — ดูรายละเอียดในแท็บตั้งค่า`}
          </p>
        </div>
      </section>

      <div className="dash-grid">
        {cards.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`dash-card tone-${c.tone}`}
            onClick={() => onGo(targetFor(c.key))}
          >
            <span className="dash-card-head">
              <span className="dash-card-label">{c.label}</span>
              <span className="dash-card-go" aria-hidden="true">
                ›
              </span>
            </span>
            <strong className="dash-card-value">{c.value}</strong>
            <span className="dash-card-detail">{c.detail}</span>
          </button>
        ))}
      </div>

      <section className="dash-log">
        <div className="dash-log-head">
          <span>บันทึก (Activity log)</span>
          <button type="button" className="ghost tiny" onClick={() => window.pa.revealLog()}>
            เปิดโฟลเดอร์ (Open folder)
          </button>
        </div>
        <ul className="dash-log-list">
          {lines.length === 0 ? (
            <li className="dash-log-line muted">ยังไม่มีรายการ — กดรีเฟรชเพื่อดูล่าสุด (no entries yet)</li>
          ) : (
            lines.map((l) => (
              <li key={`${l.at}-${l.message}`} className={`dash-log-line level-${l.level}`}>
                <time>{new Date(l.at).toLocaleTimeString('th-TH', { hour12: false })}</time>
                <span className="dash-log-msg">{l.message}</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  )
}
