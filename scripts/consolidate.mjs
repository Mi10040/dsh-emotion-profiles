/**
 * Export the offline consolidation corpus from the terminal.
 *
 *   node scripts/consolidate.mjs [--root <dir>] [--limit 5000]
 *
 * Same output as the Settings-page export: `_consolidation/<ts>/dataset.jsonl`
 * plus `manifest.json`. The running plugin never reads it back.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { ProfileRegistry } from '../src/registry/registry.js'
import { RunStore } from '../src/run-source/store.js'
import { exportConsolidation } from '../src/consolidation/export.js'

const here = dirname(fileURLToPath(import.meta.url))

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

const root = arg('root', join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'emotion-profiles'))
const limit = Number(arg('limit', '5000'))

const registry = new ProfileRegistry(root).load()
const profiles = new Map(registry.list().map((profile) => [profile.id, profile]))
const store = new RunStore(root, { retentionDays: 3650, maxTotal: 100000 })
const records = store.loadAll(limit)
const result = exportConsolidation({ rootDir: root, records, profiles })
console.log(`exported ${result.count} record(s) → ${result.dir}`)
console.log(`profiles: ${result.profiles.join(', ') || '(none)'}`)
