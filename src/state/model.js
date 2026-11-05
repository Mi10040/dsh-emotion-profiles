/**
 * Emotion state: the per-profile numbers, their half-life decay, and the
 * application of one model delta.
 *
 * Decay order matters and is fixed here: first pull the stored state toward the
 * profile baseline for the elapsed time, then add the new run's delta, then
 * clamp. Applying in the other order would let a burst of runs outrun decay.
 */
import { nextBands } from '../context/bands.js'

export const STATE_FORMAT = 'dsh-emotion-profiles/state'
export const STATE_SCHEMA_VERSION = 1
export const RECENT_LIMIT = 32

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))

function finite(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** A fresh state for a profile that has never been used. */
export function createState(profile, now = Date.now()) {
  const state = {
    format: STATE_FORMAT,
    schemaVersion: STATE_SCHEMA_VERSION,
    profileId: profile.id,
    valence: clamp(finite(profile.start?.valence, 0), -1, 1),
    arousal: clamp(finite(profile.start?.arousal, 0.5), 0, 1),
    baseline: {
      valence: clamp(finite(profile.baseline?.valence, 0), -1, 1),
      arousal: clamp(finite(profile.baseline?.arousal, 0.5), 0, 1),
    },
    halfLifeHours: clamp(finite(profile.halfLifeHours, 6), 0.25, 168),
    revision: 0,
    updatedAt: now,
    bands: { valence: 2, arousal: 1 },
    lastRunId: null,
    recent: [],
  }
  state.bands = nextBands(state)
  return state
}

/**
 * Exponential half-life decay toward the profile baseline.
 * `k = 1 - 2^(-dt / halfLife)`.
 */
export function decayToward(state, now = Date.now(), { strength = 1, enabled = true } = {}) {
  if (!enabled) return state
  const last = finite(state.updatedAt, now)
  const dtHours = (now - last) / 3_600_000
  if (!(dtHours > 0)) return state
  const halfLife = Math.max(0.25, finite(state.halfLifeHours, 6))
  const k = 1 - Math.pow(2, (-dtHours * Math.max(0.05, strength)) / halfLife)
  const baselineV = finite(state.baseline?.valence, 0)
  const baselineA = finite(state.baseline?.arousal, 0)
  state.valence = clamp(state.valence + (baselineV - state.valence) * k, -1, 1)
  state.arousal = clamp(state.arousal + (baselineA - state.arousal) * k, 0, 1)
  state.updatedAt = now
  state.bands = nextBands(state)
  return state
}

/** Apply one net delta and record a short history entry for the settings page. */
export function applyDelta(state, delta, { now = Date.now(), runId = null } = {}) {
  const dv = finite(delta?.[0], 0)
  const da = finite(delta?.[1], 0)
  state.valence = clamp(state.valence + dv, -1, 1)
  state.arousal = clamp(state.arousal + da, 0, 1)
  state.revision = finite(state.revision, 0) + 1
  state.updatedAt = now
  state.lastRunId = runId
  state.bands = nextBands(state)
  state.recent = Array.isArray(state.recent) ? state.recent : []
  state.recent.push({ at: now, dv: Number(dv.toFixed(4)), da: Number(da.toFixed(4)), runId })
  if (state.recent.length > RECENT_LIMIT) state.recent = state.recent.slice(-RECENT_LIMIT)
  return state
}

/** Rehydrate a stored snapshot, or return null when it is unusable. */
export function fromSnapshot(snapshot, profile) {
  if (!snapshot || typeof snapshot !== 'object') return null
  if (snapshot.format !== STATE_FORMAT || snapshot.schemaVersion !== STATE_SCHEMA_VERSION) return null
  if (snapshot.profileId !== profile.id) return null
  const state = createState(profile, finite(snapshot.updatedAt, Date.now()))
  state.valence = clamp(finite(snapshot.valence, state.valence), -1, 1)
  state.arousal = clamp(finite(snapshot.arousal, state.arousal), 0, 1)
  state.halfLifeHours = clamp(finite(snapshot.halfLifeHours, state.halfLifeHours), 0.25, 168)
  state.revision = Math.max(0, Math.round(finite(snapshot.revision, 0)))
  state.lastRunId = typeof snapshot.lastRunId === 'string' ? snapshot.lastRunId : null
  state.recent = Array.isArray(snapshot.recent)
    ? snapshot.recent
        .filter((entry) => entry && typeof entry === 'object')
        .slice(-RECENT_LIMIT)
        .map((entry) => ({
          at: finite(entry.at, state.updatedAt),
          dv: finite(entry.dv, 0),
          da: finite(entry.da, 0),
          runId: typeof entry.runId === 'string' ? entry.runId : null,
        }))
    : []
  // Keep the stored band indices when present so a restart does not rewrite the prompt.
  if (snapshot.bands && Number.isInteger(snapshot.bands.valence) && Number.isInteger(snapshot.bands.arousal)) {
    state.bands = { valence: snapshot.bands.valence, arousal: snapshot.bands.arousal }
  } else {
    state.bands = nextBands(state)
  }
  return state
}
