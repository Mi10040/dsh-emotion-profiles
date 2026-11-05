/**
 * Per-profile state snapshots: `<root>/<profileId>/state.snapshot.json`.
 *
 * Writes are coalesced (a burst of runs costs one write) and atomic. The
 * plugin flushes synchronously on unload and asynchronously on the host's
 * `session/flush` checkpoint, so a crash loses at most the debounce window.
 */
import { join } from 'node:path'
import { readJson, writeJsonAtomic } from '../util/fsx.js'

export class StateStore {
  /**
   * @param {string} rootDir plugin data root
   * @param {{ logger?: object, debounceMs?: number }} options
   */
  constructor(rootDir, { logger = null, debounceMs = 800 } = {}) {
    this.rootDir = rootDir
    this.logger = logger
    this.debounceMs = debounceMs
    this.pending = new Map()
    this.timer = null
  }

  file(profileId) {
    return join(this.rootDir, profileId, 'state.snapshot.json')
  }

  load(profileId) {
    return readJson(this.file(profileId))
  }

  /** Mark a state dirty; the write lands after a short debounce. */
  save(state) {
    this.pending.set(state.profileId, state)
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flushSync()
    }, this.debounceMs)
    this.timer.unref?.()
  }

  /** Write every dirty snapshot now (sync, used by dispose and flushes). */
  flushSync() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (const state of this.pending.values()) {
      try {
        writeJsonAtomic(this.file(state.profileId), state)
      } catch (error) {
        this.logger?.warn?.(`state snapshot write failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.pending.clear()
  }

  /** Async alias so callers can await the durability checkpoint. */
  async flush() {
    this.flushSync()
  }

  /** Write immediately (profile switch: the old state must not wait for debounce). */
  saveNow(state) {
    this.pending.delete(state.profileId)
    writeJsonAtomic(this.file(state.profileId), state)
  }
}
