/**
 * Runtime settings overrides edited from the settings page.
 *
 * The row config in `cordis.patch.yml` stays the deployment-owned base; the UI
 * writes only the fields it owns into `<root>/settings.json`, which is merged
 * over the row config at activation.
 */
import { join } from 'node:path'
import { readJson, writeJsonAtomic } from './util/fsx.js'
import { PLUGIN_VERSION } from './config.js'

export const SETTINGS_FILE = 'settings.json'
export const SETTINGS_FORMAT = 'dsh-emotion-profiles/settings'
export const SETTINGS_SCHEMA_VERSION = 1

const SECTIONS = ['injection', 'decay', 'runs', 'net', 'consolidation']

export function readSettingsOverrides(rootDir) {
  const doc = readJson(join(rootDir, SETTINGS_FILE))
  if (!doc || doc.format !== SETTINGS_FORMAT || doc.schemaVersion !== SETTINGS_SCHEMA_VERSION) return null
  const overrides = doc.overrides
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return null
  return overrides
}

export function writeSettingsOverrides(rootDir, overrides) {
  writeJsonAtomic(join(rootDir, SETTINGS_FILE), {
    format: SETTINGS_FORMAT,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    pluginVersion: PLUGIN_VERSION,
    writtenAt: Date.now(),
    overrides,
  })
}

/** Shallow merge for the settings sections this plugin owns. */
export function mergeOverrides(base, patch) {
  const next = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (SECTIONS.includes(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = { ...(next[key] ?? {}), ...value }
    } else if (key !== 'order') {
      next[key] = value
    }
  }
  return next
}
