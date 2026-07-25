/**
 * Synthesize an error bell sound using the Web Audio API.
 *
 * Usage:
 *   import { playErrorBell } from './error-bell.js';
 *   playErrorBell();
 *
 * The sound is a square wave at A4 (440 Hz) dropping to A3 (220 Hz)
 * after 100 ms, with a gain envelope from 0.3 fading to 0.01 over 300 ms.
 * No external dependencies required.
 */
export function playErrorBell() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.setValueAtTime(220, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Audio not available — fail silently
  }
}
