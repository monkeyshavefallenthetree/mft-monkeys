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

/**
 * Short notification chime. Respects the user's mute preference unless
 * `force` is set (used by the "Test sound" button).
 */
export function playTerminalBeep(opts?: { force?: boolean }) {
  if (typeof window === "undefined") return;
  if (!opts?.force && !isSoundEnabled()) return;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => void ctx.close().catch(() => {});
  } catch (e) {
    console.error("Audio play failed", e);
  }
}
