/**
 * Small filesystem helpers shared by the plugin's stores.
 *
 * Every durable write is "write temp, then rename" so a crash leaves either the
 * old file or the new one, never a truncated mix. The plugin owns its own
 * directory tree (`$DSH_HOME/emotion-profiles`) and never touches another
 * plugin's files.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, appendFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Create a directory (recursively) and return it. */
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Read and parse JSON, returning null for a missing or damaged file. */
export function readJson(file) {
  try {
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Atomically replace `file` with `value` as pretty JSON. */
export function writeJsonAtomic(file, value) {
  ensureDir(dirname(file))
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

/** Atomically append one JSON line (used by the consolidation export). */
export function appendJsonLine(file, value) {
  ensureDir(dirname(file))
  appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8')
}

/** List regular files directly under `dir`, tolerating a missing directory. */
export function listFiles(dir) {
  try {
    return readdirSync(dir)
      .map((name) => join(dir, name))
      .filter((file) => {
        try {
          return statSync(file).isFile()
        } catch {
          return false
        }
      })
  } catch {
    return []
  }
}

/** Remove a file if present; never throws. */
export function removeFile(file) {
  try {
    unlinkSync(file)
  } catch {
    // already gone
  }
}

/** Replace characters that are unsafe in a single path segment. */
export function safeSegment(value, fallback = 'unknown') {
  const text = String(value ?? '').replace(/[^a-zA-Z0-9._-]/g, '_')
  return text === '' || text === '.' || text === '..' ? fallback : text.slice(0, 96)
}
