import { Effect, Layer, Stream } from "effect"
import { describe, expect, it } from "@effect/vitest"

import {
  Annotator,
  FormatHandler,
  LanguageModel,
  PrimedCache,
  PromptBuilder,
  Resolver,
  ScoredOutput,
  Tokenizer,
  makePrimedCacheLayer
} from "../../src/index.js"
import { makeProviderLanguageModelService } from "../../src/providers/AiAdapters.js"

const makeProviderLanguageModelLayer = Layer.effect(
  LanguageModel,
  Effect.gen(function* () {
    const cache = yield* PrimedCache
    return LanguageModel.make(
      makeProviderLanguageModelService({
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-latest",
        cache
      })
    )
  })
)

const annotateRuntimeLayer = (languageModelLayer: Layer.Layer<LanguageModel>) =>
  Layer.provide(
    Annotator.DefaultWithoutDependencies,
    [
      Tokenizer.Default,
      PromptBuilder.Default,
      FormatHandler.Default,
      Layer.provide(Resolver.DefaultWithoutDependencies, [
        Tokenizer.Default,
        FormatHandler.Default
      ]),
      languageModelLayer
    ]
  )

const cachedProviderLanguageModelLayer = Layer.provide(
  makeProviderLanguageModelLayer,
  makePrimedCacheLayer({
    enableRequestStore: true,
    enableSessionStore: false
  })
)

describe("Annotator integration", () => {
  it.effect("emits aligned extractions from provider output", () =>
    Effect.gen(function* () {
      const annotator = yield* Annotator
      const result = yield* annotator.annotateText(
        "Alice visited Paris. Bob stayed in London.",
        {
          maxCharBuffer: 200,
          batchLength: 4,
          batchConcurrency: 1,
          providerConcurrency: 4,
          extractionPasses: 1,
          promptDescription: "Extract locations and actions."
        }
      )

      expect(result.extractions.length).toBeGreaterThan(0)
      expect(result.extractions[0]?.alignmentStatus).toBeDefined()
      expect((result.extractions[0]?.charInterval?.startPos ?? -1) >= 0).toBe(
        true
      )
    }).pipe(
      Effect.provide(annotateRuntimeLayer(cachedProviderLanguageModelLayer))
    )
  )

  it.effect("keeps first-pass extraction when later pass overlaps", () =>
    Effect.gen(function* () {
      const passAwareLanguageModel = LanguageModel.make({
        modelId: "test-pass-aware",
        requiresFenceOutput: false,
        schema: undefined,
        infer: (prompts, options) => {
          const pass = options?.passNumber ?? 1
          const output =
            pass === 1
              ? JSON.stringify([
                  {
                    extractionClass: "event",
                    extractionText: "Alice visited"
                  }
                ])
              : JSON.stringify([
                  {
                    extractionClass: "event",
                    extractionText: "Alice visited Paris"
                  }
                ])

          return Effect.succeed(
            prompts.map(() => [
              new ScoredOutput({
                provider: "test",
                output,
                score: 1
              })
            ])
          )
        },
        generateText: (prompt, options) =>
          passAwareLanguageModel.infer([prompt], options).pipe(
            Effect.map((values) => values[0]?.[0] ?? new ScoredOutput({}))
          ),
        generateObject: () => Effect.succeed({}),
        streamText: (prompt, options) =>
          Stream.fromEffect(
            passAwareLanguageModel.infer([prompt], options).pipe(
              Effect.map((values) => values[0]?.[0]?.output ?? "")
            )
          )
      })

      const result = yield* Effect.gen(function* () {
        const annotator = yield* Annotator
        return yield* annotator.annotateText("Alice visited Paris yesterday.", {
          maxCharBuffer: 200,
          batchLength: 2,
          batchConcurrency: 1,
          providerConcurrency: 2,
          extractionPasses: 2
        })
      }).pipe(
        Effect.provide(
          annotateRuntimeLayer(
            Layer.succeed(LanguageModel, passAwareLanguageModel)
          )
        )
      )

      const extractionTexts = result.extractions.map((item) => item.extractionText)
      expect(extractionTexts).toContain("Alice visited")
      expect(extractionTexts).not.toContain("Alice visited Paris")
    })
  )
})
