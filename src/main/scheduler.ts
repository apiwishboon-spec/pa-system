import type { Settings, ScheduleAction } from '../shared/types'

export interface SchedulerEvents {
  fire: (action: ScheduleAction, at: Date) => void
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Fires the open announcement and each end-of-class announcement once per day
 * at their configured time. Keyed by day+action+time so a reload or a clock
 * jump cannot double-fire.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private fired = new Set<string>()

  constructor(
    private settings: Settings,
    private events: SchedulerEvents,
  ) {}

  update(settings: Settings): void {
    this.settings = settings
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), 5_000)
    this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    const now = new Date()
    const key = now.toISOString().slice(0, 10)
    const current = hhmm(now)

    // Paused from the tray: still tick so the interval stays alive, but fire
    // nothing. Markers are left untouched so unpausing mid-minute can still
    // catch up if it lands on the same minute.
    if (this.settings.schedulePaused) return

    const check = (time: string | null, action: ScheduleAction): void => {
      if (!time || time !== current) return
      const id = `${key}:${action}:${time}`
      if (this.fired.has(id)) return
      this.fired.add(id)
      this.events.fire(action, now)
    }

    check(this.settings.openTime, 'open')
    for (const t of this.settings.classEndTimes) check(t, 'classEnd')

    // Drop yesterday's markers so the set cannot grow without bound.
    if (this.fired.size > 200) {
      for (const id of [...this.fired]) {
        if (!id.startsWith(key)) this.fired.delete(id)
      }
    }
  }
}
