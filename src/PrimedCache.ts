import { createHash } from "node:crypto"
import * as Fs from "node:fs/promises"
import * as Path from "node:path"

import { Effect, Layer, Schema } from "effect"

import { PrimedCacheError } from "./Errors.js"
import { FormatType, ScoredOutput } from "./FormatType.js"

export class PrimedCacheKey extends Schema.Class<PrimedCacheKey>("PrimedCacheKey")({
  provider: Schema.String,
  modelId: Schema.String,
  promptFingerprint: Schema.String,
  schemaFingerprint: Schema.optionalWith(Schema.String, { exact: true }),
  temperature: Schema.optionalWith(Schema.Number, { exact: true }),
  formatType: Schema.optionalWith(FormatType, { exact: true }),
  promptVersion: Schema.String,
  namespace: Schema.optionalWith(Schema.String, {
    default: () => "langextract"
  })
}) {}

export class PrimedCachePolicy extends Schema.Class<PrimedCachePolicy>("PrimedCachePolicy")({
  enabled: Schema.optionalWith(Schema.Boolean, { default: () => true }),
  ttlSeconds: Schema.optionalWith(Schema.Int, {
    default: () => 60 * 60 * 24
  }),
  namespace: Schema.optionalWith(Schema.String, {
    default: () => "langextract"
  }),
  deterministicOnly: Schema.optionalWith(Schema.Boolean, {
    default: () => true
  }),
  allowStreamingWrites: Schema.optionalWith(Schema.Boolean, {
    default: () => false
  }),
  maxEntries: Schema.optionalWith(Schema.Int, {
    default: () => 10_000
  })
}) {}

export interface PrimedCacheService {
  readonly get: (
    key: PrimedCacheKey,
    options?: CacheAccessOptions
  ) => Effect.Effect<ReadonlyArray<ScoredOutput> | undefined, PrimedCacheError>

  readonly put: (
    key: PrimedCacheKey,
    value: ReadonlyArray<ScoredOutput>,
    options?: CacheAccessOptions
  ) => Effect.Effect<void, PrimedCacheError>

  readonly invalidate: (
    key: PrimedCacheKey,
    options?: CacheAccessOptions
  ) => Effect.Effect<void, PrimedCacheError>

  readonly clearNamespace: (
    namespace: string
  ) => Effect.Effect<void, PrimedCacheError>
}

export interface CacheAccessOptions {
  readonly policy?: PrimedCachePolicy | undefined
  readonly isDeterministic?: boolean | undefined
}

export interface PrimedCacheLayerOptions {
  readonly sessionRootDir?: string | undefined
  readonly enableSessionStore?: boolean | undefined
  readonly enableRequestStore?: boolean | undefined
}

type CacheRecord = {
  readonly key: PrimedCacheKey
  readonly keyString: string
  readonly createdAtMs: number
  readonly expiresAtMs: number
  readonly value: ReadonlyArray<ScoredOutput>
}

const DEFAULT_SESSION_ROOT = ".cache/langextract/primed"

const sanitizeSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]/g, "_")

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)

  return `{${entries.join(",")}}`
}

const toKeyString = (key: PrimedCacheKey): string => stableStringify(key)

const hashKey = (value: string): string =>
  createHash("sha256").update(value).digest("hex")

const toStoragePath = (
  rootDir: string,
  key: PrimedCacheKey,
  keyString: string
): string =>
  Path.join(
    rootDir,
    sanitizeSegment(key.namespace),
    sanitizeSegment(key.provider),
    sanitizeSegment(key.modelId),
    `${hashKey(keyString)}.json`
  )

const toNamespacePath = (rootDir: string, namespace: string): string =>
  Path.join(rootDir, sanitizeSegment(namespace))

const toPrimedCacheError = (
  message: string,
  key?: string
): PrimedCacheError =>
  new PrimedCacheError({
    message,
    ...(key !== undefined ? { key } : {})
  })

const resolvePolicy = (
  accessOptions?: CacheAccessOptions
): PrimedCachePolicy => accessOptions?.policy ?? new PrimedCachePolicy({})

const canUseCache = (
  policy: PrimedCachePolicy,
  accessOptions?: CacheAccessOptions
): boolean => {
  if (!policy.enabled) {
    return false
  }
  if (policy.deterministicOnly && accessOptions?.isDeterministic === false) {
    return false
  }
  return true
}

const copyKey = (
  key: PrimedCacheKey,
  namespace: string
): PrimedCacheKey =>
  new PrimedCacheKey({
    provider: key.provider,
    modelId: key.modelId,
    promptFingerprint: key.promptFingerprint,
    promptVersion: key.promptVersion,
    namespace: key.namespace ?? namespace,
    ...(key.schemaFingerprint !== undefined
      ? { schemaFingerprint: key.schemaFingerprint }
      : {}),
    ...(key.temperature !== undefined
      ? { temperature: key.temperature }
      : {}),
    ...(key.formatType !== undefined
      ? { formatType: key.formatType }
      : {})
  })

const isFromNamespace = (keyString: string, namespace: string): boolean => {
  try {
    const parsed = JSON.parse(keyString) as { namespace?: string }
    return (parsed.namespace ?? "langextract") === namespace
  } catch {
    return false
  }
}

const toScoredOutputs = (value: unknown): ReadonlyArray<ScoredOutput> => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((candidate) => {
    const record =
      typeof candidate === "object" && candidate !== null
        ? candidate as Record<string, unknown>
        : {}

    return new ScoredOutput({
      ...(typeof record.provider === "string"
        ? { provider: record.provider }
        : {}),
      ...(typeof record.output === "string"
        ? { output: record.output }
        : {}),
      ...(typeof record.score === "number"
        ? { score: record.score }
        : {}),
      ...(record.cacheStatus === "hit" || record.cacheStatus === "miss"
        ? { cacheStatus: record.cacheStatus }
        : {}),
      ...(typeof record.cacheKey === "string"
        ? { cacheKey: record.cacheKey }
        : {})
    })
  })
}

const parseRecord = (
  raw: unknown
): CacheRecord | undefined => {
  if (typeof raw !== "object" || raw === null) {
    return undefined
  }

  const value = raw as Record<string, unknown>
  const keyInput = value.key
  const keyRecord =
    typeof keyInput === "object" && keyInput !== null
      ? keyInput as Record<string, unknown>
      : undefined
  const key =
    keyRecord !== undefined &&
    typeof keyRecord.provider === "string" &&
    typeof keyRecord.modelId === "string" &&
    typeof keyRecord.promptFingerprint === "string" &&
    typeof keyRecord.promptVersion === "string"
      ? new PrimedCacheKey({
          provider: keyRecord.provider,
          modelId: keyRecord.modelId,
          promptFingerprint: keyRecord.promptFingerprint,
          promptVersion: keyRecord.promptVersion,
          ...(typeof keyRecord.namespace === "string"
            ? { namespace: keyRecord.namespace }
            : {}),
          ...(typeof keyRecord.schemaFingerprint === "string"
            ? { schemaFingerprint: keyRecord.schemaFingerprint }
            : {}),
          ...(typeof keyRecord.temperature === "number"
            ? { temperature: keyRecord.temperature }
            : {}),
          ...(keyRecord.formatType === "json" || keyRecord.formatType === "yaml"
            ? { formatType: keyRecord.formatType }
            : {})
        })
      : undefined

  if (key === undefined) {
    return undefined
  }

  const createdAtMs =
    typeof value.createdAtMs === "number"
      ? value.createdAtMs
      : Date.now()
  const expiresAtMs =
    typeof value.expiresAtMs === "number"
      ? value.expiresAtMs
      : createdAtMs
  const keyString =
    typeof value.keyString === "string"
      ? value.keyString
      : toKeyString(key)

  return {
    key,
    keyString,
    createdAtMs,
    expiresAtMs,
    value: toScoredOutputs(value.value)
  }
}

const collectJsonFiles = async (
  rootDir: string
): Promise<Array<string>> => {
  const entries = await Fs.readdir(rootDir, { withFileTypes: true })
  const files: Array<string> = []

  for (const entry of entries) {
    const entryPath = Path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectJsonFiles(entryPath)))
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath)
    }
  }

  return files
}

const makeCompositeCache = (
  options?: PrimedCacheLayerOptions
): PrimedCacheService => {
  const requestStore = new Map<string, CacheRecord>()
  const rootDir = options?.sessionRootDir ?? DEFAULT_SESSION_ROOT
  const requestEnabled = options?.enableRequestStore ?? true
  const sessionEnabled = options?.enableSessionStore ?? true

  return {
    get: (inputKey, accessOptions) =>
      Effect.gen(function* () {
        const policy = resolvePolicy(accessOptions)
        if (!canUseCache(policy, accessOptions)) {
          return undefined
        }

        const key = copyKey(inputKey, policy.namespace)
        const keyString = toKeyString(key)
        const now = Date.now()

        if (requestEnabled) {
          const cached = requestStore.get(keyString)
          if (cached !== undefined) {
            if (cached.expiresAtMs > now) {
              return cached.value
            }
            requestStore.delete(keyString)
          }
        }

        if (!sessionEnabled) {
          return undefined
        }

        const path = toStoragePath(rootDir, key, keyString)
        const serialized = yield* Effect.tryPromise({
          try: () => Fs.readFile(path, "utf8"),
          catch: (error) =>
            toPrimedCacheError(
              `Failed to read primed cache entry: ${String(error)}`,
              keyString
            )
        }).pipe(
          Effect.catchAll((error) =>
            error.message.includes("ENOENT")
              ? Effect.succeed(undefined)
              : Effect.fail(error)
          )
        )

        if (serialized === undefined) {
          return undefined
        }

        const decoded = yield* Effect.try({
          try: () => parseRecord(JSON.parse(serialized)),
          catch: (error) =>
            toPrimedCacheError(
              `Failed to decode primed cache entry: ${String(error)}`,
              keyString
            )
        }).pipe(
          Effect.catchAll(() =>
            Effect.tryPromise({
              try: async () => {
                await Fs.rm(path, { force: true })
              },
              catch: (error) =>
                toPrimedCacheError(
                  `Failed to clean invalid primed cache entry: ${String(error)}`,
                  keyString
                )
            }).pipe(Effect.as(undefined))
          )
        )

        if (decoded === undefined) {
          return undefined
        }

        if (decoded.expiresAtMs <= now) {
          yield* Effect.tryPromise({
            try: async () => {
              await Fs.rm(path, { force: true })
            },
            catch: (error) =>
              toPrimedCacheError(
                `Failed to remove expired primed cache entry: ${String(error)}`,
                keyString
              )
          }).pipe(Effect.catchAll(() => Effect.void))
          return undefined
        }

        if (requestEnabled) {
          requestStore.set(keyString, decoded)
        }
        return decoded.value
      }),
    put: (inputKey, value, accessOptions) =>
      Effect.gen(function* () {
        const policy = resolvePolicy(accessOptions)
        if (!canUseCache(policy, accessOptions)) {
          return
        }

        const key = copyKey(inputKey, policy.namespace)
        const keyString = toKeyString(key)
        const now = Date.now()
        const expiresAtMs = now + policy.ttlSeconds * 1000
        const record: CacheRecord = {
          key,
          keyString,
          createdAtMs: now,
          expiresAtMs,
          value
        }

        if (requestEnabled) {
          requestStore.set(keyString, record)
        }

        if (!sessionEnabled) {
          return
        }

        const path = toStoragePath(rootDir, key, keyString)
        const directory = Path.dirname(path)

        yield* Effect.tryPromise({
          try: async () => {
            await Fs.mkdir(directory, { recursive: true })
            await Fs.writeFile(path, JSON.stringify(record), "utf8")
          },
          catch: (error) =>
            toPrimedCacheError(
              `Failed to write primed cache entry: ${String(error)}`,
              keyString
            )
        })

        const namespacePath = toNamespacePath(rootDir, key.namespace)
        yield* Effect.tryPromise({
          try: async () => {
            const files = await collectJsonFiles(namespacePath)
            if (files.length <= policy.maxEntries) {
              return
            }

            const entries = await Promise.all(
              files.map(async (filePath) => {
                const text = await Fs.readFile(filePath, "utf8")
                const parsed = parseRecord(JSON.parse(text))
                return { filePath, createdAtMs: parsed?.createdAtMs ?? 0 }
              })
            )

            entries.sort((left, right) => right.createdAtMs - left.createdAtMs)
            const toDelete = entries.slice(policy.maxEntries)
            await Promise.all(
              toDelete.map(({ filePath }) =>
                Fs.rm(filePath, { force: true })
              )
            )
          },
          catch: (error) =>
            toPrimedCacheError(
              `Failed to prune primed cache namespace: ${String(error)}`,
              keyString
            )
        }).pipe(Effect.catchAll(() => Effect.void))
      }),
    invalidate: (inputKey, accessOptions) =>
      Effect.gen(function* () {
        const policy = resolvePolicy(accessOptions)
        const key = copyKey(inputKey, policy.namespace)
        const keyString = toKeyString(key)

        if (requestEnabled) {
          requestStore.delete(keyString)
        }
        if (!sessionEnabled) {
          return
        }

        const path = toStoragePath(rootDir, key, keyString)
        yield* Effect.tryPromise({
          try: async () => {
            await Fs.rm(path, { force: true })
          },
          catch: (error) =>
            toPrimedCacheError(
              `Failed to invalidate primed cache entry: ${String(error)}`,
              keyString
            )
        }).pipe(Effect.catchAll(() => Effect.void))
      }),
    clearNamespace: (namespace) =>
      Effect.gen(function* () {
        for (const keyString of requestStore.keys()) {
          if (isFromNamespace(keyString, namespace)) {
            requestStore.delete(keyString)
          }
        }

        if (!sessionEnabled) {
          return
        }

        const namespacePath = toNamespacePath(rootDir, namespace)
        yield* Effect.tryPromise({
          try: async () => {
            await Fs.rm(namespacePath, {
              recursive: true,
              force: true
            })
          },
          catch: (error) =>
            toPrimedCacheError(
              `Failed to clear primed cache namespace: ${String(error)}`
            )
        })
      })
  }
}

export class PrimedCache extends Effect.Service<PrimedCache>()(
  "@effect-langextract/PrimedCache",
  {
    sync: () => makeCompositeCache()
  }
) {}

export const makePrimedCacheLayer = (
  options?: PrimedCacheLayerOptions
): Layer.Layer<PrimedCache> =>
  Layer.succeed(PrimedCache, PrimedCache.make(makeCompositeCache(options)))

export const PrimedCacheLive: Layer.Layer<PrimedCache> =
  makePrimedCacheLayer()

export const PrimedCacheTest: Layer.Layer<PrimedCache> =
  makePrimedCacheLayer({
    enableSessionStore: false,
    enableRequestStore: true
  })
