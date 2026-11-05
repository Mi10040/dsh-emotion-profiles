/**
 * Feasibility spike: export random weights to ONNX and compare onnxruntime-web
 * against the in-process JS forward pass. Run before generating real models.
 *
 *   node scripts/spike-parity.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as ort from '../vendor/ort/ort.all.min.mjs'
import { initWeights, forwardSequence, INPUT_DIM, WINDOW } from '../src/emotion-net/net.js'
import { buildModelBytes } from './onnx-writer.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const vendor = join(here, '..', 'vendor', 'ort')

ort.env.wasm.wasmBinary = readFileSync(join(vendor, 'ort-wasm-simd-threaded.wasm'))
ort.env.wasm.wasmPaths = {
  mjs: pathToFileURL(join(vendor, 'ort-wasm-simd-threaded.mjs')).href,
  wasm: pathToFileURL(join(vendor, 'ort-wasm-simd-threaded.wasm')).href,
}
ort.env.wasm.numThreads = 1

const weights = initWeights(20261105)
// A trained net has a non-zero readout; randomize it so the parity check
// exercises the whole hidden-state path instead of comparing zeros.
weights.Wo = Float32Array.from({ length: 96 }, (_, i) => Math.sin(i * 1.7) * 0.25)
weights.bo = Float32Array.from([0.12, -0.08])
const bytes = buildModelBytes(weights)
mkdirSync(join(here, '..', 'test', 'tmp'), { recursive: true })
const outFile = join(here, '..', 'test', 'tmp', 'spike.onnx')
writeFileSync(outFile, bytes)
console.log('model bytes:', bytes.length)

const input = new Float32Array(WINDOW * INPUT_DIM)
for (let i = 0; i < input.length; i += 1) input[i] = ((i * 37) % 101) / 100

const reference = forwardSequence(weights, input)

const session = await ort.InferenceSession.create(bytes)
const feeds = { runs: new ort.Tensor('float32', input, [WINDOW, INPUT_DIM]) }
const result = await session.run(feeds)
const got = Array.from(result.delta.data)
console.log('js      :', reference.z.map((v) => v.toFixed(6)).join(', '))
console.log('ort     :', got.map((v) => v.toFixed(6)).join(', '))
const maxDiff = Math.max(...got.map((v, i) => Math.abs(v - reference.z[i])))
console.log('max abs diff:', maxDiff)
await session.release?.()
if (!(maxDiff < 1e-4)) {
  console.error('PARITY FAILED')
  process.exit(1)
}
console.log('PARITY OK')
