// Alert sound for HIGH and CRITICAL alerts (Lab 05: the workstation speaker).
// Generated with Web Audio, so no sound files are needed. Browsers allow sound
// only after the user has interacted with the page; the login form counts.

let context: AudioContext | null = null;

function beep(ctx: AudioContext, start: number, frequency: number, duration: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

export function playAlertSound(priority: "HIGH" | "CRITICAL"): void {
  try {
    context ??= new AudioContext();
    void context.resume();
    const now = context.currentTime;
    if (priority === "CRITICAL") {
      // Three short high beeps
      [0, 0.25, 0.5].forEach((offset) => beep(context!, now + offset, 880, 0.18));
    } else {
      beep(context, now, 660, 0.3);
    }
  } catch {
    // No audio device or blocked by the browser: the alert is still on screen
  }
}
