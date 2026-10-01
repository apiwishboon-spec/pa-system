# Media manifest

Drop recordings here. Exact filenames, lowercase, hyphens only.

## Export settings (GarageBand)

- Format **WAV**, **16-bit**, **44.1 or 48 kHz**, **Mono**
- **Normalize every file the same way** (e.g. GarageBand Normalize to -3 dB) so the
  app does not need per-file gain and everything is equally loud in the room
- Leave **0.3 s silence at the start and 0.5 s at the end**
- No music bed under announcements. Bells: keep the natural room sound, do not gate it
- Same mic distance on every take

## The whole list: 9 files

### 1. Class-change bell -> `bells/`

| File | Notes |
|---|---|
| `bell-class.wav` | The one bell, to signal class change. Anything in a normal "ting ting" range works |

### 2. Announcements -> `announcements/th/` and `announcements/en/`

| Slot | Files | Say (TH) | Say (EN) |
|---|---|---|---|
| open | `open-th.wav` / `open-en.wav` | สวัสดีครับ/ค่ะ นักเรียนทุกคน ยินดีต้อนรับเข้าสู่วันใหม่ | Good morning, students. Welcome to a new day. |
| close | `close-th.wav` / `close-en.wav` | ขอบคุณนักเรียนทุกคนที่ตั้งใจเรียน สวัสดีลาก่อน | Thank you all for your attention. Goodbye. |

### 3. Alarm -> `emergency/`

| File | Notes |
|---|---|
| `alarm.wav` | Loops until dismissed. Placeholder already generated - only replace if you want a different one |

### 4. Background music -> `music/`

Loops automatically, so pick tracks that loop cleanly with no big silence
in the middle. One track is enough to start.

| File | Notes |
|---|---|
| `bgm-1.wav` | Main background loop |

## Already generated in `media/sounds/` (placeholders, no need to record)

- `bell-class.wav` - default class bell, currently the `gong` timbre
- `bell-school.wav`, `bell-temple.wav`, `bell-gong.wav` - alternate bell timbres
- `00-bell-timbre-reel.wav` - listen to compare the three
- `alarm.wav` - looping siren
- `tone-test.wav` - 1 kHz tone for setting the mixer level

## Note on `bells/attention-chime-CANDIDATE.mp3`

An existing 4.3 s attention chime. If it is the sound the school actually uses,
rename it to `bell-class.wav` and the app will use it. mp3 works, WAV is preferred.
