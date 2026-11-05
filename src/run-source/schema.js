/**
 * RunRecord: the plugin's own schema for one finished turn.
 *
 * This schema is defined here and nowhere else. It is deliberately *not* the
 * recall snapshot format and shares no reader, store or directory with that
 * plugin; only the general idea (a versioned envelope, atomic writes) is
 * borrowed.
 */
import { PLUGIN_VERSION } from '../config.js'

export const RUN_FORMAT = 'dsh-emotion-profiles/run'
export const RUN_SCHEMA_VERSION = 1
export const RUN_STATUSES = ['completed', 'aborted', 'blocked', 'failed', 'empty']

const BASE_SCORE = {
  completed: 0.8,
  empty: 0.5,
  blocked: 0.4,
  aborted: 0.35,
  failed: 0.15,
}

const clamp01 = (x) => Math.min(1, Math.max(0, x))

/** Map a durable `turn/end` reason onto the record status vocabulary. */
export function statusFromReason(reason) {
  const kind = reason && typeof reason === 'object' ? reason.kind : undefined
  if (kind === 'completed') return 'completed'
  if (kind === 'aborted') return 'aborted'
  if (kind === 'blocked') return 'blocked'
  if (kind === 'failed') return 'failed'
  return reason && typeof reason === 'object' && 'error' in reason ? 'failed' : 'completed'
}

const CONFLICT_ZH = ['不对', '错了', '不是这个', '不是这样', '别这样', '不要这样', '停止', '重来', '重新来', '换个', '我说的是', '搞错']
const CONFLICT_EN = [/\bwrong\b/i, /\bactually\b/i, /\binstead\b/i, /\bstop\b/i, /\bredo\b/i, /\bthat'?s not\b/i, /\bno,\s/i]

/** Heuristic: did this message push back on or correct the agent? */
export function detectConflict(text) {
  const value = String(text ?? '')
  if (value === '') return false
  if (CONFLICT_ZH.some((needle) => value.includes(needle))) return true
  return CONFLICT_EN.some((pattern) => pattern.test(value))
}

/** Blend status, tool failures, conflict and delivered text into 0..1. */
export function computeOutcomeScore({ status, toolErrorCount = 0, conflictFlag = false, assistantChars = 0 }) {
  const base = BASE_SCORE[status] ?? BASE_SCORE.completed
  const errors = Math.min(3, Math.max(0, Number(toolErrorCount) || 0))
  const chars = Math.max(0, Number(assistantChars) || 0)
  return clamp01(base - 0.08 * errors - (conflictFlag ? 0.12 : 0) + 0.1 * Math.min(1, chars / 600))
}

function bound(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

/**
 * Assemble a RunRecord from the collector's raw turn facts.
 * @param {object} parts collected fields (see src/run-source/index.js)
 * @returns {object} a complete record without the emotion block (added later)
 */
export function buildRunRecord(parts) {
  const status = RUN_STATUSES.includes(parts.status) ? parts.status : 'completed'
  const toolErrorCount = Math.max(0, Number(parts.toolErrorCount) || 0)
  const conflictFlag = Boolean(parts.conflictFlag)
  const assistantChars = Math.max(0, Number(parts.assistantChars) || 0)
  const endedAt = Number(parts.endedAt) || Date.now()
  const startedAt = Number(parts.startedAt) || endedAt
  const record = {
    format: RUN_FORMAT,
    schemaVersion: RUN_SCHEMA_VERSION,
    pluginVersion: PLUGIN_VERSION,
    writtenAt: Date.now(),

    id: `${parts.sessionId}:${parts.turn}`,
    sessionId: String(parts.sessionId ?? ''),
    turn: Math.max(0, Math.round(Number(parts.turn) || 0)),
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),

    status,
    firstUserGoal: bound(parts.firstUserGoal, 200),
    summary: bound(parts.summary, 400),
    toolErrorCount,
    toolCallCount: Math.max(0, Number(parts.toolCallCount) || 0),
    conflictFlag,
    outcomeScore: Number(
      computeOutcomeScore({ status, toolErrorCount, conflictFlag, assistantChars }).toFixed(4),
    ),
    signals: {
      userMessages: Math.max(0, Number(parts.userMessages) || 0),
      steps: Math.max(0, Number(parts.steps) || 0),
      assistantChars,
      interrupted: Boolean(parts.interrupted),
      compacted: Boolean(parts.compacted),
      elapsedMs: Math.max(0, endedAt - startedAt),
    },
    profileId: String(parts.profileId ?? ''),
    emotion: parts.emotion ?? null,
  }
  return record
}

/** Minimal structural validation; throws with a readable reason. */
export function validateRunRecord(record) {
  if (!record || typeof record !== 'object') throw new Error('run record must be an object')
  if (record.format !== RUN_FORMAT) throw new Error(`unexpected run format: ${record.format}`)
  if (record.schemaVersion !== RUN_SCHEMA_VERSION) throw new Error(`unexpected run schema version: ${record.schemaVersion}`)
  if (typeof record.id !== 'string' || record.id === '') throw new Error('run id is required')
  if (typeof record.sessionId !== 'string' || record.sessionId === '') throw new Error('sessionId is required')
  if (!RUN_STATUSES.includes(record.status)) throw new Error(`unexpected status: ${record.status}`)
  if (typeof record.outcomeScore !== 'number' || !Number.isFinite(record.outcomeScore)) throw new Error('outcomeScore must be finite')
  if (record.emotion !== null && record.emotion !== undefined) {
    const emotion = record.emotion
    for (const key of ['valenceBefore', 'arousalBefore', 'valenceAfter', 'arousalAfter', 'deltaV', 'deltaA']) {
      if (typeof emotion[key] !== 'number' || !Number.isFinite(emotion[key])) throw new Error(`emotion.${key} must be finite`)
    }
  }
  return record
}
