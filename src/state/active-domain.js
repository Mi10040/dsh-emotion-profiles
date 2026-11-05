/**
 * The active profile id: one durable record in its own storageDomain.
 *
 * The domain is named `emotion-profiles` and holds a single global record. It
 * is independent of every other plugin's domain and file tree.
 *
 * This package cannot import `@deepseek-ai/dsh-storage-domain` (it ships with
 * zero npm dependencies), so the spec is constructed locally. The facility only
 * uses `tables[].valueSchema.parse` and `global.schema.safeParse` at runtime,
 * which these structural validators provide. If a future harness requires more,
 * `open()` fails and the file fallback below keeps the plugin working.
 */
import { join } from 'node:path'
import { readJson, writeJsonAtomic, removeFile } from '../util/fsx.js'

// The storage backend's unit-name rule is `^[a-z][a-z0-9_]*$`, so the domain
// uses an underscore while the plugin's directory keeps the dashed package name.
export const ACTIVE_DOMAIN_NAME = 'emotion_profiles'
export const ACTIVE_FILE_FORMAT = 'dsh-emotion-profiles/active'
export const ACTIVE_FILE_VERSION = 1

const GLOBAL_INITIAL = { activeProfileId: '', switchedAt: 0, revision: 0 }

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function makeValidator(check, label) {
  return {
    parse(value) {
      if (!check(value)) throw new Error(`invalid ${label}`)
      return value
    },
    safeParse(value) {
      try {
        if (!check(value)) throw new Error(`invalid ${label}`)
        return { success: true, data: value }
      } catch (error) {
        return { success: false, error }
      }
    },
  }
}

const isActiveRecord = (value) =>
  isPlainObject(value) &&
  typeof value.activeProfileId === 'string' &&
  Number.isFinite(value.switchedAt) &&
  Number.isFinite(value.revision)

/** Local equivalent of `defineDomain({...})` for the active-profile record. */
export const ACTIVE_DOMAIN_SPEC = {
  name: ACTIVE_DOMAIN_NAME,
  version: 1,
  layout: 'single',
  tables: {
    meta: { valueSchema: makeValidator(isPlainObject, 'meta record') },
  },
  global: {
    schema: makeValidator(isActiveRecord, 'active record'),
    initial: { ...GLOBAL_INITIAL },
  },
}

function openFileStore(rootDir, logger) {
  const file = join(rootDir, '_active.json')
  let doc = readJson(file)
  if (!doc || doc.format !== ACTIVE_FILE_FORMAT || doc.schemaVersion !== ACTIVE_FILE_VERSION) {
    doc = { format: ACTIVE_FILE_FORMAT, schemaVersion: ACTIVE_FILE_VERSION, ...GLOBAL_INITIAL }
  }
  return {
    mode: 'file',
    file,
    get() {
      return typeof doc.activeProfileId === 'string' && doc.activeProfileId !== '' ? doc.activeProfileId : null
    },
    async set(profileId) {
      doc = {
        format: ACTIVE_FILE_FORMAT,
        schemaVersion: ACTIVE_FILE_VERSION,
        activeProfileId: profileId,
        switchedAt: Date.now(),
        revision: (Number(doc.revision) || 0) + 1,
      }
      try {
        writeJsonAtomic(file, doc)
      } catch (error) {
        logger?.warn?.(`active profile file write failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    async close() {},
  }
}

/**
 * Open the active-profile store, preferring the storageDomain facility.
 * @param {object} ctx plugin context
 * @param {{ rootDir: string, logger?: object }} options
 */
export async function openActiveStore(ctx, { rootDir, logger = null }) {
  const facility = typeof ctx.get === 'function' ? ctx.get('storageDomain') : null
  if (facility && typeof facility.open === 'function') {
    let domain = null
    let lastError = null
    for (let attempt = 0; attempt < 2 && !domain; attempt += 1) {
      try {
        domain = await facility.open(ACTIVE_DOMAIN_SPEC)
      } catch (error) {
        lastError = error
        // A hot reload can race the previous instance's close; wait one beat.
        if (attempt === 0 && /already-open/.test(error instanceof Error ? error.message : String(error))) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          continue
        }
        break
      }
    }
    if (domain) {
      let closed = false
      // One-time migration: if the earlier fallback file holds an id the domain
      // does not, adopt it before deleting the fallback.
      try {
        const fallback = readJson(join(rootDir, '_active.json'))
        const current = domain.global.get()
        if (fallback && typeof fallback.activeProfileId === 'string' && fallback.activeProfileId !== '') {
          if (!current || !current.activeProfileId) {
            await domain.global.set({
              activeProfileId: fallback.activeProfileId,
              switchedAt: Number(fallback.switchedAt) || Date.now(),
              revision: 1,
            })
          }
        }
      } catch {
        // migration is best effort
      }
      removeFile(join(rootDir, '_active.json'))
      removeFile(join(rootDir, '_storage-error.json'))
      return {
        mode: 'domain',
        get() {
          try {
            const value = domain.global.get()
            return value && typeof value.activeProfileId === 'string' && value.activeProfileId !== '' ? value.activeProfileId : null
          } catch {
            return null
          }
        },
        async set(profileId) {
          if (closed) throw new Error('active store is closed')
          const previous = (() => {
            try {
              return domain.global.get() ?? GLOBAL_INITIAL
            } catch {
              return GLOBAL_INITIAL
            }
          })()
          await domain.global.set({
            activeProfileId: profileId,
            switchedAt: Date.now(),
            revision: (Number(previous.revision) || 0) + 1,
          })
        },
        async close() {
          if (closed) return
          closed = true
          await domain.close()
        },
      }
    }
    logger?.warn?.(
      `storageDomain '${ACTIVE_DOMAIN_NAME}' unavailable (${lastError instanceof Error ? lastError.message : String(lastError)}); using the file fallback`,
    )
    try {
      writeJsonAtomic(join(rootDir, '_storage-error.json'), {
        at: new Date().toISOString(),
        facility: facility ? typeof facility.open : 'missing',
        message: lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown'),
        stack: lastError instanceof Error ? lastError.stack : null,
      })
    } catch {
      // diagnostics are best effort
    }
  }
  return openFileStore(rootDir, logger)
}
