import { useEffect, useState } from 'react'
import { engine } from '../audio/engine'
import type { AnnouncementKind } from '@shared/types'

interface Props {
  emergencyOn: boolean
  /** operator is speaking live; music stays ducked until released */
  speaking: boolean
  onCue: (kind: AnnouncementKind) => void
  onToggleEmergency: () => void
  onToggleSpeak: () => void
  missing: AnnouncementKind[]
}

interface Btn {
  key: AnnouncementKind
  label: string
  sub: string
  cls: string
}

const BTNS: Btn[] = [
  { key: 'open', label: 'PA เริ่ม', sub: 'PA Start', cls: 'open' },
  { key: 'classEnd', label: 'กระดิ่ง', sub: 'Bell', cls: 'close' },
  { key: 'emergency', label: 'ฉุกเฉิน', sub: 'Emergency', cls: 'alarm' },
]

/** While speaking, the start button becomes the stop button. */
function speakLabel(speaking: boolean): { th: string; en: string; badge: string } {
  return speaking
    ? { th: 'PA จบ', en: 'PA Finish', badge: 'กำลังพูด' }
    : { th: 'PA เริ่ม', en: 'PA Start', badge: '' }
}

export function Console({ emergencyOn, speaking, onCue, onToggleEmergency, onToggleSpeak, missing }: Props) {
  const [held, setHeld] = useState<AnnouncementKind | null>(null)

  useEffect(() => {
    if (!held) return
    const t = setTimeout(() => setHeld(null), 4000)
    return () => clearTimeout(t)
  }, [held])

  const press = (key: AnnouncementKind): void => {
    if (key === 'emergency') {
      onToggleEmergency()
      return
    }
    if (key === 'open') {
      onToggleSpeak()
      return
    }
    setHeld(key)
    onCue(key)
  }

  return (
    <div className="console">
      {BTNS.map((b) => {
        const speak = b.key === 'open' ? speakLabel(speaking) : null
        const active = b.key === 'emergency' ? emergencyOn : speak ? speaking : held === b.key
        const noFile = missing.includes(b.key)
        return (
          <button
            key={b.key}
            className={`big ${b.cls}${active ? ' active' : ''}`}
            onPointerDown={() => void engine.unlock()}
            onClick={() => press(b.key)}
          >
            <span className="th">{speak ? speak.th : b.label}</span>
            <span className="en">{speak ? speak.en : b.sub}</span>
            {active && b.key === 'emergency' && <span className="badge">ON</span>}
            {speak && speaking && <span className="badge">{speak.badge}</span>}
            {noFile && <span className="badge warn">ไม่มีไฟล์</span>}
          </button>
        )
      })}
    </div>
  )
}

export function NowPlaying({ name }: { name: string | null }) {
  return (
    <div className={`nowplaying${name ? ' on' : ''}`} aria-live="polite">
      {name ? (
        <>
          <span className="dot" />
          <span className="np-label">กำลังเล่น</span>
          <code>{name}</code>
        </>
      ) : (
        <span className="idle">ว่าง</span>
      )}
    </div>
  )
}
