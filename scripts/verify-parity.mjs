/**
 * Parity gate for the shipped models: every .onnx must match the in-process JS
 * forward on random windows, and every file must match its manifest hash.
 *
 *   node scripts/verify-parity.mjs
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as ort from '../vendor/ort/ort.all.min.mjs'
import { forwardSequence, weightsFromJson, INPUT_DIM, WINDOW, HIDDEN, OUT_DIM, makeRng } from '../src/emotion-net/net.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const models = join(root, 'models')
const vendor = join(root, 'vendor', 'ort')

ort.env.wasm.wasmBinary = readFileSync(join(vendor, 'ort-wasm-simd-threaded.wasm'))
ort.env.wasm.wasmPaths = {
  mjs: pathToFileURL(join(vendor, 'ort-wasm-simd-threaded.mjs')).href,
  wasm: pathToFileURL(join(vendor, 'ort-wasm-simd-threaded.wasm')).href,
}
ort.env.wasm.numThreads = 1

const manifest = JSON.parse(readFileSync(join(models, 'manifest.json'), 'utf8'))
if (manifest.hidden !== HIDDEN || manifest.input?.[0] !== WINDOW || manifest.input?.[1] !== INPUT_DIM || manifest.output?.[0] !== OUT_DIM) {
  throw new Error('manifest dimensions disagree with src/emotion-net/net.js')
}

let failed = 0
for (const [id, entry] of Object.entries(manifest.profiles)) {
  const bytes = readFileSync(join(models, entry.file))
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (sha !== entry.sha256) {
    console.error(`${id}: sha256 mismatch`)
    failed += 1
    continue
  }

  const weights = weightsFromJson(JSON.parse(readFileSync(join(models, 'weights', `${id}.json`), 'utf8')))
  const session = await ort.InferenceSession.create(bytes)
  let worst = 0
  const rng = makeRng(entry.seed ^ 0x5f3759df)
  for (let n = 0; n < 4; n += 1) {
    const input = new Float32Array(WINDOW * INPUT_DIM)
    for (let i = 0; i < input.length; i += 1) input[i] = rng()
    const reference = forwardSequence(weights, input).z
    const result = await session.run({ runs: new ort.Tensor('float32', input, [WINDOW, INPUT_DIM]) })
    const got = Array.from(result.delta.data)
    for (let i = 0; i < got.length; i += 1) worst = Math.max(worst, Math.abs(got[i] - reference[i]))
  }
  await session.release?.()
  if (!(worst < 1e-4)) {
    console.error(`${id}: parity ${worst.toExponential(2)}`)
    failed += 1
  } else {
    console.log(`${id.padEnd(11)} parity ${worst.toExponential(2)}  sha ok`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} model(s) failed`)
  process.exit(1)
}
console.log(`\nall ${Object.keys(manifest.profiles).length} models verified`)
