"use client";

const SOUND_KEY = "mft.sound";

/** Notification chime preference (persisted). Defaults to on. */
export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(SOUND_KEY) !== "off";
}

export function setSoundEnabled(on: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SOUND_KEY, on ? "on" : "off");
}

let sharedCtx: AudioContext | null = null;
let unlockBound = false;
let lastPlayedAt = 0;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedCtx || sharedCtx.state === "closed") {
    try {
      sharedCtx = new AudioContextClass();
    } catch {
      return null;
    }
  }
  return sharedCtx;
}

/**
 * Unlocks Web Audio on iOS Safari, Android Chrome, and desktop browsers
 * on user interaction so background/async Firestore snapshot notifications
 * always play sound reliably.
 */
export function initSoundUnlock() {
  if (typeof window === "undefined" || unlockBound) return;
  unlockBound = true;

  const unlock = () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      /* ignore */
    }
  };

  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
}

if (typeof window !== "undefined") {
  initSoundUnlock();
}

/**
 * Short notification chime for desktop and mobile.
 * Respects the user's mute preference unless `force` is set (used by "Test sound" or urgent check-ins).
 * Includes a 550ms debounce to avoid overlapping double-beeps when multiple listeners fire at once.
 */
export function playTerminalBeep(opts?: { force?: boolean; urgent?: boolean }) {
  if (typeof window === "undefined") return;
  if (!opts?.force && !isSoundEnabled()) return;

  const now = Date.now();
  if (!opts?.force && now - lastPlayedAt < 550) return;
  lastPlayedAt = now;

  // Tactile vibration on mobile devices
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(opts?.urgent || opts?.force ? [140, 60, 140] : [90, 45, 90]);
    }
  } catch {
    /* ignore */
  }

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const runTone = () => {
      try {
        const t0 = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = "sine";
        osc2.type = "triangle";

        const f1 = opts?.urgent ? 783.99 : 587.33; // G5 or D5
        const f2 = opts?.urgent ? 1046.5 : 880.0; // C6 or A5

        osc1.frequency.setValueAtTime(f1, t0);
        osc1.frequency.setValueAtTime(f2, t0 + 0.09);

        osc2.frequency.setValueAtTime(f1 * 0.5, t0);
        osc2.frequency.setValueAtTime(f2 * 0.5, t0 + 0.09);

        gain.gain.setValueAtTime(0.001, t0);
        gain.gain.linearRampToValueAtTime(0.14, t0 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(t0);
        osc2.start(t0);
        osc1.stop(t0 + 0.29);
        osc2.stop(t0 + 0.29);
      } catch {
        /* ignore */
      }
    };

    if (ctx.state === "suspended") {
      ctx
        .resume()
        .then(runTone)
        .catch(() => {});
    } else {
      runTone();
    }
  } catch (e) {
    console.error("Audio play failed", e);
  }
}

/* ── Continuous Loud 10-Minute Check-In Alarm ── */
let alarmIntervalId: number | null = null;
let alarmAudioEl: HTMLAudioElement | null = null;
let alarmWavUrl: string | null = null;

/** Builds a loud 1.2-second dual-tone alarm WAV data URL so HTML5 <audio loop> plays even in background tabs. */
function getAlarmWavUrl(): string | null {
  if (typeof window === "undefined") return null;
  if (alarmWavUrl) return alarmWavUrl;
  try {
    const sampleRate = 22050;
    const durationSec = 1.2;
    const numSamples = Math.floor(sampleRate * durationSec);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, numSamples * 2, true);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      // Three loud rapid pulses per 1.2s cycle: (0..0.28s), (0.35..0.63s), (0.70..1.05s)
      const inPulse1 = t >= 0 && t <= 0.28;
      const inPulse2 = t >= 0.35 && t <= 0.63;
      const inPulse3 = t >= 0.7 && t <= 1.05;
      if (!inPulse1 && !inPulse2 && !inPulse3) {
        view.setInt16(44 + i * 2, 0, true);
        continue;
      }
      const freq = inPulse1 ? 880 : inPulse2 ? 1174.66 : 1396.91;
      // Rich harmonic wave (sine + square blend) at maximum loud amplitude (0.92)
      const s1 = Math.sin(2 * Math.PI * freq * t);
      const s2 = Math.sin(2 * Math.PI * (freq * 1.5) * t) >= 0 ? 0.5 : -0.5;
      const sample = Math.max(-1, Math.min(1, (s1 * 0.7 + s2 * 0.5) * 0.92));
      view.setInt16(44 + i * 2, sample * 32767, true);
    }

    const blob = new Blob([buffer], { type: "audio/wav" });
    alarmWavUrl = URL.createObjectURL(blob);
    return alarmWavUrl;
  } catch {
    return null;
  }
}

function playLoudAlarmBurst() {
  if (typeof window === "undefined") return;

  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([350, 120, 350, 120, 450]);
    }
  } catch {
    /* ignore */
  }

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const fire = () => {
      try {
        const t0 = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = "sawtooth";
        osc2.type = "square";

        // Urgent high-volume 3-step alarm siren
        osc1.frequency.setValueAtTime(880, t0);
        osc1.frequency.setValueAtTime(1174.66, t0 + 0.25);
        osc1.frequency.setValueAtTime(1396.91, t0 + 0.5);

        osc2.frequency.setValueAtTime(440, t0);
        osc2.frequency.setValueAtTime(587.33, t0 + 0.25);
        osc2.frequency.setValueAtTime(698.46, t0 + 0.5);

        gain.gain.setValueAtTime(0.01, t0);
        gain.gain.linearRampToValueAtTime(0.65, t0 + 0.02);
        gain.gain.setValueAtTime(0.65, t0 + 0.78);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.85);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(t0);
        osc2.start(t0);
        osc1.stop(t0 + 0.86);
        osc2.stop(t0 + 0.86);
      } catch {
        /* ignore */
      }
    };

    if (ctx.state === "suspended") {
      ctx.resume().then(fire).catch(() => {});
    } else {
      fire();
    }
  } catch {
    /* ignore */
  }
}

/**
 * Starts a loud, non-stop alarm that loops continuously (for the entire 10-minute
 * check-in window) until `stopContinuousCheckInAlarm()` is called.
 * Always plays regardless of mute setting (`force`).
 */
export function startContinuousCheckInAlarm() {
  if (typeof window === "undefined") return;
  if (alarmIntervalId !== null) return; // Already running

  // 1. Fire immediate Web Audio siren burst + repeat every 1.2s
  playLoudAlarmBurst();
  alarmIntervalId = window.setInterval(() => {
    playLoudAlarmBurst();
  }, 1200);

  // 2. Also start HTML5 looped <audio> at 100% volume so it continues even if tab is backgrounded
  try {
    const wavUrl = getAlarmWavUrl();
    if (wavUrl) {
      if (!alarmAudioEl) {
        alarmAudioEl = new Audio(wavUrl);
        alarmAudioEl.loop = true;
        alarmAudioEl.volume = 1.0;
      }
      alarmAudioEl.currentTime = 0;
      alarmAudioEl.play().catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

/**
 * Stops the continuous check-in alarm immediately.
 */
export function stopContinuousCheckInAlarm() {
  if (alarmIntervalId !== null) {
    window.clearInterval(alarmIntervalId);
    alarmIntervalId = null;
  }
  if (alarmAudioEl) {
    try {
      alarmAudioEl.pause();
      alarmAudioEl.currentTime = 0;
    } catch {
      /* ignore */
    }
  }
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(0);
    }
  } catch {
    /* ignore */
  }
}

