import * as NativeLanguageModel from "@effect/ai/LanguageModel"
import { Effect, Fiber, Ref, Stream } from "effect"
import { describe, expect, it } from "@effect/vitest"

import {
  PrimedCache,
  RuntimeControl,
  makePrimedCacheLayer
} from "../../src/index.js"
import { makeProviderLanguageModelService } from "../../src/providers/AiAdapters.js"

const makeConcurrencyTrackedNativeModel = (
  current: Ref.Ref<number>,
  max: Ref.Ref<number>,
  options?: {
    readonly failGenerateObject?: boolean
  }
): NativeLanguageModel.Service =>
  ({
    generateText: ({ prompt }) =>
      Effect.acquireUseRelease(
        Ref.updateAndGet(current, (value) => value + 1),
        () =>
          Effect.gen(function* () {
            const active = yield* Ref.get(current)
            yield* Ref.update(max, (value) => Math.max(value, active))
            yield* Effect.sleep("5 millis")
            return {
              text:
                prompt === "json-object"
                  ? JSON.stringify({ ok: true })
                  : String(prompt ?? "")
            } as any
          }),
        () => Ref.update(current, (value) => value - 1)
      ),
    generateObject: ({ prompt }) =>
      options?.failGenerateObject === true
        ? Effect.fail(new Error("generateObject failed"))
        : Effect.acquireUseRelease(
            Ref.updateAndGet(current, (value) => value + 1),
            () =>
              Effect.gen(function* () {
                const active = yield* Ref.get(current)
                yield* Ref.update(max, (value) => Math.max(value, active))
                yield* Effect.sleep("5 millis")
                return {
                  value: { prompt: String(prompt ?? "") }
                } as any
              }),
            () => Ref.update(current, (value) => value - 1)
          ),
    streamText: () => Stream.empty
  }) as NativeLanguageModel.Service

const makeInterruptibleNativeModel = (
  current: Ref.Ref<number>,
  max: Ref.Ref<number>
): NativeLanguageModel.Service =>
  ({
    generateText: ({ prompt }) =>
      Effect.acquireUseRelease(
        Ref.updateAndGet(current, (value) => value + 1),
        () =>
          Effect.gen(function* () {
            const active = yield* Ref.get(current)
            yield* Ref.update(max, (value) => Math.max(value, active))
            if (prompt === "slow") {
              yield* Effect.sleep("100 millis")
            }
            return { text: String(prompt ?? "") } as any
          }),
        () => Ref.update(current, (value) => value - 1)
      ),
    generateObject: ({ prompt }) =>
      Effect.succeed({
        value: { prompt: String(prompt ?? "") }
      } as any),
    streamText: () => Stream.empty
  }) as NativeLanguageModel.Service

const makeRuntimeControl = (maxConcurrency: number): Effect.Effect<RuntimeControl> =>
  Effect.gen(function* () {
    const semaphore = yield* Effect.makeSemaphore(maxConcurrency)
    return RuntimeControl.make({
      acquireProviderPermit: (_provider) =>
        semaphore.take(1).pipe(Effect.asVoid),
      releaseProviderPermit: (_provider) =>
        semaphore.release(1).pipe(Effect.asVoid)
    })
  })

describe("RuntimeControl permit integration", () => {
  it.live("applies provider permits around concurrent infer calls", () =>
    Effect.gen(function* () {
      const cache = yield* PrimedCache
      const current = yield* Ref.make(0)
      const max = yield* Ref.make(0)
      const runtimeControl = yield* makeRuntimeControl(1)

      const service = makeProviderLanguageModelService({
        provider: "test-provider",
        modelId: "test-model",
        cache,
        runtimeControl,
        nativeModel: makeConcurrencyTrackedNativeModel(current, max),
        defaultProviderConcurrency: 4
      })

      const result = yield* service.infer(["a", "b", "c", "d"], {
        providerConcurrency: 4
      })

      const observedMax = yield* Ref.get(max)
      expect(result.length).toBe(4)
      expect(observedMax).toBe(1)
    }).pipe(
      Effect.provide(
        makePrimedCacheLayer({
          enableRequestStore: true,
          enableSessionStore: false
        })
      )
    )
  )

  it.live("applies permits on native generateObject path", () =>
    Effect.gen(function* () {
      const cache = yield* PrimedCache
      const current = yield* Ref.make(0)
      const max = yield* Ref.make(0)
      const runtimeControl = yield* makeRuntimeControl(1)

      const service = makeProviderLanguageModelService({
        provider: "test-provider",
        modelId: "test-model",
        cache,
        runtimeControl,
        nativeModel: makeConcurrencyTrackedNativeModel(current, max),
        defaultProviderConcurrency: 4
      })

      const objects = yield* Effect.forEach(
        ["a", "b", "c", "d"],
        (prompt) => service.generateObject(prompt),
        { concurrency: 4 }
      )

      const observedMax = yield* Ref.get(max)
      expect(objects.length).toBe(4)
      expect(observedMax).toBe(1)
    }).pipe(
      Effect.provide(
        makePrimedCacheLayer({
          enableRequestStore: true,
          enableSessionStore: false
        })
      )
    )
  )

  it.live("releases permit when generateObject falls back to cached text path", () =>
    Effect.gen(function* () {
      const cache = yield* PrimedCache
      const current = yield* Ref.make(0)
      const max = yield* Ref.make(0)
      const runtimeControl = yield* makeRuntimeControl(1)

      const service = makeProviderLanguageModelService({
        provider: "test-provider",
        modelId: "test-model",
        cache,
        runtimeControl,
        nativeModel: makeConcurrencyTrackedNativeModel(current, max, {
          failGenerateObject: true
        }),
        defaultProviderConcurrency: 2
      })

      const value = yield* service.generateObject("json-object")

      expect(value).toEqual({ ok: true })
      expect(yield* Ref.get(max)).toBe(1)
    }).pipe(
      Effect.provide(
        makePrimedCacheLayer({
          enableRequestStore: true,
          enableSessionStore: false
        })
      )
    )
  )

  it.live("releases permit callback when an in-flight infer is interrupted", () =>
    Effect.gen(function* () {
      const cache = yield* PrimedCache
      const current = yield* Ref.make(0)
      const max = yield* Ref.make(0)
      const acquired = yield* Ref.make(0)
      const released = yield* Ref.make(0)
      const runtimeControl = RuntimeControl.make({
        acquireProviderPermit: (_provider) =>
          Ref.update(acquired, (value) => value + 1),
        releaseProviderPermit: (_provider) =>
          Ref.update(released, (value) => value + 1)
      })

      const service = makeProviderLanguageModelService({
        provider: "test-provider",
        modelId: "test-model",
        cache,
        runtimeControl,
        nativeModel: makeInterruptibleNativeModel(current, max),
        defaultProviderConcurrency: 1
      })

      const slowFiber = yield* service
        .infer(["slow"], { providerConcurrency: 1 })
        .pipe(Effect.fork)
      yield* Effect.sleep("5 millis")
      yield* Fiber.interrupt(slowFiber)

      expect(yield* Ref.get(acquired)).toBe(1)
      expect(yield* Ref.get(released)).toBe(1)
      expect(yield* Ref.get(max)).toBeGreaterThan(0)
    }).pipe(
      Effect.provide(
        makePrimedCacheLayer({
          enableRequestStore: true,
          enableSessionStore: false
        })
      )
    )
  )
})
