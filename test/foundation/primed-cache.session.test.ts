import * as Fs from "node:fs/promises"
import * as Path from "node:path"

import { Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"

import {
  PrimedCache,
  PrimedCacheKey,
  PrimedCachePolicy,
  ScoredOutput,
  makePrimedCacheLayer
} from "../../src/index.js"

const tempRoot = (name: string): string =>
  Path.join("/tmp", `effect-langextract-${name}-${Date.now()}-${Math.random()}`)

describe("Primed cache session store", () => {
  it.effect("persists entries across cache layer instances", () =>
    Effect.gen(function* () {
      const root = tempRoot("cache-session")
      const key = new PrimedCacheKey({
        provider: "test",
        modelId: "model",
        promptFingerprint: "fingerprint",
        promptVersion: "v1",
        namespace: "session"
      })
      const policy = new PrimedCachePolicy({
        namespace: "session",
        ttlSeconds: 120
      })

      yield* Effect.tryPromise({
        try: () => Fs.rm(root, { recursive: true, force: true }),
        catch: (error) => new Error(String(error))
      })

      yield* Effect.gen(function* () {
        const cache = yield* PrimedCache
        yield* cache.put(
          key,
          [new ScoredOutput({ provider: "test", output: "cached", score: 1 })],
          { policy, isDeterministic: true }
        )
      }).pipe(
        Effect.provide(
          makePrimedCacheLayer({
            sessionRootDir: root,
            enableRequestStore: false,
            enableSessionStore: true
          })
        )
      )

      const reloaded = yield* Effect.gen(function* () {
        const cache = yield* PrimedCache
        return yield* cache.get(key, { policy, isDeterministic: true })
      }).pipe(
        Effect.provide(
          makePrimedCacheLayer({
            sessionRootDir: root,
            enableRequestStore: false,
            enableSessionStore: true
          })
        )
      )

      expect(reloaded?.[0]?.output).toBe("cached")

      yield* Effect.tryPromise({
        try: () => Fs.rm(root, { recursive: true, force: true }),
        catch: (error) => new Error(String(error))
      })
    })
  )

  it.effect("expires entries when ttl is reached", () =>
    Effect.gen(function* () {
      const key = new PrimedCacheKey({
        provider: "test",
        modelId: "model",
        promptFingerprint: "ttl",
        promptVersion: "v1",
        namespace: "ttl"
      })
      const policy = new PrimedCachePolicy({
        namespace: "ttl",
        ttlSeconds: 0
      })

      const value = yield* Effect.gen(function* () {
        const cache = yield* PrimedCache
        yield* cache.put(
          key,
          [new ScoredOutput({ provider: "test", output: "soon-expired", score: 1 })],
          { policy, isDeterministic: true }
        )
        return yield* cache.get(key, { policy, isDeterministic: true })
      }).pipe(
        Effect.provide(
          makePrimedCacheLayer({
            enableRequestStore: true,
            enableSessionStore: false
          })
        )
      )

      expect(value).toBeUndefined()
    })
  )

  it.effect("clears only the selected namespace", () =>
    Effect.gen(function* () {
      const a = new PrimedCacheKey({
        provider: "test",
        modelId: "model",
        promptFingerprint: "a",
        promptVersion: "v1",
        namespace: "ns-a"
      })
      const b = new PrimedCacheKey({
        provider: "test",
        modelId: "model",
        promptFingerprint: "b",
        promptVersion: "v1",
        namespace: "ns-b"
      })

      const [valueA, valueB] = yield* Effect.gen(function* () {
        const cache = yield* PrimedCache
        yield* cache.put(a, [new ScoredOutput({ output: "A" })])
        yield* cache.put(b, [new ScoredOutput({ output: "B" })])
        yield* cache.clearNamespace("ns-a")
        const aAfter = yield* cache.get(a)
        const bAfter = yield* cache.get(b)
        return [aAfter, bAfter] as const
      }).pipe(
        Effect.provide(
          makePrimedCacheLayer({
            enableRequestStore: true,
            enableSessionStore: false
          })
        )
      )

      expect(valueA).toBeUndefined()
      expect(valueB?.[0]?.output).toBe("B")
    })
  )
})
