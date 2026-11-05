/**
 * Turning continuous valence/arousal into a few stable bands.
 *
 * The injected mood line must not change on every turn: a changed prompt line
 * invalidates provider prefix-cache reuse from its first changed token. Bands
 * plus hysteresis keep the wording stable while the underlying numbers keep
 * moving, and the elapsed decay is still tracked exactly in the snapshot.
 */
export const VALENCE_THRESHOLDS = [-0.45, -0.15, 0.15, 0.45]
export const AROUSAL_THRESHOLDS = [0.33, 0.66]
export const BAND_HYSTERESIS = 0.07

export const VALENCE_WORDS = ['明显低落', '略低', '平稳', '略好', '愉快']
export const AROUSAL_WORDS = ['低唤醒', '中等唤醒', '高唤醒']

/** Band index for a value: 0 .. thresholds.length. */
export function rawBand(value, thresholds) {
  let band = 0
  while (band < thresholds.length && value >= thresholds[band]) band += 1
  return band
}

/**
 * Move the band only when the value clears the boundary by `hysteresis`, so a
 * value hovering on a threshold does not flip the prompt every turn.
 */
export function bandWithHysteresis(value, thresholds, current, hysteresis = BAND_HYSTERESIS) {
  const next = rawBand(value, thresholds)
  if (!Number.isInteger(current) || current < 0 || current > thresholds.length) return next
  if (next === current) return current
  if (next > current) return value >= thresholds[current] + hysteresis ? next : current
  return value <= thresholds[next] - hysteresis ? next : current
}

/** Recompute both band indices against the state's own previous bands. */
export function nextBands(state) {
  const previous = state.bands && typeof state.bands === 'object' ? state.bands : {}
  return {
    valence: bandWithHysteresis(state.valence, VALENCE_THRESHOLDS, Number(previous.valence)),
    arousal: bandWithHysteresis(state.arousal, AROUSAL_THRESHOLDS, Number(previous.arousal)),
  }
}

export function valenceWord(band) {
  return VALENCE_WORDS[Math.min(VALENCE_WORDS.length - 1, Math.max(0, Number(band) || 0))]
}

export function arousalWord(band) {
  return AROUSAL_WORDS[Math.min(AROUSAL_WORDS.length - 1, Math.max(0, Number(band) || 0))]
}
