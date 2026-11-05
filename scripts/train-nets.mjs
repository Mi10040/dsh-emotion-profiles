/**
 * Offline trainer for the 12 emotion nets.
 *
 *   node scripts/train-nets.mjs                  # all profiles
 *   node scripts/train-nets.mjs --profile gentle # one profile
 *   node scripts/train-nets.mjs --gradcheck      # finite-difference check first
 *
 * There is no Python in the build environment, so the whole pipeline is JS:
 * synthetic run windows -> teacher policy per temperament -> BPTT + Adam over
 * the exact equations in src/emotion-net/net.js -> ONNX bytes via
 * scripts/onnx-writer.mjs. Runtime never trains; it only runs the exported net.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  INPUT_DIM,
  WINDOW,
  HIDDEN,
  OUT_DIM,
  DELTA_SCALE,
  initWeights,
  forwardSequence,
  weightsToJson,
  makeRng,
} from '../src/emotion-net/net.js'
import { buildModelBytes } from './onnx-writer.mjs'
import { TEMPERAMENTS, PROFILE_IDS } from './temperaments.mjs'
import { neutralRow } from '../src/emotion-net/features.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const F = INPUT_DIM
const T = WINDOW
const H = HIDDEN
const KEYS = ['Wz', 'Wr', 'Wn', 'Rz', 'Rr', 'Rn', 'bzIn', 'brIn', 'bnIn', 'bzRec', 'brRec', 'bnRec', 'Wo', 'bo']
const DIMS = {
  Wz: F * H, Wr: F * H, Wn: F * H,
  Rz: H * H, Rr: H * H, Rn: H * H,
  bzIn: H, brIn: H, bnIn: H, bzRec: H, brRec: H, bnRec: H,
  Wo: H * OUT_DIM, bo: OUT_DIM,
}

// ── helpers ──────────────────────────────────────────────────────────────────
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)
const clamp01 = (x) => clamp(x, 0, 1)
const sigmoid = (x) => 1 / (1 + Math.exp(-x))

function gauss(rng) {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function toF64(weights) {
  const out = {}
  for (const key of KEYS) out[key] = Float64Array.from(weights[key])
  return out
}

function zeroGrads() {
  const g = {}
  for (const key of KEYS) g[key] = new Float64Array(DIMS[key])
  return g
}

// ── synthetic run windows ────────────────────────────────────────────────────
function generateSample(rng, tp) {
  const raw = new Float64Array(T * F)
  const outcomes = []
  const mode = rng()
  let outcome = 0.55
  let relV = (rng() * 2 - 1) * 0.3
  let relA = (rng() * 2 - 1) * 0.3
  const trend = mode < 0.25 ? 0.8 : mode < 0.5 ? 0.3 : mode < 0.7 ? 0.45 : 0.55

  for (let t = 0; t < T; t += 1) {
    outcome = clamp01(0.72 * outcome + 0.28 * trend + gauss(rng) * 0.1)
    outcomes.push(outcome)

    const errP = mode >= 0.5 && mode < 0.7 ? 0.55 : 0.13
    const errors = rng() < errP ? 1 + (rng() < 0.35 ? 1 : 0) : 0
    const conflict = rng() < (mode >= 0.7 ? 0.38 : 0.06) ? 1 : 0
    relV = clamp(0.82 * relV + gauss(rng) * 0.13, -0.68, 0.68)
    relA = clamp(0.82 * relA + gauss(rng) * 0.13, -0.68, 0.68)

    const steps = 1 + Math.floor(rng() * 6)
    const minutes = 1 + Math.floor(rng() * 40)

    let status = 'completed'
    if (errors >= 2 && outcome < 0.35) status = 'failed'
    else if (outcome < 0.32) status = 'aborted'
    else if (conflict && outcome < 0.5) status = 'blocked'

    const off = t * F
    raw[off + 0] = outcome
    raw[off + 1] = Math.min(1, errors / 4)
    raw[off + 2] = conflict
    raw[off + 3] = status === 'completed' ? 1 : 0
    raw[off + 4] = status === 'aborted' ? 1 : 0
    raw[off + 5] = status === 'blocked' ? 1 : 0
    raw[off + 6] = status === 'failed' ? 1 : 0
    raw[off + 7] = Math.min(1, steps / 8)
    raw[off + 8] = Math.min(1, minutes / 30)
    raw[off + 9] = 0.2 + rng() * 0.8
    raw[off + 10] = relV
    raw[off + 11] = relA
  }

  // Runtime often has fewer than eight runs; train on variable history lengths
  // so a fresh install (one or two real rows + neutral padding) behaves like the
  // steady state. Small histories are deliberately over-represented.
  const k = 1 + Math.floor(Math.pow(rng(), 1.6) * T)
  const X = new Float64Array(T * F)
  const padding = neutralRow()
  for (let i = 0; i < T - k; i += 1) {
    for (let f = 0; f < F; f += 1) X[i * F + f] = padding[f]
  }
  // The newest k rows keep their positions; only the front is padded.
  for (let i = (T - k) * F; i < T * F; i += 1) X[i] = raw[i]

  // teacher policy: momentum over the available window + conflict/error pressure
  // + a pull back toward the profile baseline (the sign matters: below baseline
  // must push the target UP, not further down).
  const last = (T - 1) * F
  const weights = [0.55, 0.25, 0.12, 0.08]
  let momentum = 0
  let weightSum = 0
  for (let i = 0; i < Math.min(4, k); i += 1) {
    momentum += weights[i] * outcomes[T - 1 - i]
    weightSum += weights[i]
  }
  momentum /= weightSum

  let conflictRate = 0
  let errorRate = 0
  const recent = Math.min(4, k)
  for (let i = 1; i <= recent; i += 1) {
    conflictRate += X[(T - i) * F + 2]
    errorRate += X[(T - i) * F + 1]
  }
  conflictRate /= recent
  errorRate /= recent
  const effort = 0.6 * X[last + 7] + 0.4 * X[last + 8]

  let targetV =
    tp.vGain * (momentum - 0.5) -
    tp.vConflict * conflictRate -
    tp.vError * errorRate -
    tp.vPull * 0.5 * X[last + 10]
  let targetA =
    tp.aError * errorRate +
    tp.aConflict * conflictRate +
    tp.aEffort * (effort - 0.4) -
    tp.aPull * 0.5 * X[last + 11]

  targetV = clamp(targetV + gauss(rng) * 0.02, -0.28, 0.28)
  targetA = clamp(targetA + gauss(rng) * 0.02, -0.19, 0.19)

  const atanh = (x) => 0.5 * Math.log((1 + x) / (1 - x))
  const tz = [
    atanh(clamp(targetV / DELTA_SCALE[0], -0.95, 0.95)),
    atanh(clamp(targetA / DELTA_SCALE[1], -0.95, 0.95)),
  ]
  return { X, tz }
}

function makeDataset(rng, tp, count) {
  const out = new Array(count)
  for (let i = 0; i < count; i += 1) out[i] = generateSample(rng, tp)
  return out
}

// ── forward with cache ───────────────────────────────────────────────────────
function forwardCached(w, X) {
  const cache = new Array(T)
  let h = new Float64Array(H)
  for (let t = 0; t < T; t += 1) {
    const x = X.subarray(t * F, (t + 1) * F)
    const z = new Float64Array(H)
    const r = new Float64Array(H)
    const n = new Float64Array(H)
    const anRec = new Float64Array(H)
    for (let i = 0; i < H; i += 1) {
      let az = w.bzIn[i] + w.bzRec[i]
      let ar = w.brIn[i] + w.brRec[i]
      let anIn = w.bnIn[i]
      let rec = w.bnRec[i]
      for (let k = 0; k < F; k += 1) {
        const xv = x[k]
        az += xv * w.Wz[k * H + i]
        ar += xv * w.Wr[k * H + i]
        anIn += xv * w.Wn[k * H + i]
      }
      for (let j = 0; j < H; j += 1) {
        const hv = h[j]
        az += hv * w.Rz[j * H + i]
        ar += hv * w.Rr[j * H + i]
        rec += hv * w.Rn[j * H + i]
      }
      z[i] = sigmoid(az)
      r[i] = sigmoid(ar)
      anRec[i] = rec
      n[i] = Math.tanh(anIn + r[i] * rec)
    }
    const hNew = new Float64Array(H)
    for (let i = 0; i < H; i += 1) hNew[i] = (1 - z[i]) * n[i] + z[i] * h[i]
    cache[t] = { x, hPrev: h, z, r, n, anRec, hNew }
    h = hNew
  }
  const hLast = h
  const zOut = [w.bo[0], w.bo[1]]
  for (let i = 0; i < H; i += 1) {
    zOut[0] += hLast[i] * w.Wo[i * OUT_DIM]
    zOut[1] += hLast[i] * w.Wo[i * OUT_DIM + 1]
  }
  return { cache, hLast, zOut }
}

function lossOnly(w, X, tz) {
  const { zOut } = forwardCached(w, X)
  const d0 = zOut[0] - tz[0]
  const d1 = zOut[1] - tz[1]
  return 0.5 * (d0 * d0 + d1 * d1)
}

// ── backward (BPTT) ──────────────────────────────────────────────────────────
function forwardBackward(w, g, X, tz) {
  const { cache, hLast, zOut } = forwardCached(w, X)
  const dz0 = zOut[0] - tz[0]
  const dz1 = zOut[1] - tz[1]
  const loss = 0.5 * (dz0 * dz0 + dz1 * dz1)

  const dh = new Float64Array(H)
  for (let i = 0; i < H; i += 1) {
    g.Wo[i * OUT_DIM] += hLast[i] * dz0
    g.Wo[i * OUT_DIM + 1] += hLast[i] * dz1
    dh[i] = w.Wo[i * OUT_DIM] * dz0 + w.Wo[i * OUT_DIM + 1] * dz1
  }
  g.bo[0] += dz0
  g.bo[1] += dz1

  const daz = new Float64Array(H)
  const dar = new Float64Array(H)
  const dan = new Float64Array(H)
  const drec = new Float64Array(H)

  for (let t = T - 1; t >= 0; t -= 1) {
    const c = cache[t]
    for (let i = 0; i < H; i += 1) {
      const dz = dh[i] * (c.hPrev[i] - c.n[i])
      const dn = dh[i] * (1 - c.z[i])
      dan[i] = dn * (1 - c.n[i] * c.n[i])
      drec[i] = dan[i] * c.r[i]
      const drPre = dan[i] * c.anRec[i]
      dar[i] = drPre * c.r[i] * (1 - c.r[i])
      daz[i] = dz * c.z[i] * (1 - c.z[i])
    }

    for (let i = 0; i < H; i += 1) {
      g.bzIn[i] += daz[i]
      g.bzRec[i] += daz[i]
      g.brIn[i] += dar[i]
      g.brRec[i] += dar[i]
      g.bnIn[i] += dan[i]
      g.bnRec[i] += drec[i]
    }
    for (let k = 0; k < F; k += 1) {
      const xv = c.x[k]
      for (let i = 0; i < H; i += 1) {
        g.Wz[k * H + i] += xv * daz[i]
        g.Wr[k * H + i] += xv * dar[i]
        g.Wn[k * H + i] += xv * dan[i]
      }
    }
    for (let j = 0; j < H; j += 1) {
      const hv = c.hPrev[j]
      for (let i = 0; i < H; i += 1) {
        g.Rz[j * H + i] += hv * daz[i]
        g.Rr[j * H + i] += hv * dar[i]
        g.Rn[j * H + i] += hv * drec[i]
      }
    }

    const dhPrev = new Float64Array(H)
    for (let j = 0; j < H; j += 1) {
      let sum = dh[j] * c.z[j]
      for (let i = 0; i < H; i += 1) {
        sum += daz[i] * w.Rz[j * H + i] + dar[i] * w.Rr[j * H + i] + drec[i] * w.Rn[j * H + i]
      }
      dhPrev[j] = sum
    }
    dh.set(dhPrev)
  }
  return loss
}

// ── Adam ─────────────────────────────────────────────────────────────────────
function makeAdam() {
  const m = {}
  const v = {}
  for (const key of KEYS) {
    m[key] = new Float64Array(DIMS[key])
    v[key] = new Float64Array(DIMS[key])
  }
  return { m, v, t: 0 }
}

function adamStep(w, g, opt, lr, batchSize, l2 = 1e-5) {
  opt.t += 1
  const b1 = 0.9
  const b2 = 0.999
  const eps = 1e-8
  const b1t = 1 - Math.pow(b1, opt.t)
  const b2t = 1 - Math.pow(b2, opt.t)
  for (const key of KEYS) {
    const wArr = w[key]
    const gArr = g[key]
    const mArr = opt.m[key]
    const vArr = opt.v[key]
    for (let i = 0; i < wArr.length; i += 1) {
      const grad = gArr[i] / batchSize + l2 * wArr[i]
      mArr[i] = b1 * mArr[i] + (1 - b1) * grad
      vArr[i] = b2 * vArr[i] + (1 - b2) * grad * grad
      const mh = mArr[i] / b1t
      const vh = vArr[i] / b2t
      wArr[i] -= (lr * mh) / (Math.sqrt(vh) + eps)
    }
  }
}

// ── gradient check ───────────────────────────────────────────────────────────
function gradcheck(w, dataset) {
  const { X, tz } = dataset[0]
  const g = zeroGrads()
  forwardBackward(w, g, X, tz)
  let worst = 0
  const eps = 1e-5
  const rng = makeRng(7)
  for (let n = 0; n < 8; n += 1) {
    const key = KEYS[Math.floor(rng() * KEYS.length)]
    const idx = Math.floor(rng() * w[key].length)
    const original = w[key][idx]
    w[key][idx] = original + eps
    const lp = lossOnly(w, X, tz)
    w[key][idx] = original - eps
    const lm = lossOnly(w, X, tz)
    w[key][idx] = original
    const numeric = (lp - lm) / (2 * eps)
    const analytic = g[key][idx]
    const denom = Math.max(1e-7, Math.abs(numeric) + Math.abs(analytic))
    const rel = Math.abs(numeric - analytic) / denom
    worst = Math.max(worst, rel)
    if (process.env.GRADCHECK_VERBOSE) {
      console.log(`  ${key}[${idx}] numeric=${numeric.toExponential(4)} analytic=${analytic.toExponential(4)} rel=${rel.toExponential(2)}`)
    }
  }
  return worst
}

// ── training ─────────────────────────────────────────────────────────────────
function trainProfile(id, tp, opts) {
  const rng = makeRng(tp.seed)
  const base = toF64(initWeights(tp.seed, { reactivity: 1 }))
  // Start the readout slightly off zero so training leaves the flat region at once.
  for (let i = 0; i < base.Wo.length; i += 1) base.Wo[i] = (rng() * 2 - 1) * 0.01

  if (opts.gradcheck) {
    const probe = makeDataset(rng, tp, 1)
    const worst = gradcheck(base, probe)
    console.log(`  gradcheck worst relative error: ${worst.toExponential(2)}`)
    if (!(worst < 1e-4)) throw new Error(`gradient check failed for ${id}: ${worst}`)
  }

  const train = makeDataset(rng, tp, opts.seqs)
  const evalSet = makeDataset(rng, tp, 64)
  const opt = makeAdam()
  const batch = opts.batch
  const order = Array.from({ length: train.length }, (_, i) => i)

  for (let epoch = 0; epoch < opts.epochs; epoch += 1) {
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = order[i]
      order[i] = order[j]
      order[j] = tmp
    }
    const lr = opts.lr / (1 + epoch * 0.03)
    for (let start = 0; start < order.length; start += batch) {
      const g = zeroGrads()
      const end = Math.min(start + batch, order.length)
      for (let b = start; b < end; b += 1) {
        const sample = train[order[b]]
        forwardBackward(base, g, sample.X, sample.tz)
      }
      adamStep(base, g, opt, lr, end - start)
    }
  }

  let evalLoss = 0
  for (const sample of evalSet) evalLoss += lossOnly(base, sample.X, sample.tz)
  evalLoss /= evalSet.length

  // Convert back to float32 for export and for the JS/ORT parity check.
  const weights = {}
  for (const key of KEYS) weights[key] = Float32Array.from(base[key])

  const bytes = buildModelBytes(weights)
  return { weights, bytes, evalLoss }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { profiles: PROFILE_IDS, epochs: 55, seqs: 224, batch: 32, lr: 0.012, gradcheck: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--profile') opts.profiles = [argv[++i]]
    else if (arg === '--epochs') opts.epochs = Number(argv[++i])
    else if (arg === '--seqs') opts.seqs = Number(argv[++i])
    else if (arg === '--batch') opts.batch = Number(argv[++i])
    else if (arg === '--lr') opts.lr = Number(argv[++i])
    else if (arg === '--gradcheck') opts.gradcheck = true
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))
const modelsDir = join(root, 'models')
const weightsDir = join(modelsDir, 'weights')
mkdirSync(weightsDir, { recursive: true })

const manifestPath = join(modelsDir, 'manifest.json')
let manifest = { schemaVersion: 1 }
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch {
  // first run: start a fresh manifest
}
manifest.format = 'dsh-emotion-profiles/models'
manifest.schemaVersion = 1
manifest.hidden = H
manifest.input = [T, F]
manifest.output = [OUT_DIM]
manifest.opset = 17
manifest.trainedAt = manifest.trainedAt ?? new Date().toISOString()
manifest.profiles = manifest.profiles ?? {}

for (const id of opts.profiles) {
  const tp = TEMPERAMENTS[id]
  if (!tp) throw new Error(`unknown profile: ${id}`)
  const started = Date.now()
  const { weights, bytes, evalLoss } = trainProfile(id, tp, opts)
  const file = `${id}.onnx`
  writeFileSync(join(modelsDir, file), bytes)
  writeFileSync(join(weightsDir, `${id}.json`), JSON.stringify(weightsToJson(weights)))

  // Behavior probe: a clearly good window and a clearly bad one.
  const good = new Float64Array(T * F)
  const bad = new Float64Array(T * F)
  for (let t = 0; t < T; t += 1) {
    good[t * F] = 0.9
    good[t * F + 3] = 1
    bad[t * F] = 0.1
    bad[t * F + 2] = 1
    bad[t * F + 4] = 1
    bad[t * F + 6] = 0.2
  }
  const gz = forwardSequence(weights, good).z
  const bz = forwardSequence(weights, bad).z

  manifest.profiles[id] = {
    file,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    seed: tp.seed,
    samples: opts.seqs,
    epochs: opts.epochs,
    evalLoss: Number(evalLoss.toFixed(6)),
    probeGood: gz.map((v, i) => Number((DELTA_SCALE[i] * Math.tanh(v)).toFixed(4))),
    probeBad: bz.map((v, i) => Number((DELTA_SCALE[i] * Math.tanh(v)).toFixed(4))),
    trainedInMs: Date.now() - started,
  }
  console.log(
    `${id.padEnd(11)} loss=${evalLoss.toFixed(4)}  good=[${manifest.profiles[id].probeGood.join(', ')}]  bad=[${manifest.profiles[id].probeBad.join(', ')}]  ${bytes.length}B  ${Date.now() - started}ms`,
  )
}

manifest.trainedAt = new Date().toISOString()
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log(`\nwrote ${opts.profiles.length} model(s) to ${modelsDir}`)
