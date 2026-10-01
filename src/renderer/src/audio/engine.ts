import type { Library, LibraryFile, Settings } from '@shared/types'

export type InputKind = 'off' | 'loopback' | 'device'

type Bus = 'announce' | 'emergency' | 'bgm' | 'tone' | 'input'

export type ToneKind = 'beep' | 'interval'

/** 1 kHz is the classic TV test/calibration pitch. */
const TONE_HZ = 1000
const TONE_LEVEL = 0.45

/** Turn a getUserMedia/getDisplayMedia rejection into something actionable. */
function describeInputError(err: unknown, kind: InputKind): string {
  const name = (err as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return kind === 'loopback'
      ? 'Screen recording permission was denied — allow it in System Settings → Privacy & Security → Screen Recording, then restart the app'
      : 'Microphone permission was denied — allow it in System Settings → Privacy & Security'
  }
  if (name === 'NotFoundError') {
    return kind === 'loopback'
      ? 'No system audio source found. On macOS this needs Screen Recording permission and version 13 or newer'
      : 'No input device found'
  }
  if (name === 'NotReadableError') return 'The device is in use by another application'
  if (kind === 'loopback') {
    // A bare TypeError here means the main process had no screen source to
    // hand back, which on macOS is almost always the missing permission
    // rather than a genuinely absent capture device.
    return 'System audio is unavailable. Check that the app is allowed under System Settings → Privacy & Security → Screen Recording, then restart it. See the log for details.'
  }
  return String(err)
}

const FADE = 0.04

/**
 * All playback lives in the renderer. One AudioContext, one destination, one
 * gain bus per sound class so the emergency announcement can take over without
 * touching the others.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private buses = new Map<Bus, GainNode>()
  private bgmDuckGain!: GainNode
  private inputDuckGain!: GainNode
  private cache = new Map<string, AudioBuffer>()
  private library: Library | null = null
  private settings: Settings | null = null

  private bgmSource: AudioBufferSourceNode | null = null
  private toneOsc: OscillatorNode | null = null
  private toneGain: GainNode | null = null
  private toneTimer: number | null = null
  private toneKind: ToneKind | null = null
  private bgmTrackName: string | null = null
  private emergencySource: AudioBufferSourceNode | null = null
  /** a one-shot announcement is playing */
  private ducked = false
  /** the operator is speaking live and the music stays down until released */
  private speakHold = false
  /** live input from another app or a line-in feed */
  private inputSource: MediaStreamAudioSourceNode | null = null
  private inputStream: MediaStream | null = null
  private inputKind: InputKind = 'off'

  private loading: LibraryFile | null = null

  attach(library: Library, settings: Settings): void {
    this.library = library
    this.settings = settings
  }

  /** Must be called from a user gesture the first time. */
  async unlock(): Promise<boolean> {
    try {
      this.ensure()
      if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume()
      return this.ctx?.state === 'running'
    } catch {
      return false
    }
  }

  get ready(): boolean {
    return this.ctx?.state === 'running'
  }

  get outputDeviceId(): string | null {
    return this.ctx?.sinkId ?? null
  }

  get currentBgm(): string | null {
    return this.bgmTrackName
  }

  get emergencyActive(): boolean {
    return this.emergencySource !== null
  }

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctor({ latencyHint: 'playback' })
    this.ctx = ctx

    this.master = ctx.createGain()
    this.master.gain.value = this.settings?.master ?? 0.9
    this.master.connect(ctx.destination)

    // BGM and the live input each get their own duck gain so announcement
    // ducking stays independent of their volume settings.
    this.bgmDuckGain = ctx.createGain()
    this.bgmDuckGain.gain.value = 1
    this.bgmDuckGain.connect(this.master)

    this.inputDuckGain = ctx.createGain()
    this.inputDuckGain.gain.value = 1
    this.inputDuckGain.connect(this.master)

    for (const bus of ['announce', 'emergency', 'bgm', 'tone', 'input'] as Bus[]) {
      const g = ctx.createGain()
      if (bus === 'bgm') g.connect(this.bgmDuckGain)
      else if (bus === 'input') g.connect(this.inputDuckGain)
      else g.connect(this.master)
      this.buses.set(bus, g)
    }
    this.applyVolumes()
    // The nodes were just created at unity, so a duck that was requested
    // before the context existed would otherwise never be heard.
    this.applyDuck()
    this.log('info', `audio graph ready buses=${[...this.buses.keys()].join(',')}`)
    return ctx
  }

  applyVolumes(): void {
    if (!this.ctx || !this.settings) return
    const s = this.settings
    const t = this.ctx.currentTime
    const set = (bus: Bus, v: number): void => {
      const node = this.buses.get(bus)
      if (!node) return
      node.gain.setTargetAtTime(clamp01(v), t, 0.02)
    }
    this.master.gain.setTargetAtTime(clamp01(s.master), t, 0.02)
    set('announce', s.volAnnounce)
    set('emergency', s.volEmergency)
    set('bgm', s.volBgm)
    set('tone', s.volAnnounce)
    set('input', s.volInput)
  }

  private busFor(file: LibraryFile): Bus {
    if (file.kind === 'emergency') return 'emergency'
    if (file.kind === 'tone') return 'tone'
    return 'announce'
  }

  /**
   * Resolve a cue to a file. The operator's override wins when it still points
   * at a file of the right kind, so renaming a recording cannot silently make
   * a button play the wrong thing.
   */
  find(kind: LibraryFile['kind'], preferred?: string | null): LibraryFile | null {
    if (!this.library) return null
    if (preferred) {
      const exact = this.library.files.find((f) => f.name === preferred && f.kind === kind)
      if (exact) return exact
    }
    return this.library.files.find((f) => f.kind === kind) ?? null
  }

  async load(file: LibraryFile): Promise<AudioBuffer | null> {
    const cached = this.cache.get(file.url)
    if (cached) return cached
    const ctx = this.ensure()
    try {
      const res = await fetch(file.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const raw = await res.arrayBuffer()
      const buf = await ctx.decodeAudioData(raw)
      this.cache.set(file.url, buf)
      return buf
    } catch (err) {
      console.error('decode failed', file.name, err)
      return null
    }
  }

  /** One-shot playback. Returns the duration in seconds, or null on failure. */
  async play(file: LibraryFile, onEnded?: () => void): Promise<number | null> {
    const ctx = this.ensure()
    if (ctx.state === 'suspended') await ctx.resume()
    const buf = await this.load(file)
    if (!buf) return null

    const bus = this.busFor(file)
    if (bus === 'emergency') this.stopEmergency(true)
    // A real announcement takes priority over a test tone that is sounding.
    if (bus !== 'bgm' && this.toneKind !== null) this.stopTone()
    if (bus !== 'bgm') this.setDuck(true)

    const src = ctx.createBufferSource()
    src.buffer = buf
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, ctx.currentTime)
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE)
    src.connect(g)
    g.connect(this.buses.get(bus) as GainNode)
    src.onended = (): void => {
      if (bus !== 'emergency') this.setDuck(false)
      onEnded?.()
    }
    src.start()
    return buf.duration
  }

  /** Looping emergency announcement. Calling twice restarts it. */
  async startEmergency(file: LibraryFile | null): Promise<boolean> {
    this.stopBgm(0.25)
    if (this.emergencySource) this.stopEmergency(true)
    if (!file) return false
    const ctx = this.ensure()
    if (ctx.state === 'suspended') await ctx.resume()
    const buf = await this.load(file)
    if (!buf) return false

    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, ctx.currentTime)
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE)
    src.connect(g)
    g.connect(this.buses.get('emergency') as GainNode)
    src.start()
    this.emergencySource = src
    return true
  }

  stopEmergency(immediate = false): void {
    const src = this.emergencySource
    if (!src || !this.ctx) return
    this.emergencySource = null
    const t = this.ctx.currentTime
    if (immediate) {
      try {
        src.stop()
      } catch {
        // already stopped
      }
    } else {
      src.stop(t + 0.25)
    }
  }

  /**
   * Speaker-check tone, synthesised rather than loaded from a file so it works
   * on any machine with no setup.
   *
   * 'beep'    - the steady 1 kHz line from an old TV test pattern, for spotting
   *             hum and whistle feedback.
   * 'interval'- the beep-beep-beep interval signal, for checking every speaker
   *             in a room by ear.
   *
   * Runs until stopped and holds the music down while it sounds.
   */
  async startTone(kind: ToneKind): Promise<boolean> {
    this.stopTone()
    const ctx = this.ensure()
    if (ctx.state === 'suspended') await ctx.resume()
    const bus = this.buses.get('tone') as GainNode
    this.toneKind = kind

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = TONE_HZ
    const g = ctx.createGain()
    g.gain.value = 0
    osc.connect(g)
    g.connect(bus)
    osc.start()
    this.toneOsc = osc
    this.toneGain = g
    this.setDuck(true)

    if (kind === 'beep') {
      // Short fade in and out; a raw square edge is audible as a click.
      const t = ctx.currentTime
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(TONE_LEVEL, t + 0.03)
    } else {
      // Schedule ahead of the clock so timer jitter never gaps the pattern.
      const BEEP = 0.35
      const GAP = 0.18
      const BLOCK = BEEP * 3 + GAP * 2
      const PAUSE = 2.4
      let next = ctx.currentTime + 0.05
      const schedule = (): void => {
        const horizon = ctx.currentTime + 1.5
        while (next < horizon) {
          for (let i = 0; i < 3; i++) {
            const s = next + i * (BEEP + GAP)
            g.gain.setValueAtTime(0, s)
            g.gain.linearRampToValueAtTime(TONE_LEVEL, s + 0.02)
            g.gain.setValueAtTime(TONE_LEVEL, s + BEEP - 0.02)
            g.gain.linearRampToValueAtTime(0, s + BEEP)
          }
          next += BLOCK + PAUSE
        }
      }
      schedule()
      this.toneTimer = window.setInterval(schedule, 500)
    }
    return true
  }

  stopTone(): void {
    if (this.toneTimer !== null) {
      window.clearInterval(this.toneTimer)
      this.toneTimer = null
    }
    const osc = this.toneOsc
    const gainNode = this.toneGain
    this.toneOsc = null
    this.toneGain = null
    const wasOn = this.toneKind !== null
    this.toneKind = null
    if (osc) {
      if (this.ctx) {
        // short fade so stopping does not click
        if (gainNode) {
          gainNode.gain.cancelScheduledValues(this.ctx.currentTime)
          gainNode.gain.setValueAtTime(gainNode.gain.value, this.ctx.currentTime)
          gainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.05)
        }
        try {
          osc.stop(this.ctx.currentTime + 0.06)
        } catch {
          // already stopped
        }
      } else {
        try {
          osc.stop()
        } catch {
          // already stopped
        }
      }
      osc.disconnect()
    }
    if (wasOn) this.setDuck(false)
  }

  get toneActive(): boolean {
    return this.toneKind !== null
  }

  /** Crossfade to a looping BGM track. Pass null to stop. */
  async setBgm(file: LibraryFile | null): Promise<void> {
    const ctx = this.ensure()
    if (ctx.state === 'suspended') await ctx.resume()

    // Already playing this exact track: nothing to do.
    const sameTrack = this.bgmTrackName === (file?.name ?? null)
    if (sameTrack && (file !== null) === (this.bgmSource !== null)) return

    this.stopBgm(0.6)

    if (!file) {
      this.bgmTrackName = null
      return
    }
    const buf = await this.load(file)
    if (!buf) {
      this.bgmTrackName = null
      return
    }

    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, ctx.currentTime)
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.6)
    src.connect(g)
    g.connect(this.buses.get('bgm') as GainNode)
    src.start()
    this.bgmSource = src
    this.bgmTrackName = file.name
    this.log(
      'info',
      `bgm start ${file.name} busGain=${(this.buses.get('bgm') as GainNode).gain.value.toFixed(3)} duckGain=${this.bgmDuckGain.gain.value.toFixed(3)} ducked=${this.ducked || this.speakHold}`,
    )
  }

  stopBgm(fade = 0.6): void {
    const src = this.bgmSource
    if (!src || !this.ctx) return
    this.bgmSource = null
    this.bgmTrackName = null
    try {
      src.stop(this.ctx.currentTime + fade)
    } catch {
      // already stopped
    }
  }

  setDuck(on: boolean): void {
    this.ducked = on
    this.applyDuck()
  }

  /**
   * Hold the music down while the operator speaks over it. Released when they
   * click the button again, which restores the level to exactly what it was.
   */
  setSpeakMode(on: boolean): void {
    if (this.speakHold === on) return
    this.speakHold = on
    this.applyDuck()
  }

  get speaking(): boolean {
    return this.speakHold
  }

  private applyDuck(): void {
    if (!this.ctx) return
    const down = this.ducked || this.speakHold
    const level = 1 - (this.settings?.bgmDuck ?? 0.85)
    const t = this.ctx.currentTime
    this.bgmDuckGain.gain.setTargetAtTime(down ? level : 1, t, 0.08)
    this.inputDuckGain.gain.setTargetAtTime(down ? level : 1, t, 0.08)
    this.log(
      'info',
      `duck down=${down} level=${level.toFixed(2)} duckGain=${this.bgmDuckGain.gain.value.toFixed(3)}`,
    )
  }

  /** Best-effort diagnostic trail; audio must never depend on logging. */
  private log(level: 'info' | 'warn' | 'error', message: string): void {
    try {
      window.pa?.log?.(level, message)
    } catch {
      // ignore
    }
  }

  get inputState(): InputKind {
    return this.inputKind
  }

  /**
   * Route another app's audio, or a line-in feed, through the PA.
   *
   * 'loopback' captures the system render device, which unavoidably includes
   * this app's own announcements. That is fine when the PA is a separate
   * machine in the chain, but on a single PC it will re-amplify the room. The
   * UI warns about it; a line-in device is the safe choice.
   */
  async startInput(kind: Exclude<InputKind, 'off'>, deviceId?: string): Promise<{ ok: boolean; error?: string }> {
    this.stopInput()
    const ctx = this.ensure()
    if (ctx.state === 'suspended') await ctx.resume()

    let stream: MediaStream
    try {
      if (kind === 'loopback') {
        // Audio only. Asking for video as well makes the main-process handler
        // fail with "Video was requested, but no video stream was provided"
        // when it only has loopback audio to give.
        const s = await navigator.mediaDevices.getDisplayMedia({
          video: false,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
        for (const t of s.getVideoTracks()) t.stop()
        stream = new MediaStream(s.getAudioTracks())
        if (stream.getAudioTracks().length === 0) {
          throw Object.assign(new Error('no audio track in the captured stream'), {
            name: 'NotFoundError',
          })
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        })
      }
    } catch (err) {
      this.inputKind = 'off'
      return { ok: false, error: describeInputError(err, kind) }
    }

    const src = ctx.createMediaStreamSource(stream)
    src.connect(this.buses.get('input') as GainNode)
    this.inputSource = src
    this.inputStream = stream
    this.inputKind = kind

    // A device that is unplugged mid-session should not leave the UI claiming
    // audio is live.
    for (const t of stream.getAudioTracks()) {
      t.addEventListener('ended', () => this.stopInput())
    }
    return { ok: true }
  }

  stopInput(): void {
    for (const t of this.inputStream?.getTracks() ?? []) t.stop()
    this.inputSource?.disconnect()
    this.inputSource = null
    this.inputStream = null
    this.inputKind = 'off'
  }

  /** Loopback captures the whole system, so the PA must not also output to it. */
  get loopbackActive(): boolean {
    return this.inputKind === 'loopback'
  }

  /** null = follow the system default output device. */
  async setOutputDevice(deviceId: string | null): Promise<boolean> {
    this.ensure()
    const ctx = this.ctx
    if (!ctx) return false
    const anyCtx = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string }
    if (typeof anyCtx.setSinkId !== 'function') return false
    try {
      await anyCtx.setSinkId(deviceId ?? '')
      return true
    } catch (err) {
      console.warn('setSinkId failed', err)
      return false
    }
  }

  static async listOutputs(): Promise<{ deviceId: string; label: string }[]> {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      return all
        .filter((d) => d.kind === 'audiooutput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Output ${i + 1}` }))
    } catch {
      return []
    }
  }

  static async listInputs(): Promise<{ deviceId: string; label: string }[]> {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      return all
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}` }))
    } catch {
      return []
    }
  }

  get loadingName(): string | null {
    return this.loading?.name ?? null
  }

  setLoading(file: LibraryFile | null): void {
    this.loading = file
  }
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

export const engine = new AudioEngine()
