/**
 * Render smoke test for the browser half without a browser.
 *
 *   node test/client-render.mjs
 *
 * Loads src/client.js through a fake `window.__ModuleLoader__`, registers the
 * settings page through a fake plugin context, then calls every section
 * component with a realistic snapshot using a minimal React hook shim. It
 * catches typos, missing props and hook-order mistakes before the page reaches
 * a user; it does not replace visual verification in the real browser.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// ── tiny React shim ─────────────────────────────────────────────────────────
function createReact() {
  let hooks = []
  let cursor = 0
  const React = {
    createElement(type, props) {
      const children = []
      for (let i = 2; i < arguments.length; i += 1) children.push(arguments[i])
      return { type, props: { ...(props || {}), children: children.length === 1 ? children[0] : children } }
    },
    useState(initial) {
      const index = cursor
      cursor += 1
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [
        hooks[index],
        (next) => {
          hooks[index] = typeof next === 'function' ? next(hooks[index]) : next
        },
      ]
    },
    useEffect() {
      // effects are not executed in this shim
    },
    useRef(initial) {
      const index = cursor
      cursor += 1
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
  }
  return {
    React,
    reset() {
      hooks = []
      cursor = 0
    },
  }
}

function render(Component, props) {
  shim.reset()
  return Component(props)
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (node.props) return textOf(node.props.children)
  return ''
}

const shim = createReact()
let captured = null

globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition
    },
  },
}

// The client module is a script, not an ES module: evaluate it with a fake
// CommonJS linker so its factory can require("react").
const source = readFileSync(join(root, 'src', 'client.js'), 'utf8')
const factoryFn = new Function('window', 'require', 'module', 'exports', `${source}\n;return undefined;`)
const fakeModule = { exports: {} }
factoryFn(globalThis.window, (name) => {
  if (name === 'react') return shim.React
  throw new Error(`unexpected require: ${name}`)
}, fakeModule, fakeModule.exports)

assert.ok(captured, 'client module registered through window.__ModuleLoader__')
assert.equal(captured.id, 'dsh-emotion-profiles')

const client = captured.factory((name) => {
  if (name === 'react') return shim.React
  throw new Error(`unexpected require: ${name}`)
})

assert.equal(typeof client.apply, 'function')
assert.deepEqual(client.inject, ['slots', 'locale'])
assert.ok(client.dictionaries.zh && client.dictionaries.en)

// ── fake plugin context ─────────────────────────────────────────────────────
let page = null
const registrations = []
const ctx = {
  locale: {
    register(namespace, dictionaries) {
      assert.equal(namespace, 'emotion-profiles')
      assert.ok(dictionaries.zh.section)
    },
    bind() {
      return (key) => key
    },
  },
  effect(fn) {
    fn()
  },
  slots: {
    inject(name, generator) {
      assert.equal(name, 'settings.section')
      for (const value of generator()) {
        if (value && typeof value === 'object' && value.__registration) registrations.push(value.__registration)
      }
    },
    register(options, Component) {
      page = Component
      return { __registration: options }
    },
  },
}

client.apply(ctx)
assert.ok(page, 'settings page component registered')
assert.deepEqual(registrations[0], {
  name: 'settings.section',
  id: 'emotion-profiles',
  order: 65,
  label: registrations[0].label,
  locale: 'emotion-profiles',
})

// ── realistic snapshot ──────────────────────────────────────────────────────
const data = {
  version: '0.1.0',
  root: 'C:/Users/test/.dsh/emotion-profiles',
  active: 'gentle',
  storage: { mode: 'domain' },
  state: {
    profileId: 'gentle',
    valence: 0.31,
    arousal: 0.44,
    baseline: { valence: 0.35, arousal: 0.35 },
    halfLifeHours: 6,
    bands: { valence: 3, arousal: 1 },
    revision: 3,
    updatedAt: Date.now(),
    recent: [],
  },
  mood: '当前情感：温柔（略好·中等唤醒）。语气柔和不催促，先接住情绪再给方案',
  profiles: client.dictionaries ? [
    { id: 'gentle', name: '温柔', nameEn: 'Gentle', description: '语气柔和', builtin: true, halfLifeHours: 6, net: 'gentle', start: { valence: 0.35, arousal: 0.35 }, baseline: { valence: 0.35, arousal: 0.35 } },
    { id: 'angry', name: '愤怒', nameEn: 'Angry', description: '直接强硬', builtin: true, halfLifeHours: 1.5, net: 'angry', start: { valence: -0.55, arousal: 0.8 }, baseline: { valence: -0.35, arousal: 0.6 } },
  ] : [],
  settings: {
    injection: { enabled: true, order: 300, maxChars: 60 },
    decay: { enabled: true, strength: 1 },
    runs: { enabled: true, retentionDays: 30, maxPerSession: 200, maxTotal: 2000 },
    net: { enabled: true, window: 8 },
    consolidation: { exportEnabled: true },
  },
  runs: [
    { id: 's1:3', status: 'completed', toolErrorCount: 0, outcomeScore: 0.9, endedAt: Date.now() },
    { id: 's1:2', status: 'failed', toolErrorCount: 2, outcomeScore: 0.2, endedAt: Date.now() - 60000 },
  ],
  nets: { dir: 'models', available: { gentle: true, angry: true } },
  warnings: [],
}

const { CurrentBlock, ProfileCard, CreateBlock, SettingsBlock, RunsBlock, EmotionSettingsPage } = client.__components

for (const [name, node] of Object.entries({
  loading: render(EmotionSettingsPage, {}),
  current: render(CurrentBlock, { data, profile: data.profiles[0] }),
  card: render(ProfileCard, { profile: data.profiles[1], active: false, disabled: false, onSwitch() {} }),
  create: render(CreateBlock, { data, busy: false, onCreate() {} }),
  settings: render(SettingsBlock, { data, busy: false, exportNote: '', onSettings() {}, onExport() {} }),
  runs: render(RunsBlock, { runs: data.runs }),
})) {
  const text = textOf(node)
  assert.ok(text.length > 0, `${name} rendered empty`)
  console.log(`  ok   ${name} (${text.length} chars)`)
}

// Loading page renders before any fetch resolves; the data page needs effects,
// so it is exercised through its sections above.
assert.ok(textOf(render(EmotionSettingsPage, {})).includes('title'))

// Settings row titles come from the locale keys in this shim.
const settingsText = textOf(render(SettingsBlock, { data, busy: false, exportNote: '', onSettings() {}, onExport() {} }))
assert.ok(settingsText.includes('injection'))
assert.ok(settingsText.includes('decay'))
assert.ok(settingsText.includes('retention'))

const runsText = textOf(render(RunsBlock, { runs: data.runs }))
assert.ok(runsText.includes('runTime') || runsText.includes('statusCompleted'))

console.log('\nclient render checks passed')
