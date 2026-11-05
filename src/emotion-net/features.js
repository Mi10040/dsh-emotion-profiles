/**
 * RunRecord -> GRU feature rows.
 *
 * Twelve dimensions, all bounded. The last two carry the *current mood relative
 * to the profile baseline*, which is what lets the net pull a drifting state
 * home instead of only reacting to outcomes.
 */
import { INPUT_DIM, WINDOW } from './net.js'

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const clamp01 = (x) => clamp(Number.isFinite(x) ? x : 0, 0, 1)

/** Neutral padding row used before the plugin has seen a full window. */
export function neutralRow() {
  const row = new Float64Array(INPUT_DIM)
  row[0] = 0.5
  row[3] = 1 // completed
  row[7] = 0.1
  row[8] = 0.1
  row[9] = 0.3
  return row
}

/**
 * Build one feature row from a RunRecord and its profile baseline.
 * @param {object} run
 * @param {{ valence: number, arousal: number }} baseline
 * @returns {Float64Array}
 */
export function rowFromRun(run, baseline) {
  const row = new Float64Array(INPUT_DIM)
  row[0] = clamp01(Number(run.outcomeScore) || 0)
  row[1] = clamp01((Number(run.toolErrorCount) || 0) / 4)
  row[2] = run.conflictFlag ? 1 : 0

  const status = run.status
  row[3] = status === 'completed' ? 1 : 0
  row[4] = status === 'aborted' ? 1 : 0
  row[5] = status === 'blocked' ? 1 : 0
  row[6] = status === 'failed' ? 1 : 0

  row[7] = clamp01((Number(run.signals?.steps) || 0) / 8)
  row[8] = clamp01((Number(run.durationMs) || 0) / 1_800_000)
  row[9] = clamp01(Array.from(String(run.firstUserGoal ?? '')).length / 200)

  const beforeV = Number(run.emotion?.valenceBefore)
  const beforeA = Number(run.emotion?.arousalBefore)
  row[10] = clamp(Number.isFinite(beforeV) ? beforeV - baseline.valence : 0, -0.7, 0.7)
  row[11] = clamp(Number.isFinite(beforeA) ? beforeA - baseline.arousal : 0, -0.7, 0.7)
  return row
}

/**
 * Build the fixed-size input window: the newest row last, older rows padded
 * with neutral values at the front.
 * @param {Float64Array[]} rows newest last, at most WINDOW entries
 * @returns {Float32Array}
 */
export function buildWindow(rows) {
  const window = new Float32Array(WINDOW * INPUT_DIM)
  const neutral = neutralRow()
  const recent = Array.isArray(rows) ? rows.slice(-WINDOW) : []
  const offset = WINDOW - recent.length
  for (let i = 0; i < WINDOW; i += 1) {
    const source = i < offset ? neutral : recent[i - offset]
    for (let k = 0; k < INPUT_DIM; k += 1) window[i * INPUT_DIM + k] = source[k]
  }
  return window
}
