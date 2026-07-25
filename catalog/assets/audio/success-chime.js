/**
 * Synthesize a success chime using the Web Audio API.
 *
 * Usage:
 *   import { playSuccessChime } from './success-chime.js';
 *   playSuccessChime();
 *
 * The sound is a C5-E5-G5 major-triad arpeggio (sine wave) with a gain
 * envelope from 0.2 fading to 0.01 over 400 ms. Three notes are played
 * sequentially, each 100 ms apart, using a single oscillator whose
 * frequency steps up through the chord tones.
 * No external dependencies required.
 */
export function playSuccessChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, ctx.currentTime);       // C5
    osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
    osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2); // G5

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // Audio not available — fail silently
  }
}
