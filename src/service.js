/**
 * The plugin's runtime state machine.
 *
 * One service instance owns: the profile registry, the active-profile domain,
 * every profile's state snapshot, the run history window, the ONNX runner and
 * the turn collector. `index.js` wires it to the plugin context; the tool and
 * the settings API only call the methods below.
 */
import { join } from 'node:path'
import { ProfileRegistry } from './registry/registry.js'
import { RunStore } from './run-source/store.js'
import { RunCollector } from './run-source/index.js'
import { validateRunRecord } from './run-source/schema.js'
import { StateStore } from './state/snapshot.js'
import { openActiveStore } from './state/active-domain.js'
import { createState, decayToward, applyDelta, fromSnapshot } from './state/model.js'
import { NetRunner } from './emotion-net/runner.js'
import { buildWindow, rowFromRun } from './emotion-net/features.js'
import { renderMoodText } from './context/render.js'
import { exportConsolidation as writeConsolidation } from './consolidation/export.js'
import { normalizeConfig } from './config.js'
import { mergeOverrides, writeSettingsOverrides } from './settings.js'

const HISTORY_LIMIT = 16

function describeProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    nameEn: profile.nameEn,
    description: profile.description,
    descriptionEn: profile.descriptionEn,
    builtin: Boolean(profile.builtin),
    halfLifeHours: profile.halfLifeHours,
    start: profile.start,
    baseline: profile.baseline,
    net: profile.net || profile.id,
  }
}

export class EmotionService {
  constructor({ ctx, config, rowConfig, overrides, rootDir, pkgDir, logger, version }) {
    this.ctx = ctx
    this.config = config
    this.rowConfig = rowConfig ?? {}
    this.overrides = overrides ?? {}
    this.rootDir = rootDir
    this.pkgDir = pkgDir
    this.logger = logger ?? null
    this.version = version
    this.activeId = null
    this.state = null
    this.ready = false
    this.queue = Promise.resolve()
    this.histories = new Map()
    this.lastRun = null
  }

  /** Load durable data, resolve the active profile and prepare the collector. */
  async init() {
    this.registry = new ProfileRegistry(this.rootDir).load()
    this.runStore = new RunStore(this.rootDir, this.config.runs, this.logger)
    this.stateStore = new StateStore(this.rootDir, { logger: this.logger })
    this.runner = new NetRunner({
      modelsDir: join(this.pkgDir, 'models'),
      vendorDir: join(this.pkgDir, 'vendor', 'ort'),
      enabled: this.config.net.enabled,
      logger: this.logger,
    })
    this.collector = new RunCollector({
      onRun: (record) => this.ingest(record),
      onFlush: () => this.flush(),
      logger: this.logger,
      debug: this.config.debug,
    })

    for (const record of this.runStore.seed(96)) {
      if (record?.profileId && this.registry.has(record.profileId)) this.historyFor(record.profileId).push(record)
    }

    this.activeStore = await openActiveStore(this.ctx, { rootDir: this.rootDir, logger: this.logger })
    const recorded = await this.activeStore.get()
    let profile = recorded ? this.registry.get(recorded) : null
    if (!profile) profile = this.registry.get(this.config.defaultProfile) ?? this.registry.list()[0]
    this.activeId = profile.id
    if (recorded !== profile.id) {
      try {
        await this.activeStore.set(profile.id)
      } catch (error) {
        this.logger?.warn?.(`could not persist the initial active profile: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    this.state = fromSnapshot(this.stateStore.load(profile.id), profile) ?? createState(profile)
    decayToward(this.state, Date.now(), this.config.decay)
    this.stateStore.saveNow(this.state)
    this.ready = true
    return this
  }

  historyFor(profileId) {
    if (!this.histories.has(profileId)) this.histories.set(profileId, [])
    return this.histories.get(profileId)
  }

  /** Queue one RunRecord through the state machine (serialized, never thrown). */
  ingest(record) {
    this.queue = this.queue
      .then(() => this.handleRun(record))
      .catch((error) => {
        this.logger?.warn?.(`emotion run failed: ${error instanceof Error ? error.message : String(error)}`)
        return null
      })
    return this.queue
  }

  async handleRun(rawRecord) {
    const profile = this.registry.get(this.activeId)
    if (!profile) return null
    const now = Date.now()
    decayToward(this.state, now, this.config.decay)

    const valenceBefore = this.state.valence
    const arousalBefore = this.state.arousal
    const staged = {
      ...rawRecord,
      profileId: profile.id,
      emotion: {
        valenceBefore,
        arousalBefore,
        valenceAfter: valenceBefore,
        arousalAfter: arousalBefore,
        deltaV: 0,
        deltaA: 0,
      },
    }

    const rows = this.historyFor(profile.id).map((entry) => rowFromRun(entry, profile.baseline))
    rows.push(rowFromRun(staged, profile.baseline))
    const window = buildWindow(rows)

    let delta = null
    if (this.config.net.enabled) delta = await this.runner.infer(profile.net || profile.id, window)
    const applied = delta ?? [0, 0]

    applyDelta(this.state, applied, { now: Date.now(), runId: staged.id })
    staged.emotion = {
      valenceBefore,
      arousalBefore,
      valenceAfter: this.state.valence,
      arousalAfter: this.state.arousal,
      deltaV: applied[0],
      deltaA: applied[1],
    }
    validateRunRecord(staged)

    this.historyFor(profile.id).push(staged)
    if (this.historyFor(profile.id).length > HISTORY_LIMIT) this.historyFor(profile.id).shift()

    this.stateStore.save(this.state)
    if (this.config.runs.enabled) this.runStore.enqueue(staged)
    this.lastRun = staged
    if (this.config.debug) {
      this.logger?.debug?.(
        `emotion ${profile.id}: v=${this.state.valence.toFixed(3)} a=${this.state.arousal.toFixed(3)} delta=[${applied[0].toFixed(3)}, ${applied[1].toFixed(3)}]`,
      )
    }
    return staged
  }

  /**
   * Switch the active profile. The previous profile's state is flushed first;
   * the next profile resumes its own persisted state (or its start state).
   */
  async switchProfile(key, source = 'api') {
    const profile = this.registry.resolve(key)
    if (!profile) throw new Error(`unknown-profile: ${key}`)
    if (profile.id === this.activeId) return this.view()

    // Drain an in-flight run first, so the old profile's last delta lands in the
    // old snapshot instead of the new profile's state.
    try {
      await this.queue
    } catch {
      // ingest() already contains its own failures
    }

    this.stateStore.saveNow(decayToward(this.state, Date.now(), this.config.decay))
    await this.activeStore.set(profile.id)
    this.activeId = profile.id

    const loaded = this.stateStore.load(profile.id)
    this.state = fromSnapshot(loaded, profile) ?? createState(profile)
    decayToward(this.state, Date.now(), this.config.decay)
    // A switch is a durable event: persist the new profile's snapshot now.
    this.stateStore.saveNow(this.state)
    this.logger?.debug?.(`emotion profile → ${profile.id} (${source})`)
    return this.view()
  }

  /** Create a custom profile and activate it. */
  async createProfile(input) {
    const profile = this.registry.add(input)
    await this.switchProfile(profile.id, 'create')
    return profile
  }

  /** Apply a settings patch from the UI, persist it and re-normalize config. */
  updateSettings(patch) {
    this.overrides = mergeOverrides(this.overrides, patch)
    writeSettingsOverrides(this.rootDir, this.overrides)
    const merged = { ...this.rowConfig }
    for (const key of ['injection', 'decay', 'runs', 'net', 'consolidation']) {
      if (this.rowConfig[key] || this.overrides[key]) merged[key] = { ...(this.rowConfig[key] ?? {}), ...(this.overrides[key] ?? {}) }
    }
    if (this.overrides.defaultProfile) merged.defaultProfile = this.overrides.defaultProfile
    this.config = normalizeConfig(merged)
    if (!this.config.decay.enabled) decayToward(this.state, Date.now(), { enabled: false })
    return this.config
  }

  moodText() {
    if (!this.ready || !this.config.injection.enabled) return ''
    const profile = this.registry.get(this.activeId)
    if (!profile || !this.state) return ''
    return renderMoodText({ profile, state: this.state, maxChars: this.config.injection.maxChars })
  }

  stateView() {
    return {
      profileId: this.activeId,
      valence: this.state.valence,
      arousal: this.state.arousal,
      baseline: this.state.baseline,
      halfLifeHours: this.state.halfLifeHours,
      bands: this.state.bands,
      revision: this.state.revision,
      updatedAt: this.state.updatedAt,
      recent: Array.isArray(this.state.recent) ? this.state.recent.slice(-16) : [],
    }
  }

  view() {
    const profile = this.registry.get(this.activeId)
    return {
      active: this.activeId,
      profile: profile ? describeProfile(profile) : null,
      state: this.stateView(),
      moodText: this.moodText(),
    }
  }

  snapshot() {
    const profiles = this.registry.list()
    const available = {}
    for (const profile of profiles) {
      const net = profile.net || profile.id
      if (!(net in available)) available[net] = this.runner.hasModel(net)
    }
    return {
      version: this.version,
      root: this.rootDir,
      active: this.activeId,
      storage: { mode: this.activeStore.mode },
      state: this.stateView(),
      mood: this.moodText(),
      profiles: profiles.map(describeProfile),
      settings: this.config,
      runs: this.runStore.recent(12),
      nets: { dir: join(this.pkgDir, 'models'), available },
      warnings: this.registry.warnings,
      lastRun: this.lastRun,
    }
  }

  async exportConsolidation() {
    if (!this.config.consolidation.exportEnabled) throw new Error('consolidation export is disabled')
    const records = this.runStore.loadAll(5000)
    const profiles = new Map(this.registry.list().map((profile) => [profile.id, profile]))
    return writeConsolidation({ rootDir: this.rootDir, records, profiles })
  }

  async flush() {
    this.stateStore.flushSync()
    await this.runStore.flush()
  }

  async dispose() {
    this.ready = false
    try {
      this.stateStore.flushSync()
    } catch {
      // best effort
    }
    try {
      await this.runStore.flush()
    } catch {
      // best effort
    }
    try {
      await this.runner.dispose()
    } catch {
      // sessions already released
    }
    try {
      await this.activeStore?.close?.()
    } catch {
      // domain already closed
    }
  }
}
