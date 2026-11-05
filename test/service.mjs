/**
 * Service-level integration test: runs the real service with a fake host
 * context (no storageDomain, no web server) against a temporary data root.
 *
 *   node test/service.mjs
 *
 * Covers init/seed, run ingestion through the ONNX net, state snapshots, the
 * switch and create paths, settings overrides, mood rendering and export.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import { EmotionService } from '../src/service.js'
import { normalizeConfig } from '../src/config.js'
import { buildRunRecord } from '../src/run-source/schema.js'
import { charLength } from '../src/context/render.js'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..')
const root = mkdtempSync(join(tmpdir(), 'emotion-profiles-service-'))
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

const logger = { warn: (m) => console.error('warn:', m), debug: () => {} }
const ctx = {
  get: () => null,
  on: () => () => {},
  logger,
}

function run(turn, overrides = {}) {
  return buildRunRecord({
    sessionId: 'session-test',
    turn,
    startedAt: Date.now() - 1000,
    endedAt: Date.now(),
    status: 'completed',
    firstUserGoal: '把设置页做出来',
    summary: '已完成设置页与切换工具',
    toolErrorCount: 0,
    toolCallCount: 2,
    conflictFlag: false,
    userMessages: 1,
    steps: 1,
    assistantChars: 220,
    ...overrides,
  })
}

try {
  const service = new EmotionService({
    ctx,
    config: normalizeConfig({ debug: false }),
    rowConfig: {},
    overrides: {},
    rootDir: root,
    pkgDir,
    logger,
    version: 'test',
  })
  await service.init()

  await ok('init creates the active record and the first state snapshot', () => {
    assert.equal(service.activeId, 'curious')
    assert.equal(service.activeStore.mode, 'file')
    assert.ok(existsSync(join(root, '_active.json')))
    assert.ok(existsSync(join(root, 'curious', 'state.snapshot.json')))
    assert.ok(charLength(service.moodText()) <= 60)
  })

  await ok('a finished run updates state, writes a record and changes the mood', async () => {
    const before = service.state.valence
    const stored = await service.ingest(
      run(1, { status: 'failed', toolErrorCount: 3, conflictFlag: true, firstUserGoal: '这个不对，重来' }),
    )
    assert.ok(stored, 'run should be processed')
    assert.equal(stored.profileId, 'curious')
    assert.ok(stored.emotion.valenceAfter < before, `expected a downward move: ${before} → ${stored.emotion.valenceAfter}`)
    const file = join(root, '_runs', 'session-test', '1.json')
    assert.ok(existsSync(file), 'run record file')
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(parsed.format, 'dsh-emotion-profiles/run')
    assert.equal(parsed.profileId, 'curious')
    assert.equal(parsed.conflictFlag, true)
    assert.equal(parsed.emotion.deltaV, stored.emotion.deltaV)
    await service.flush()
    const snap = JSON.parse(readFileSync(join(root, 'curious', 'state.snapshot.json'), 'utf8'))
    assert.equal(snap.revision, 1)
    assert.ok(snap.recent.length === 1)
  })

  await ok('a good run moves valence back up (the net reacts to outcomes)', async () => {
    const before = service.state.valence
    await service.ingest(run(2, { status: 'completed', assistantChars: 900 }))
    assert.ok(service.state.valence > before, `expected an upward move: ${before} → ${service.state.valence}`)
  })

  await ok('switching profiles persists the old snapshot and restores the new one', async () => {
    const gentle = await service.switchProfile('gentle', 'test')
    assert.equal(gentle.active, 'gentle')
    assert.ok(existsSync(join(root, 'gentle', 'state.snapshot.json')))
    assert.equal(JSON.parse(readFileSync(join(root, '_active.json'), 'utf8')).activeProfileId, 'gentle')
    const back = await service.switchProfile('curious', 'test')
    assert.equal(back.active, 'curious')
    assert.ok(back.state.revision >= 2, 'curious state should keep its revision')
  })

  await ok('creating a custom profile reuses a base net and activates it', async () => {
    const created = await service.createProfile({
      id: 'muse',
      name: '缪斯',
      description: '轻快、爱打比方',
      netProfile: 'playful',
      halfLifeHours: 4,
      start: { valence: 0.4, arousal: 0.55 },
      baseline: { valence: 0.45, arousal: 0.5 },
    })
    assert.equal(created.id, 'muse')
    assert.equal(service.activeId, 'muse')
    assert.equal(service.registry.get('muse').net, 'playful')
    assert.ok(existsSync(join(root, 'muse', 'state.snapshot.json')))
    assert.equal(JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')).profiles.length, 1)
  })

  await ok('settings overrides persist and can disable injection', () => {
    service.updateSettings({ injection: { enabled: false }, decay: { strength: 1.5 } })
    assert.equal(service.config.injection.enabled, false)
    assert.equal(service.moodText(), '')
    assert.ok(existsSync(join(root, 'settings.json')))
    const saved = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'))
    assert.equal(saved.overrides.injection.enabled, false)
    service.updateSettings({ injection: { enabled: true } })
    assert.ok(service.moodText().length > 0)
  })

  await ok('consolidation export contains every recorded run', async () => {
    const result = await service.exportConsolidation()
    assert.equal(result.count, 2)
    const lines = readFileSync(result.file, 'utf8').trim().split('\n')
    assert.equal(lines.length, 2)
    const row = JSON.parse(lines[0])
    assert.equal(row.rows.length, 8)
    assert.ok(Array.isArray(row.target))
  })

  await ok('snapshot is flushed synchronously on dispose', async () => {
    await service.ingest(run(3))
    await service.dispose()
    const snap = JSON.parse(readFileSync(join(root, 'muse', 'state.snapshot.json'), 'utf8'))
    assert.ok(snap.revision >= 1)
    assert.ok(readdirSync(join(root, '_runs', 'session-test')).length >= 3)
  })

  console.log(`\n${passed} checks passed`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  rmSync(root, { recursive: true, force: true })
}
