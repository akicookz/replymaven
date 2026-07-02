// Two-tone chime for needs-review pings. Lazily creates the AudioContext on
// first call (must follow a user gesture at least once per session; browsers
// silently ignore it otherwise, which is acceptable).
let ctx: AudioContext | null = null;

export function playChime(): void {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    for (const [freq, start] of [[880, 0], [1174.66, 0.12]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + start);
      gain.gain.exponentialRampToValueAtTime(0.06, t0 + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + 0.4);
    }
  } catch {
    // Audio unavailable — the toast still shows.
  }
}
