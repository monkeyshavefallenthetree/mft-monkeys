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
