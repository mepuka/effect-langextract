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
  promptVersion: Schema.String
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
    key: PrimedCacheKey
  ) => Effect.Effect<ReadonlyArray<ScoredOutput> | undefined, PrimedCacheError>

  readonly put: (
    key: PrimedCacheKey,
    value: ReadonlyArray<ScoredOutput>
  ) => Effect.Effect<void, PrimedCacheError>

  readonly invalidate: (
    key: PrimedCacheKey
  ) => Effect.Effect<void, PrimedCacheError>

  readonly clearNamespace: (
    namespace: string
  ) => Effect.Effect<void, PrimedCacheError>
}

const toStorageKey = (key: PrimedCacheKey): string =>
  JSON.stringify(key)

const fromNamespace = (cacheKey: string, namespace: string): boolean => {
  try {
    const parsed = JSON.parse(cacheKey) as { promptVersion?: string }
    return (parsed.promptVersion ?? "") === namespace
  } catch {
    return false
  }
}

const makeInMemoryCache = (): PrimedCacheService => {
  const store = new Map<string, ReadonlyArray<ScoredOutput>>()

  return {
    get: (key) =>
      Effect.sync(() => store.get(toStorageKey(key))),
    put: (key, value) =>
      Effect.sync(() => {
        store.set(toStorageKey(key), value)
      }),
    invalidate: (key) =>
      Effect.sync(() => {
        store.delete(toStorageKey(key))
      }),
    clearNamespace: (namespace) =>
      Effect.sync(() => {
        for (const key of store.keys()) {
          if (fromNamespace(key, namespace)) {
            store.delete(key)
          }
        }
      })
  }
}

export class PrimedCache extends Effect.Service<PrimedCache>()(
  "@effect-langextract/PrimedCache",
  {
    sync: makeInMemoryCache
  }
) {}

export const PrimedCacheLive: Layer.Layer<PrimedCache> = PrimedCache.Default

export const PrimedCacheTest: Layer.Layer<PrimedCache> = PrimedCache.Default
