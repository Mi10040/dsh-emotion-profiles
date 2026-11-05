/**
 * Pure-Node smoke test for the plugin internals (no Harness required).
 *
 *   node test/smoke.mjs
 *
 * Covers: registry, state math, mood rendering, run schema/collection, run
 * persistence, ONNX inference through the vendored runtime, and consolidation
 * export.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import { ProfileRegistry } from '../src/registry/registry.js'
import { createState, decayToward, applyDelta, fromSnapshot } from '../src/state/model.js'
import { renderMoodText, charLength } from '../src/context/render.js'
import { buildRunRecord, validateRunRecord, computeOutcomeScore } from '../src/run-source/schema.js'
import { RunCollector } from '../src/run-source/index.js'
import { RunStore } from '../src/run-source/store.js'
import { NetRunner } from '../src/emotion-net/runner.js'
import { buildWindow, rowFromRun } from '../src/emotion-net/features.js'
import { exportConsolidation } from '../src/consolidation/export.js'
import { openActiveStore } from '../src/state/active-domain.js'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..')
const root = mkdtempSync(join(tmpdir(), 'emotion-profiles-smoke-'))
let passed = 0

function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1
      console.log(`  ok   ${name}`)
    })
    .catch((error) => {
      console.error(`  FAIL ${name}`)
      throw error
    })
}

function fakeCtx() {
  const handlers = new Map()
  return {
    handlers,
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(handler)
      return () => handlers.set(event, (handlers.get(event) ?? []).filter((entry) => entry !== handler))
    },
    emit(event, ...args) {
      for (const handler of handlers.get(event) ?? []) handler(...args)
    },
    get() {
      return null
    },
  }
}

try {
  await ok('registry loads 12 built-ins and rejects bad ids', () => {
    const registry = new ProfileRegistry(root).load()
    assert.equal(registry.list().length, 12)
    assert.equal(registry.resolve('温柔').id, 'gentle')
    assert.equal(registry.resolve('GENTLE').id, 'gentle')
    assert.throws(() => registry.add({ id: 'Bad Id', name: 'x' }), /invalid-profile-id/)
    const created = registry.add({ id: 'muse', name: '缪斯', baseline: { valence: 0.4, arousal: 0.5 }, halfLifeHours: 4 })
    assert.equal(created.net, 'gentle')
    assert.equal(created.netProfile, 'gentle')
    assert.equal(new ProfileRegistry(root).load().get('muse').name, '缪斯')
  })

  await ok('state decays toward baseline and respects half-life', () => {
    const registry = new ProfileRegistry(root).load()
    const profile = registry.get('calm')
    const state = createState(profile, Date.now() - 12 * 3600_000)
    state.valence = 1
    state.arousal = 0
    decayToward(state, Date.now(), { strength: 1, enabled: true })
    // One half-life: halfway between the current value and the baseline.
    assert.ok(Math.abs(state.valence - (0.2 + (1 - 0.2) * 0.5)) < 0.02, `valence ${state.valence}`)
    const restored = fromSnapshot(JSON.parse(JSON.stringify(state)), profile)
    assert.ok(restored)
    assert.equal(restored.profileId, 'calm')
  })

  await ok('mood line stays within 60 code points and omits numbers', () => {
    const registry = new ProfileRegistry(root).load()
    const profile = registry.get('angry')
    const state = createState(profile)
    state.valence = -0.8
    state.arousal = 0.9
    state.bands = { valence: 0, arousal: 2 }
    const text = renderMoodText({ profile, state, maxChars: 60 })
    assert.ok(charLength(text) <= 60, `length ${charLength(text)}: ${text}`)
    assert.ok(text.includes('愤怒'))
    assert.ok(!/[0-9]/.test(text))
    for (const id of registry.list().map((p) => p.id)) {
      const p = registry.get(id)
      const s = createState(p)
      for (const bands of [
        { valence: 0, arousal: 0 },
        { valence: 4, arousal: 2 },
        { valence: 2, arousal: 1 },
      ]) {
        s.bands = bands
        const line = renderMoodText({ profile: p, state: s, maxChars: 60 })
        assert.ok(charLength(line) <= 60, `${id}: ${charLength(line)} ${line}`)
      }
    }
  })

  await ok('run schema scores outcomes and validates', () => {
    assert.equal(computeOutcomeScore({ status: 'completed', toolErrorCount: 0, conflictFlag: false, assistantChars: 600 }), 0.9)
    assert.ok(computeOutcomeScore({ status: 'failed', toolErrorCount: 3, conflictFlag: true }) < 0.1)
    const record = buildRunRecord({ sessionId: 's1', turn: 2, startedAt: 1, endedAt: 2, status: 'completed', firstUserGoal: 'do it', summary: 'done' })
    validateRunRecord(record)
    assert.throws(() => validateRunRecord({ ...record, status: 'weird' }), /unexpected status/)
  })

  await ok('collector turns host events into one RunRecord', () => {
    const ctx = fakeCtx()
    const records = []
    const collector = new RunCollector({ onRun: (record) => records.push(record), onFlush: () => {} })
    const detach = collector.attach(ctx)
    const session = { id: 'session-1' }
    ctx.emit('session/event', session, { type: 'turn/start', time: 1000, data: { turn: 1 } })
    ctx.emit('session/event', session, {
      type: 'user/message',
      time: 1001,
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '这个不对，重来' }] },
    })
    ctx.emit('session/event', session, { type: 'step/end', time: 1002, data: { turn: 1, step: 1 } })
    ctx.emit('session/event', session, { type: 'tool/result', time: 1003, data: { turn: 1, step: 1, error: { name: 'X', code: 'E' } } })
    ctx.emit('session/event', session, {
      type: 'assistant/message',
      time: 1004,
      data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '已经改好' }] } },
    })
    ctx.emit('session/event', session, { type: 'turn/end', time: 1005, data: { turn: 1, reason: { kind: 'completed' } } })
    assert.equal(records.length, 1)
    const record = records[0]
    assert.equal(record.id, 'session-1:1')
    assert.equal(record.status, 'completed')
    assert.equal(record.conflictFlag, true)
    assert.equal(record.toolErrorCount, 1)
    assert.equal(record.firstUserGoal, '这个不对，重来')
    assert.equal(record.summary, '已经改好')
    assert.ok(record.outcomeScore > 0 && record.outcomeScore < 0.8)
    detach()
    ctx.emit('session/event', session, { type: 'turn/start', time: 2000, data: { turn: 2 } })
    assert.equal(collector.turns.size, 0)
  })

  await ok('run store writes and reads back a record', async () => {
    const store = new RunStore(root, { retentionDays: 30, maxTotal: 100 }, null)
    const record = buildRunRecord({ sessionId: 's/1', turn: 3, status: 'completed' })
    record.emotion = { valenceBefore: 0, arousalBefore: 0.5, valenceAfter: 0.1, arousalAfter: 0.5, deltaV: 0.1, deltaA: 0 }
    store.enqueue(record)
    await store.flush()
    const loaded = store.loadAll()
    assert.equal(loaded.length, 1)
    assert.equal(loaded[0].id, 's/1:3')
  })

  await ok('features build a fixed window with neutral padding', () => {
    const registry = new ProfileRegistry(root).load()
    const profile = registry.get('gentle')
    const row = rowFromRun({ outcomeScore: 0.8, status: 'completed', toolErrorCount: 0, signals: { steps: 2 }, durationMs: 1000 }, profile.baseline)
    const window = buildWindow([row])
    assert.equal(window.length, 8 * 12)
    assert.ok(Math.abs(window[7 * 12] - 0.8) < 1e-6)
    assert.equal(window[0], 0.5) // neutral padding row
  })

  await ok('ONNX runner infers through the vendored runtime', async () => {
    const runner = new NetRunner({ modelsDir: join(pkgDir, 'models'), vendorDir: join(pkgDir, 'vendor', 'ort'), enabled: true })
    const window = new Float32Array(8 * 12)
    const good = await runner.infer('gentle', window)
    assert.ok(Array.isArray(good) && good.length === 2)
    assert.ok(good.every((v) => Number.isFinite(v)))
    assert.ok(Math.abs(good[0]) <= 0.3001)
    // A clearly bad window should move valence down for the gentle net.
    const bad = new Float32Array(8 * 12)
    for (let t = 0; t < 8; t += 1) {
      bad[t * 12] = 0.1
      bad[t * 12 + 2] = 1
      bad[t * 12 + 4] = 1
      bad[t * 12 + 6] = 0.2
    }
    const sad = await runner.infer('gentle', bad)
    assert.ok(sad[0] < 0, `expected a negative delta, got ${sad[0]}`)
    await runner.dispose()
    assert.equal(await runner.infer('gentle', window), null)
  })

  await ok('consolidation export writes a dataset and manifest', async () => {
    const registry = new ProfileRegistry(root).load()
    const profiles = new Map(registry.list().map((profile) => [profile.id, profile]))
    const record = buildRunRecord({ sessionId: 's1', turn: 5, status: 'completed' })
    record.profileId = 'gentle'
    record.emotion = { valenceBefore: 0.3, arousalBefore: 0.3, valenceAfter: 0.4, arousalAfter: 0.3, deltaV: 0.1, deltaA: 0 }
    const result = exportConsolidation({ rootDir: root, records: [record], profiles })
    assert.equal(result.count, 1)
    assert.ok(existsSync(join(result.dir, 'manifest.json')))
    const line = readFileSync(join(result.dir, 'dataset.jsonl'), 'utf8').trim().split('\n')[0]
    assert.equal(JSON.parse(line).profileId, 'gentle')
  })

  await ok('active store falls back to a file without storageDomain', async () => {
    const ctx = { get: () => null }
    const store = await openActiveStore(ctx, { rootDir: root })
    assert.equal(store.mode, 'file')
    assert.equal(await store.get(), null)
    await store.set('gentle')
    assert.equal(await store.get(), 'gentle')
    await store.close()
  })

  await ok('state survives a restart', () => {
    const registry = new ProfileRegistry(root).load()
    const profile = registry.get('gentle')
    const state = createState(profile)
    applyDelta(state, [0.1, 0.05], { runId: 'r1' })
    const restored = fromSnapshot(JSON.parse(JSON.stringify(state)), profile)
    assert.ok(restored)
    assert.equal(restored.revision, 1)
    assert.equal(restored.bands.valence, state.bands.valence)
  })

  console.log(`\n${passed} checks passed`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  rmSync(root, { recursive: true, force: true })
}
