/**
 * Plugin configuration: defaults, normalization and the storage root.
 *
 * The row's `config` comes from `cordis.patch.yml` (a plain object), so this
 * module validates it by hand instead of pulling in a schema library — the
 * package deliberately has zero npm dependencies so it installs offline.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

export const ROOT_DIRNAME = 'emotion-profiles'
export const PLUGIN_VERSION = '0.1.0'

export const DEFAULT_CONFIG = {
  /** Profile used when no active id has ever been recorded. */
  defaultProfile: 'curious',
  injection: {
    enabled: true,
    /** Runtime-context order: after approval policy (115) and web surface (210). */
    order: 300,
    /** Hard cap for the injected Chinese mood line. */
    maxChars: 60,
  },
  decay: {
    enabled: true,
    /** Multiplier on the decay rate; 1 = each profile's configured half-life. */
    strength: 1,
  },
  runs: {
    enabled: true,
    retentionDays: 30,
    maxPerSession: 200,
    maxTotal: 2000,
  },
  net: {
    enabled: true,
    /** Number of run records the GRU sees; must match the shipped models. */
    window: 8,
  },
  consolidation: {
    exportEnabled: true,
  },
  debug: false,
}

function clampNumber(value, fallback, lo, hi) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** Merge a raw row config over the defaults and clamp every numeric field. */
export function normalizeConfig(raw) {
  const input = asObject(raw)
  const injection = asObject(input.injection)
  const decay = asObject(input.decay)
  const runs = asObject(input.runs)
  const net = asObject(input.net)
  const consolidation = asObject(input.consolidation)

  return {
    defaultProfile: typeof input.defaultProfile === 'string' && input.defaultProfile !== '' ? input.defaultProfile : DEFAULT_CONFIG.defaultProfile,
    injection: {
      enabled: injection.enabled !== false,
      order: Math.round(clampNumber(injection.order, DEFAULT_CONFIG.injection.order, 0, 100000)),
      maxChars: Math.round(clampNumber(injection.maxChars, DEFAULT_CONFIG.injection.maxChars, 12, 200)),
    },
    decay: {
      enabled: decay.enabled !== false,
      strength: clampNumber(decay.strength, 1, 0.05, 20),
    },
    runs: {
      enabled: runs.enabled !== false,
      retentionDays: Math.round(clampNumber(runs.retentionDays, 30, 1, 3650)),
      maxPerSession: Math.round(clampNumber(runs.maxPerSession, 200, 1, 5000)),
      maxTotal: Math.round(clampNumber(runs.maxTotal, 2000, 1, 100000)),
    },
    net: {
      enabled: net.enabled !== false,
      window: Math.round(clampNumber(net.window, 8, 1, 32)),
    },
    consolidation: {
      exportEnabled: consolidation.exportEnabled !== false,
    },
    debug: input.debug === true,
  }
}

/** Resolve `$DSH_HOME/emotion-profiles`, independent of any other plugin's root. */
export function resolveRootDir(env = process.env) {
  const home = env.DSH_HOME && String(env.DSH_HOME).trim() !== '' ? String(env.DSH_HOME) : join(homedir(), '.dsh')
  return join(home, ROOT_DIRNAME)
}
