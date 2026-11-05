/**
 * The one Chinese mood line injected into runtime-context.
 *
 * Contract: ≤ `maxChars` code points (default 60), no exact numbers, stable
 * wording inside a band, and empty when injection is disabled. The line is
 * derived state, never a source of truth — the snapshot holds the numbers.
 */
import { arousalWord, valenceWord } from './bands.js'

/** Count Unicode code points, not UTF-16 units, so emoji/rare CJK are counted once. */
export function charLength(text) {
  return Array.from(String(text)).length
}

/** Truncate to `maxChars` code points, marking the cut with an ellipsis. */
export function truncateChars(text, maxChars) {
  const chars = Array.from(String(text))
  if (chars.length <= maxChars) return chars.join('')
  if (maxChars <= 1) return chars.slice(0, Math.max(0, maxChars)).join('')
  return `${chars.slice(0, maxChars - 1).join('')}…`
}

/**
 * Render the mood line for one profile/state pair.
 * @param {{ profile: object, state: { valence: number, arousal: number, bands?: object }, maxChars?: number }} input
 * @returns {string}
 */
export function renderMoodText({ profile, state, maxChars = 60 }) {
  if (!profile || !state) return ''
  const v = valenceWord(state.bands ? state.bands.valence : 2)
  const a = arousalWord(state.bands ? state.bands.arousal : 1)
  const style = profile.style || '保持自然、清晰的语气'
  const text = `当前情感：${profile.name}（${v}·${a}）。${style}`
  return truncateChars(text, maxChars)
}
