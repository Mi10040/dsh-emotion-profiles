/**
 * Emotion profile registry: the 12 built-ins plus user-created profiles.
 *
 * Built-ins live in code (they ship with the models); only custom profiles are
 * persisted, in `<root>/registry.json`. The file is an independently defined,
 * versioned JSON document — it does not reuse any other plugin's schema.
 */
import { join } from 'node:path'
import { BUILTIN_PROFILES } from './builtins.js'
import { readJson, writeJsonAtomic } from '../util/fsx.js'
import { PLUGIN_VERSION } from '../config.js'

export const REGISTRY_FORMAT = 'dsh-emotion-profiles/registry'
export const REGISTRY_SCHEMA_VERSION = 1
export const PROFILE_ID_RE = /^[a-z][a-z0-9-]{1,31}$/

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))

function number(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function text(value, fallback, max = 120) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed === '' ? fallback : trimmed.slice(0, max)
}

/** Validate and normalize a custom profile definition coming from the UI/tool. */
export function normalizeCustomProfile(input, builtinIds) {
  const raw = input && typeof input === 'object' ? input : {}
  const id = String(raw.id ?? '').trim().toLowerCase()
  if (!PROFILE_ID_RE.test(id)) throw new Error('invalid-profile-id')
  if (builtinIds.has(id)) throw new Error('invalid-profile-id')

  const start = raw.start && typeof raw.start === 'object' ? raw.start : {}
  const baseline = raw.baseline && typeof raw.baseline === 'object' ? raw.baseline : {}
  // A custom profile reuses one shipped net; an unknown request falls back to
  // the most neutral one instead of failing the whole creation.
  const requestedNet = String(raw.netProfile ?? raw.net ?? '').trim()
  const net = builtinIds.has(requestedNet) ? requestedNet : 'gentle'

  return {
    id,
    name: text(raw.name, id, 40),
    nameEn: text(raw.nameEn ?? raw.name, id, 60),
    description: text(raw.description, '', 160),
    descriptionEn: text(raw.descriptionEn ?? raw.description, '', 160),
    style: text(raw.style, '保持自然、清晰的语气', 80),
    styleEn: text(raw.styleEn ?? raw.style, 'keep a natural, clear tone', 120),
    start: {
      valence: clamp(number(start.valence, 0), -1, 1),
      arousal: clamp(number(start.arousal, 0.5), 0, 1),
    },
    baseline: {
      valence: clamp(number(baseline.valence, 0), -1, 1),
      arousal: clamp(number(baseline.arousal, 0.5), 0, 1),
    },
    halfLifeHours: clamp(number(raw.halfLifeHours, 6), 0.25, 168),
    net,
    netProfile: net,
    builtin: false,
    createdAt: number(raw.createdAt, Date.now()),
  }
}

export class ProfileRegistry {
  /**
   * @param {string} rootDir plugin data root (`$DSH_HOME/emotion-profiles`)
   */
  constructor(rootDir) {
    this.rootDir = rootDir
    this.file = join(rootDir, 'registry.json')
    this.builtins = new Map(BUILTIN_PROFILES.map((p) => [p.id, p]))
    this.custom = new Map()
    this.revision = 0
    this.warnings = []
  }

  load() {
    const doc = readJson(this.file)
    if (!doc || typeof doc !== 'object') return this
    if (doc.format !== REGISTRY_FORMAT || doc.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
      this.warnings.push(`registry.json has unknown format/version (${doc.format}/${doc.schemaVersion}); custom profiles were not loaded`)
      return this
    }
    this.revision = Number(doc.revision) || 0
    for (const entry of Array.isArray(doc.profiles) ? doc.profiles : []) {
      try {
        const profile = normalizeCustomProfile(entry, new Set(this.builtins.keys()))
        this.custom.set(profile.id, profile)
      } catch (error) {
        this.warnings.push(`skipped invalid custom profile '${entry && entry.id}': ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return this
  }

  save() {
    const doc = {
      format: REGISTRY_FORMAT,
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      pluginVersion: PLUGIN_VERSION,
      revision: this.revision + 1,
      writtenAt: Date.now(),
      profiles: [...this.custom.values()].sort((a, b) => a.createdAt - b.createdAt),
    }
    writeJsonAtomic(this.file, doc)
    this.revision = doc.revision
    return doc
  }

  /** Built-ins first (ship order), then custom profiles by creation time. */
  list() {
    return [...this.builtins.values(), ...[...this.custom.values()].sort((a, b) => a.createdAt - b.createdAt)]
  }

  has(id) {
    return this.builtins.has(id) || this.custom.has(id)
  }

  get(id) {
    return this.builtins.get(id) ?? this.custom.get(id) ?? null
  }

  /** Resolve by id, Chinese display name or English name (case-insensitive). */
  resolve(key) {
    const needle = String(key ?? '').trim()
    if (needle === '') return null
    const direct = this.get(needle.toLowerCase())
    if (direct) return direct
    const lower = needle.toLowerCase()
    for (const profile of this.list()) {
      if (profile.name === needle || profile.nameEn.toLowerCase() === lower) return profile
    }
    return null
  }

  add(input) {
    const profile = normalizeCustomProfile(input, new Set(this.builtins.keys()))
    if (this.custom.has(profile.id)) throw new Error('duplicate-profile-id')
    this.custom.set(profile.id, profile)
    this.save()
    return profile
  }

  remove(id) {
    if (!this.custom.has(id)) return false
    this.custom.delete(id)
    this.save()
    return true
  }
}
