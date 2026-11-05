/**
 * dsh-emotion-profiles — Host entry.
 *
 * Wires the service into the plugin context and owns the lifecycle contract:
 * every registration is an effect, so unloading the plugin removes the turn
 * listeners, releases the ONNX sessions, flushes state/run snapshots and closes
 * the active-profile storage domain.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeConfig, resolveRootDir, PLUGIN_VERSION } from './config.js'
import { EmotionService } from './service.js'
import { makeSwitchTool } from './tools/switch-profile.js'
import { registerRoutes } from './http/routes.js'
import { readSettingsOverrides } from './settings.js'
import { ensureDir } from './util/fsx.js'

export const name = 'emotion-profiles'

/** `systemPrompt` supplies runtime-context; `tools` hosts emotion_switch_profile. */
export const inject = ['tools', 'systemPrompt']

const CONFIG_SECTIONS = ['injection', 'decay', 'runs', 'net', 'consolidation']

function mergeConfig(rowConfig, overrides) {
  const merged = { ...rowConfig }
  for (const key of CONFIG_SECTIONS) {
    if (rowConfig?.[key] || overrides?.[key]) merged[key] = { ...(rowConfig?.[key] ?? {}), ...(overrides?.[key] ?? {}) }
  }
  if (overrides?.defaultProfile) merged.defaultProfile = overrides.defaultProfile
  if (typeof overrides?.debug === 'boolean') merged.debug = overrides.debug
  return merged
}

export async function apply(ctx, rawConfig = {}) {
  const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
  const rootDir = ensureDir(resolveRootDir())
  const rowConfig = rawConfig && typeof rawConfig === 'object' ? rawConfig : {}
  const overrides = readSettingsOverrides(rootDir) ?? {}
  const config = normalizeConfig(mergeConfig(rowConfig, overrides))

  const logger = {
    warn: (message) => {
      try {
        ctx.logger?.warn?.(`[emotion-profiles] ${message}`)
      } catch {
        // logging must never break a turn
      }
    },
    debug: (message) => {
      if (!config.debug) return
      try {
        ctx.logger?.debug?.(`[emotion-profiles] ${message}`)
      } catch {
        // ignore
      }
    },
  }

  const service = new EmotionService({
    ctx,
    config,
    rowConfig,
    overrides,
    rootDir,
    pkgDir,
    logger,
    version: PLUGIN_VERSION,
  })
  await service.init()

  // Turn hooks + teardown in one effect: unload detaches listeners, flushes both
  // snapshots synchronously, then releases ONNX sessions and the domain.
  ctx.effect(() => {
    const detach = service.collector.attach(ctx)
    return () => {
      detach()
      try {
        service.runStore.flushSync()
      } catch {
        // already flushed
      }
      try {
        service.stateStore.flushSync()
      } catch {
        // already flushed
      }
      void service.dispose()
    }
  })

  // Runtime-context contribution: a thunk, so the line is re-evaluated on every
  // assembly and a switch or a band change shows up without re-registering.
  ctx.effect(() =>
    ctx.systemPrompt.context({
      name: 'emotion-profiles/state',
      order: config.injection.order,
      text: () => service.moodText(),
    }),
  )

  ctx.effect(() => ctx.tools.register(makeSwitchTool(service)))

  const routes = registerRoutes(ctx, service, { logger })
  if (!routes) logger.debug('settings API not registered (no webServer/connection in this profile)')

  logger.debug(`ready: active=${service.activeId} storage=${service.activeStore.mode} root=${rootDir}`)
}
