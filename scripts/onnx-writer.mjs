/**
 * Minimal ONNX writer for the emotion net — no npm dependency, no Python.
 *
 * It emits a ModelProto whose graph is the GRU unrolled over the fixed window
 * using only primitive ops (Gather / MatMul / Add / Mul / Sub / Sigmoid / Tanh).
 * Primitive unrolling was chosen over the native `GRU` operator so the shipped
 * models do not depend on whether a given onnxruntime-web build includes the
 * recurrent op kernels.
 *
 * Wire format notes: this is hand-encoded protobuf (varint / length-delimited),
 * following onnx.proto field numbers, with float tensors carried in `raw_data`.
 */
import { INPUT_DIM, WINDOW, HIDDEN, OUT_DIM } from '../src/emotion-net/net.js'

// ── protobuf primitives ──────────────────────────────────────────────────────
function uvarint(n) {
  const out = []
  let v = n
  while (v > 127) {
    out.push((v & 127) | 128)
    v = Math.floor(v / 128)
  }
  out.push(v)
  return Buffer.from(out)
}

function tag(field, wire) {
  return uvarint(field * 8 + wire)
}

function fVarint(field, value) {
  return Buffer.concat([tag(field, 0), uvarint(value)])
}

function fBytes(field, buf) {
  return Buffer.concat([tag(field, 2), uvarint(buf.length), buf])
}

function fString(field, s) {
  return fBytes(field, Buffer.from(s, 'utf8'))
}

// ── ONNX messages ────────────────────────────────────────────────────────────
function tensor({ name, dims, data, dataType = 1 }) {
  const parts = []
  for (const d of dims) parts.push(fVarint(1, d))
  parts.push(fVarint(2, dataType))

  let raw
  if (dataType === 7) {
    const big = data instanceof BigInt64Array ? data : BigInt64Array.from(data.map((v) => BigInt(v)))
    raw = Buffer.from(big.buffer, big.byteOffset, big.byteLength)
  } else {
    const f32 = data instanceof Float32Array ? data : Float32Array.from(data)
    raw = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength)
  }
  parts.push(fString(8, name))
  parts.push(fBytes(9, raw))
  return Buffer.concat(parts)
}

function dimProto(value) {
  return fVarint(1, value) // Dimension.dim_value
}

function valueInfo(name, dims) {
  const shape = Buffer.concat(dims.map((d) => fBytes(1, dimProto(d)))) // TensorShapeProto.dim
  const tensorType = Buffer.concat([fVarint(1, 1 /* FLOAT */), fBytes(2, shape)])
  const type = fBytes(1, tensorType) // TypeProto.tensor_type
  return Buffer.concat([fString(1, name), fBytes(2, type)])
}

function attrInt(name, value) {
  return Buffer.concat([fString(1, name), fVarint(3, value), fVarint(20, 2 /* INT */)])
}

function node({ opType, inputs, outputs, name, attrs = [] }) {
  const parts = []
  for (const i of inputs) parts.push(fString(1, i))
  for (const o of outputs) parts.push(fString(2, o))
  if (name) parts.push(fString(3, name))
  parts.push(fString(4, opType))
  for (const a of attrs) parts.push(fBytes(5, a))
  return Buffer.concat(parts)
}

function graph({ nodes, initializers, inputs, outputs, name }) {
  const parts = []
  for (const n of nodes) parts.push(fBytes(1, n))
  parts.push(fString(2, name))
  for (const t of initializers) parts.push(fBytes(5, t))
  for (const v of inputs) parts.push(fBytes(11, v))
  for (const v of outputs) parts.push(fBytes(12, v))
  return Buffer.concat(parts)
}

function model({ graphProto, opset = 17, producer = 'dsh-emotion-profiles' }) {
  const opsetId = Buffer.concat([fString(1, ''), fVarint(2, opset)])
  return Buffer.concat([
    fVarint(1, 8), // ir_version
    fString(2, producer),
    fString(3, '0.1.0'),
    fBytes(7, graphProto),
    fBytes(8, opsetId),
  ])
}

// ── graph construction ───────────────────────────────────────────────────────
const H = HIDDEN
const F = INPUT_DIM
const T = WINDOW

function vec(a, b) {
  const out = new Float32Array(H)
  for (let i = 0; i < H; i += 1) out[i] = a[i] + b[i]
  return out
}

/**
 * Build the ONNX model bytes for one weights object.
 * Graph: runs[8,12] -> unrolled GRU -> readout -> delta[2].
 * @param {object} w weights from src/emotion-net/net.js
 * @returns {Buffer}
 */
export function buildModelBytes(w) {
  const nodes = []
  const inits = []
  const init = (name, dims, data, dataType) => inits.push(tensor({ name, dims, data, dataType }))

  init('Wz', [F, H], w.Wz)
  init('Wr', [F, H], w.Wr)
  init('Wn', [F, H], w.Wn)
  init('Rz', [H, H], w.Rz)
  init('Rr', [H, H], w.Rr)
  init('Rn', [H, H], w.Rn)
  init('bz', [H], vec(w.bzIn, w.bzRec))
  init('br', [H], vec(w.brIn, w.brRec))
  init('bnIn', [H], w.bnIn)
  init('bnRec', [H], w.bnRec)
  init('Wo', [H, OUT_DIM], w.Wo)
  init('bo', [OUT_DIM], w.bo)
  init('ones', [H], new Float32Array(H).fill(1))
  init('h0', [H], new Float32Array(H))

  const op = (opType, inputs, outputs, attrs) => nodes.push(node({ opType, inputs, outputs, attrs }))

  let h = 'h0'
  for (let t = 0; t < T; t += 1) {
    init(`idx${t}`, [], BigInt64Array.of(BigInt(t)), 7)
    op('Gather', ['runs', `idx${t}`], [`x${t}`], [attrInt('axis', 0)])

    // update gate
    op('MatMul', [`x${t}`, 'Wz'], [`xz${t}`])
    op('MatMul', [h, 'Rz'], [`hz${t}`])
    op('Add', [`xz${t}`, `hz${t}`], [`zsum${t}`])
    op('Add', [`zsum${t}`, 'bz'], [`zpre${t}`])
    op('Sigmoid', [`zpre${t}`], [`z${t}`])

    // reset gate
    op('MatMul', [`x${t}`, 'Wr'], [`xr${t}`])
    op('MatMul', [h, 'Rr'], [`hr${t}`])
    op('Add', [`xr${t}`, `hr${t}`], [`rsum${t}`])
    op('Add', [`rsum${t}`, 'br'], [`rpre${t}`])
    op('Sigmoid', [`rpre${t}`], [`r${t}`])

    // candidate
    op('MatMul', [`x${t}`, 'Wn'], [`xn${t}`])
    op('Add', [`xn${t}`, 'bnIn'], [`xni${t}`])
    op('MatMul', [h, 'Rn'], [`hn${t}`])
    op('Add', [`hn${t}`, 'bnRec'], [`hni${t}`])
    op('Mul', [`r${t}`, `hni${t}`], [`rn${t}`])
    op('Add', [`xni${t}`, `rn${t}`], [`npre${t}`])
    op('Tanh', [`npre${t}`], [`n${t}`])

    // new hidden state
    op('Sub', ['ones', `z${t}`], [`omz${t}`])
    op('Mul', [`omz${t}`, `n${t}`], [`a1${t}`])
    op('Mul', [`z${t}`, h], [`a2${t}`])
    op('Add', [`a1${t}`, `a2${t}`], [`h${t + 1}`])
    h = `h${t + 1}`
  }

  op('MatMul', [h, 'Wo'], ['readout'])
  op('Add', ['readout', 'bo'], ['delta'])

  const graphProto = graph({
    nodes,
    initializers: inits,
    inputs: [valueInfo('runs', [T, F])],
    outputs: [valueInfo('delta', [OUT_DIM])],
    name: 'emotion-net',
  })
  return model({ graphProto })
}
