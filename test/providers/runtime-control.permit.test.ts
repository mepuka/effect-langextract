import * as NativeLanguageModel from "@effect/ai/LanguageModel"
import { Effect, Ref, Stream } from "effect"
import { describe, expect, it } from "@effect/vitest"

import {
  PrimedCache,
  RuntimeControl,
  makePrimedCacheLayer
} from "../../src/index.js"
import { makeProviderLanguageModelService } from "../../src/providers/AiAdapters.js"

const makeNativeLanguageModel = (
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
            yield* Effect.sleep("5 millis")
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

describe("RuntimeControl permit integration", () => {
  it.live("applies provider permits around concurrent infer calls", () =>
    Effect.gen(function* () {
      const cache = yield* PrimedCache
      const current = yield* Ref.make(0)
      const max = yield* Ref.make(0)
      const semaphore = yield* Effect.makeSemaphore(1)

      const runtimeControl = RuntimeControl.make({
        acquireProviderPermit: (_provider) =>
          semaphore.take(1).pipe(Effect.asVoid),
        releaseProviderPermit: (_provider) =>
          semaphore.release(1).pipe(Effect.asVoid)
      })

      const service = makeProviderLanguageModelService({
        provider: "test-provider",
        modelId: "test-model",
        cache,
        runtimeControl,
        nativeModel: makeNativeLanguageModel(current, max),
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
})
