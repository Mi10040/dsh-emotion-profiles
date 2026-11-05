/**
 * Persistence for RunRecords under `<root>/_runs/<sessionId>/<turn>.json`.
 *
 * The envelope is the plugin's own (`format` + `schemaVersion` + `writtenAt`),
 * written atomically. This store never reads or writes anything belonging to
 * another plugin.
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDir, listFiles, readJson, writeJsonAtomic, safeSegment, removeFile } from '../util/fsx.js'
import { RUN_FORMAT, RUN_SCHEMA_VERSION } from './schema.js'

const MAX_MEMORY = 256

function listDirs(dir) {
  try {
    return readdirSync(dir)
      .map((name) => join(dir, name))
      .filter((path) => {
        try {
          return statSync(path).isDirectory()
        } catch {
          return false
        }
      })
  } catch {
    return []
  }
}

export class RunStore {
  /**
   * @param {string} rootDir plugin data root
   * @param {{ retentionDays?: number, maxTotal?: number, maxPerSession?: number }} config
   * @param {{ warn?: Function, debug?: Function } | null} logger
   */
  constructor(rootDir, config = {}, logger = null) {
    this.dir = join(rootDir, '_runs')
    this.retentionDays = Number(config.retentionDays) > 0 ? Number(config.retentionDays) : 30
    this.maxTotal = Number(config.maxTotal) > 0 ? Number(config.maxTotal) : 2000
    this.logger = logger
    this.chain = Promise.resolve()
    this.memory = []
    this.pendingSync = new Map()
    this.writes = 0
    ensureDir(this.dir)
  }

  /** Newest-first in-memory view for the settings page. */
  recent(limit = 12) {
    return this.memory.slice(-limit).reverse()
  }

  remember(record) {
    this.memory.push(record)
    if (this.memory.length > MAX_MEMORY) this.memory = this.memory.slice(-MAX_MEMORY)
  }

  /** Queue one durable write; never blocks a turn. */
  enqueue(record) {
    this.remember(record)
    this.pendingSync.set(record.id, record)
    const task = this.chain.then(() => this.writeOne(record))
    this.chain = task.catch((error) => {
      this.logger?.warn?.(`run write failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    return this.chain
  }

  writeOne(record) {
    const dir = join(this.dir, safeSegment(record.sessionId))
    const file = join(dir, `${Math.max(0, record.turn)}.json`)
    writeJsonAtomic(file, record)
    this.pendingSync.delete(record.id)
    this.writes += 1
    if (this.writes % 25 === 0) this.prune()
  }

  /** Write anything still queued, synchronously (plugin unload backstop). */
  flushSync() {
    for (const record of [...this.pendingSync.values()]) {
      try {
        this.writeOne(record)
      } catch (error) {
        this.logger?.warn?.(`run flush failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.pendingSync.clear()
  }

  /** Await every queued write. */
  async flush() {
    await this.chain
  }

  /** Read the newest `limit` records from disk (used once at startup). */
  seed(limit = 64) {
    const selected = this.loadAll(limit).slice(-Math.max(0, limit))
    for (const record of selected) this.remember(record)
    return selected
  }

  /** Read every valid record from disk, oldest first (export and seeding). */
  loadAll(limit = Infinity) {
    const out = []
    for (const sessionDir of listDirs(this.dir)) {
      for (const file of listFiles(sessionDir)) {
        const record = readJson(file)
        if (!record || record.format !== RUN_FORMAT || record.schemaVersion !== RUN_SCHEMA_VERSION) continue
        out.push(record)
      }
    }
    out.sort((a, b) => (Number(a.endedAt) || 0) - (Number(b.endedAt) || 0))
    return Number.isFinite(limit) ? out.slice(-Math.max(0, limit)) : out
  }

  /** Enforce retention in both directions (age and count). Best effort. */
  prune() {
    try {
      const entries = []
      for (const sessionDir of listDirs(this.dir)) {
        for (const file of listFiles(sessionDir)) {
          const record = readJson(file)
          entries.push({ file, at: Number(record?.endedAt) || 0 })
        }
      }
      const cutoff = Date.now() - this.retentionDays * 24 * 3600_000
      let removed = 0
      for (const entry of entries) {
        if (entry.at > 0 && entry.at < cutoff) {
          removeFile(entry.file)
          removed += 1
        }
      }
      const survivors = entries.filter((entry) => !(entry.at > 0 && entry.at < cutoff))
      if (survivors.length > this.maxTotal) {
        survivors.sort((a, b) => a.at - b.at)
        for (const entry of survivors.slice(0, survivors.length - this.maxTotal)) {
          removeFile(entry.file)
          removed += 1
        }
      }
      if (removed > 0) this.logger?.debug?.(`pruned ${removed} run record(s)`)
    } catch (error) {
      this.logger?.debug?.(`run prune skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
