/**
 * The emotion net: one small GRU (input 12, hidden 48, one layer) plus a linear
 * readout of two numbers. This module owns the exact forward pass used by the
 * offline trainer and the graph exporter, so exported ONNX and in-process math
 * cannot drift.
 *
 * Layout notes (shared by trainer, exporter and the parity test):
 *   Wz/Wr/Wn : [12][48]  — input projections, row-major (x[k] * W[k*48 + i])
 *   Rz/Rr/Rn : [48][48]  — recurrent projections, row-major (h[j] * R[j*48 + i])
 *   b*In     : [48]      — input-side bias
 *   b*Rec    : [48]      — recurrent-side bias (kept separate: `n` multiplies it by r)
 *   Wo       : [48][2]   — readout
 *   bo       : [2]
 *
 * Gate equations (linear_before_reset, PyTorch/ONNX GRU convention):
 *   z = sigmoid(x·Wz + h·Rz + bzIn + bzRec)
 *   r = sigmoid(x·Wr + h·Rr + brIn + brRec)
 *   n = tanh(x·Wn + bnIn + r * (h·Rn + bnRec))
 *   h' = (1 - z) * n + z * h
 */

export const INPUT_DIM = 12
export const WINDOW = 8
export const HIDDEN = 48
export const OUT_DIM = 2

/** Per-output tanh scale: one run can move valence by at most 0.30, arousal by 0.20. */
export const DELTA_SCALE = [0.30, 0.20]

/** Deterministic 32-bit PRNG so a seed fully reproduces a model. */
export function makeRng(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function xavier(rng, fanIn, fanOut) {
  const limit = Math.sqrt(6 / (fanIn + fanOut))
  const out = new Float32Array(fanIn * fanOut)
  for (let i = 0; i < out.length; i += 1) out[i] = (rng() * 2 - 1) * limit
  return out
}

function zeros(n) {
  return new Float32Array(n)
}

/** Create fresh weights for one profile with an optional reactivity multiplier. */
export function initWeights(seed, { reactivity = 1 } = {}) {
  const rng = makeRng(seed)
  return {
    Wz: xavier(rng, INPUT_DIM, HIDDEN),
    Wr: xavier(rng, INPUT_DIM, HIDDEN),
    Wn: xavier(rng, INPUT_DIM, HIDDEN),
    Rz: xavier(rng, HIDDEN, HIDDEN),
    Rr: xavier(rng, HIDDEN, HIDDEN),
    Rn: xavier(rng, HIDDEN, HIDDEN),
    bzIn: zeros(HIDDEN),
    brIn: zeros(HIDDEN),
    bnIn: zeros(HIDDEN),
    bzRec: zeros(HIDDEN),
    brRec: zeros(HIDDEN),
    bnRec: zeros(HIDDEN),
    // A neutral readout: training moves it, initialization starts near zero so an
    // untrained net is a no-op rather than a random mood swing.
    Wo: zeros(HIDDEN * OUT_DIM),
    bo: zeros(OUT_DIM),
    reactivity,
  }
}

export function sigmoid(x) {
  return 1 / (1 + Math.exp(-x))
}

/**
 * Run one window of feature rows through the GRU.
 * @param {object} w weights (see module docs)
 * @param {ArrayLike<number>} runs flat Float32Array [WINDOW * INPUT_DIM]
 * @returns {{ z: number[], h: Float32Array, states: Float32Array[] }}
 */
export function forwardSequence(w, runs) {
  let h = new Float32Array(HIDDEN)
  const states = []
  for (let t = 0; t < WINDOW; t += 1) {
    const xo = t * INPUT_DIM
    const z = new Float32Array(HIDDEN)
    const r = new Float32Array(HIDDEN)
    const n = new Float32Array(HIDDEN)
    for (let i = 0; i < HIDDEN; i += 1) {
      let az = w.bzIn[i] + w.bzRec[i]
      let ar = w.brIn[i] + w.brRec[i]
      let anIn = w.bnIn[i]
      let anRec = w.bnRec[i]
      for (let k = 0; k < INPUT_DIM; k += 1) {
        const x = runs[xo + k]
        az += x * w.Wz[k * HIDDEN + i]
        ar += x * w.Wr[k * HIDDEN + i]
        anIn += x * w.Wn[k * HIDDEN + i]
      }
      for (let j = 0; j < HIDDEN; j += 1) {
        const hj = h[j]
        az += hj * w.Rz[j * HIDDEN + i]
        ar += hj * w.Rr[j * HIDDEN + i]
        anRec += hj * w.Rn[j * HIDDEN + i]
      }
      z[i] = sigmoid(az)
      r[i] = sigmoid(ar)
      n[i] = Math.tanh(anIn + r[i] * anRec)
    }
    const next = new Float32Array(HIDDEN)
    for (let i = 0; i < HIDDEN; i += 1) next[i] = (1 - z[i]) * n[i] + z[i] * h[i]
    h = next
    states.push(h.slice())
  }
  const zOut = [w.bo[0], w.bo[1]]
  for (let i = 0; i < HIDDEN; i += 1) {
    zOut[0] += h[i] * w.Wo[i * OUT_DIM]
    zOut[1] += h[i] * w.Wo[i * OUT_DIM + 1]
  }
  return { z: zOut, h, states }
}

/** Map raw readout values to the bounded valence/arousal delta. */
export function scaleDelta(z) {
  return [DELTA_SCALE[0] * Math.tanh(z[0]), DELTA_SCALE[1] * Math.tanh(z[1])]
}

/** Serialize weights to a plain JSON object (trainer → exporter hand-off). */
export function weightsToJson(w) {
  const tensors = {}
  for (const key of ['Wz', 'Wr', 'Wn', 'Rz', 'Rr', 'Rn', 'bzIn', 'brIn', 'bnIn', 'bzRec', 'brRec', 'bnRec', 'Wo', 'bo']) {
    tensors[key] = Array.from(w[key])
  }
  return { tensors, reactivity: w.reactivity ?? 1 }
}

/** Inverse of {@link weightsToJson}. */
export function weightsFromJson(json) {
  const w = { reactivity: json.reactivity ?? 1 }
  for (const [key, value] of Object.entries(json.tensors)) w[key] = Float32Array.from(value)
  return w
}
