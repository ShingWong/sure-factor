/**
 * Speak validation-error guidance via the browser SpeechSynthesis API.
 *
 * Usage:
 *   import { speakError } from './voice-help.js';
 *   speakError('Email', 'Enter a valid email address', 'en');
 *   speakError('Email', 'Enter a valid email address', 'en', { rate: 0.9, pitch: 1.1 });
 *
 * Builds a natural-language phrase in English, Spanish, or French:
 *   en — "{fieldLabel}: {errorMessage}"
 *   es — "{fieldLabel}: {errorMessage}"
 *   fr — "{fieldLabel} : {errorMessage}"
 *
 * Selects the first voice matching the given locale.  Rate (0.1–10) and
 * pitch (0–2) are tunable via the optional third argument.  Errors are
 * caught silently — the function never throws.
 *
 * @param {string} fieldLabel  Translated label of the field (e.g. "Email").
 * @param {string} errorMessage  Translated error description.
 * @param {string} [locale='en']  BCP 47 tag: 'en', 'es', or 'fr'.
 * @param {{ rate?: number, pitch?: number }} [opts]  Speech parameters.
 */
export function speakError(fieldLabel, errorMessage, locale = 'en', opts = {}) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  try {
    const utter = new SpeechSynthesisUtterance();

    const phrases = {
      en: `${fieldLabel}: ${errorMessage}`,
      es: `${fieldLabel}: ${errorMessage}`,
      fr: `${fieldLabel} : ${errorMessage}`,
    };

    utter.text = phrases[locale] ?? phrases.en;
    utter.lang = locale;
    utter.rate = opts.rate ?? 1.0;
    utter.pitch = opts.pitch ?? 1.0;

    const voices = window.speechSynthesis.getVoices();
    const match = voices.find((v) => v.lang.startsWith(locale));
    if (match) utter.voice = match;

    window.speechSynthesis.speak(utter);
  } catch {
    // Speech synthesis unavailable — fail silently
  }
}
