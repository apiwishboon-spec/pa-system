import { engine } from '../audio/engine'
import { Slider } from './MusicPanel'
import { ANNOUNCEMENTS, type AnnouncementKind, type Library, type OutputDevice, type Settings } from '@shared/types'

interface Props {
  settings: Settings
  library: Library
  devices: OutputDevice[]
  onPatch: (patch: Partial<Settings>) => void
  onRescan: () => void
  onOpenFolder: () => void
  onDevice: (id: string | null) => void
  onTest: () => void
  toneOn: boolean
  toneKind: 'beep' | 'interval'
  onToneKind: (k: 'beep' | 'interval') => void
  sinkFailed: boolean
}

export function SettingsPanel({
  settings,
  library,
  devices,
  onPatch,
  onRescan,
  onOpenFolder,
  onDevice,
  onTest,
  toneOn,
  toneKind,
  onToneKind,
  sinkFailed,
}: Props) {
  return (
    <section className="panel">
      <h2>
        ตั้งค่า <small>Settings</small>
      </h2>

      <h3>อุปกรณ์เสียงออก (Output device)</h3>
      <select
        value={settings.outputDeviceId ?? ''}
        onChange={(e) => onDevice(e.target.value || null)}
      >
        <option value="">ค่าเริ่มต้นของ Windows (แนะนำ — ต่อเข้ามิกเซอร์)</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
      {sinkFailed && (
        <p className="hint warn">
          เลือกอุปกรณ์เฉพาะไม่ได้ — กรุณาตั้ง Windows ให้เสียงออกหลักเป็นช่องที่ต่อเข้ามิกเซอร์
        </p>
      )}

      <h3>ไฟล์ประกาศ (Announcement files)</h3>
      <CuePickers library={library} settings={settings} onPatch={onPatch} />

      <h3>ระดับเสียง (Volume)</h3>
      <Slider label="รวม (Master)" value={settings.master} onChange={(v) => onPatch({ master: v })} />
      <Slider label="ประกาศ (Announcement)" value={settings.volAnnounce} onChange={(v) => onPatch({ volAnnounce: v })} />
      <Slider label="ฉุกเฉิน (Emergency)" value={settings.volEmergency} onChange={(v) => onPatch({ volEmergency: v })} />
      <Slider label="ลดเสียงพื้นหลังตอนประกาศ (Duck)" value={settings.bgmDuck} onChange={(v) => onPatch({ bgmDuck: v })} />

      <h3>ระบบ (System)</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.autostart}
          onChange={(e) => onPatch({ autostart: e.target.checked })}
        />
        <span>เปิดพร้อม Windows (Start with Windows)</span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.fullscreen}
          onChange={(e) => onPatch({ fullscreen: e.target.checked })}
        />
        <span>เต็มจอ (Fullscreen)</span>
      </label>

      <h3>ไฟล์เสียง (Media files)</h3>
      <div className="row">
        <button className="btn" onClick={onOpenFolder}>
          เปิดโฟลเดอร์ Open folder
        </button>
        <button className="btn" onClick={onRescan}>
          สแกนใหม่ Rescan
        </button>
      </div>

      <h3>เสียงทดสอบลำโพง (Test tone)</h3>
      <p className="hint">
        เสียงแบบทีวี สำหรับเดินฟังทีละตู้ว่าเสียงดังพอและไม่มีเสียงหอน
      </p>
      <div className="row">
        <select
          value={toneKind}
          onChange={(e) => onToneKind(e.target.value as 'beep' | 'interval')}
          disabled={toneOn}
        >
          <option value="interval">เสียงห้องพัก — บี๊บ บี๊บ บี๊บ (TV interval signal)</option>
          <option value="beep">เสียงนิ่ง 1 kHz — สำหรับฟังเสียงหอน</option>
        </select>
        <button className={toneOn ? 'btn on' : 'btn'} onClick={onTest}>
          {toneOn ? 'หยุด Stop' : 'เล่น Play'}
        </button>
      </div>
      {toneOn && (
        <p className="hint">
          กำลังเล่นอยู่ เสียงเพลงจะถูกลดลงชั่วคราว — เดินฟังได้เลย
        </p>
      )}

      <LibraryList library={library} />

      <p className="hint">
        เสียงพร้อมใช้งาน: {engine.ready ? 'พร้อม' : 'รอกดปุ่มก่อน'} · ไฟล์ที่พบ {library.files.length} · ขาด{' '}
        {library.missing.length}
      </p>
    </section>
  )
}

/**
 * Lets the operator choose which recording plays when a folder holds more than
 * one file. Without this, a second file dropped into e.g. bells/ would be picked
 * up by name order and could replace the intended announcement.
 */
function CuePickers({
  library,
  settings,
  onPatch,
}: {
  library: Library
  settings: Settings
  onPatch: (patch: Partial<Settings>) => void
}) {
  const set = (kind: AnnouncementKind, name: string): void => {
    onPatch({ cueFiles: { ...settings.cueFiles, [kind]: name || undefined } })
  }

  return (
    <div className="grid2">
      {ANNOUNCEMENTS.map((a) => {
        const options = library.files.filter((f) => f.kind === a.kind)
        const current = settings.cueFiles[a.kind] ?? options[0]?.name ?? ''
        return (
          <label key={a.kind} className="timefield">
            <span>{a.label}</span>
            <select
              value={current}
              onChange={(e) => set(a.kind, e.target.value)}
              disabled={options.length === 0}
            >
              {options.length === 0 && <option value="">ไม่มีไฟล์ในโฟลเดอร์ {a.folder}/</option>}
              {options.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )
      })}
    </div>
  )
}

function LibraryList({ library }: { library: Library }) {
  if (library.files.length === 0) return <p className="hint warn">ยังไม่พบไฟล์เสียงเลย</p>
  return (
    <ul className="files">
      {library.files.map((f) => (
        <li key={`${f.kind}:${f.folder}:${f.name}`}>
          <code>{f.folder ? `${f.folder}/${f.name}` : f.name}</code>
          <span className="tag">{f.kind}</span>
          {f.placeholder && <span className="tag ph">ในโปรแกรม</span>}
        </li>
      ))}
    </ul>
  )
}
