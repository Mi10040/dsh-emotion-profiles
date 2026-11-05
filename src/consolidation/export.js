/**
 * Offline consolidation export (reserved interface).
 *
 * Writes a training corpus — feature windows plus the deltas and outcomes that
 * produced them — under `<root>/_consolidation/<timestamp>/`. It is read by an
 * offline retraining job, never by the running plugin; the runtime keeps
 * inference-only behavior. The Settings page exposes it as a button, and
 * `scripts/consolidate.mjs` can do the same from a terminal.
 */
import { join } from 'node:path'
import { ensureDir, appendJsonLine, writeJsonAtomic } from '../util/fsx.js'
import { rowFromRun, neutralRow } from '../emotion-net/features.js'
import { PLUGIN_VERSION } from '../config.js'

export function exportConsolidation({ rootDir, records, profiles }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(rootDir, '_consolidation', stamp)
  ensureDir(dir)
  const file = join(dir, 'dataset.jsonl')

  const sorted = [...(records ?? [])].sort((a, b) => (Number(a.endedAt) || 0) - (Number(b.endedAt) || 0))
  const histories = new Map()
  const neutral = neutralRow()
  const seenProfiles = new Set()
  let count = 0

  for (const record of sorted) {
    const profileId = record?.profileId
    const profile = profileId ? profiles.get(profileId) : null
    if (!profile || !record.emotion) continue
    const rows = histories.get(profileId) ?? []
    const row = rowFromRun(record, profile.baseline)
    const windowRows = [...rows.slice(-7), row]
    // Pad exactly like runtime does, so every exported window is trainable as-is.
    const padded = [...Array(Math.max(0, 8 - windowRows.length)).fill(neutral), ...windowRows]
    appendJsonLine(file, {
      runId: record.id,
      profileId,
      endedAt: record.endedAt,
      status: record.status,
      outcomeScore: record.outcomeScore,
      toolErrorCount: record.toolErrorCount,
      conflictFlag: record.conflictFlag,
      target: [record.emotion.deltaV ?? 0, record.emotion.deltaA ?? 0],
      rows: padded.map((entry) => Array.from(entry)),
    })
    histories.set(profileId, [...rows, row].slice(-8))
    seenProfiles.add(profileId)
    count += 1
  }

  const manifest = {
    format: 'dsh-emotion-profiles/consolidation',
    schemaVersion: 1,
    pluginVersion: PLUGIN_VERSION,
    exportedAt: new Date().toISOString(),
    records: count,
    profiles: [...seenProfiles].sort(),
    dataset: 'dataset.jsonl',
    note: 'Offline retraining corpus (feature windows + applied deltas). The runtime never reads this back.',
  }
  writeJsonAtomic(join(dir, 'manifest.json'), manifest)
  return { dir, file, count, profiles: manifest.profiles }
}
