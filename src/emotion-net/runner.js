/**
 * ONNX inference for the emotion nets.
 *
 * The runtime is the onnxruntime-web WASM build vendored inside this package
 * (no npm dependency, no network). One session is created lazily per profile
 * and released on eviction or plugin unload; session creation is the only
 * expensive step, inference itself is a handful of microsecond-scale matmuls.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { scaleDelta, WINDOW, INPUT_DIM } from './net.js'

export class NetRunner {
  /**
   * @param {{ modelsDir: string, vendorDir: string, enabled?: boolean, logger?: object, cacheSize?: number }} options
   */
  constructor({ modelsDir, vendorDir, enabled = true, logger = null, cacheSize = 2 }) {
    this.modelsDir = modelsDir
    this.vendorDir = vendorDir
    this.enabled = enabled
    this.logger = logger
    this.cacheSize = Math.max(1, cacheSize)
    this.sessions = new Map()
    this.ort = null
    this.failed = false
    this.warned = false
    this.disposed = false
    this.loading = null
  }

  modelPath(profileId) {
    return join(this.modelsDir, `${profileId}.onnx`)
  }

  hasModel(profileId) {
    try {
      return existsSync(this.modelPath(profileId))
    } catch {
      return false
    }
  }

  async ensureRuntime() {
    if (this.ort) return this.ort
    if (this.loading) return this.loading
    this.loading = (async () => {
      const entry = pathToFileURL(join(this.vendorDir, 'ort.all.min.mjs')).href
      const ort = await import(entry)
      const wasmFile = join(this.vendorDir, 'ort-wasm-simd-threaded.wasm')
      ort.env.wasm.wasmBinary = readFileSync(wasmFile)
      ort.env.wasm.wasmPaths = {
        mjs: pathToFileURL(join(this.vendorDir, 'ort-wasm-simd-threaded.mjs')).href,
        wasm: pathToFileURL(wasmFile).href,
      }
      ort.env.wasm.numThreads = 1
      this.ort = ort
      return ort
    })().catch((error) => {
      this.loading = null
      this.failed = true
      throw error
    })
    return this.loading
  }

  async sessionFor(profileId) {
    const existing = this.sessions.get(profileId)
    if (existing) {
      this.sessions.delete(profileId)
      this.sessions.set(profileId, existing)
      return existing
    }
    const ort = await this.ensureRuntime()
    const bytes = readFileSync(this.modelPath(profileId))
    const session = await ort.InferenceSession.create(bytes)
    this.sessions.set(profileId, session)
    while (this.sessions.size > this.cacheSize) {
      const [oldestId, oldest] = this.sessions.entries().next().value
      this.sessions.delete(oldestId)
      try {
        await oldest.release?.()
      } catch {
        // session already gone
      }
    }
    return session
  }

  /**
   * Run one window. Returns `null` when the net is disabled, missing or broken —
   * the caller then applies a zero delta rather than guessing.
   * @param {string} profileId net id (a custom profile reuses its base net)
   * @param {Float32Array} window [WINDOW * INPUT_DIM]
   * @returns {Promise<[number, number] | null>}
   */
  async infer(profileId, window) {
    if (!this.enabled || this.disposed) return null
    if (!this.hasModel(profileId)) {
      this.warnOnce(`emotion net '${profileId}' is missing; falling back to decay-only`)
      return null
    }
    try {
      const ort = await this.ensureRuntime()
      const session = await this.sessionFor(profileId)
      const result = await session.run({
        runs: new ort.Tensor('float32', window, [WINDOW, INPUT_DIM]),
      })
      const out = result?.delta?.data
      if (!out || out.length < 2) return null
      return scaleDelta([Number(out[0]), Number(out[1])])
    } catch (error) {
      this.warnOnce(`emotion net inference failed: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  warnOnce(message) {
    if (this.warned) return
    this.warned = true
    this.logger?.warn?.(message)
  }

  /** Release every ONNX session. Safe to call twice. */
  async dispose() {
    this.disposed = true
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    for (const session of sessions) {
      try {
        await session.release?.()
      } catch {
        // already released
      }
    }
  }
}
