import { Effect, Layer, Stream } from "effect"
import { describe, expect, it } from "@effect/vitest"

import {
  Annotator,
  FormatHandler,
  LanguageModel,
  PromptBuilder,
  Resolver,
  ScoredOutput,
  Tokenizer
} from "../../src/index.js"

const mockProviderLanguageModelLayer = LanguageModel.testLayer({
  provider: "mock",
  defaultText:
    "[{\"extractionClass\":\"event\",\"extractionText\":\"Alice visited\"}]"
})

const annotateRuntimeLayer = (languageModelLayer: Layer.Layer<LanguageModel>) =>
  Layer.provide(Annotator.DefaultWithoutDependencies, [
    Tokenizer.Default,
    PromptBuilder.Default,
    FormatHandler.Default,
    Layer.provide(Resolver.DefaultWithoutDependencies, [
      Tokenizer.Default,
      FormatHandler.Default
    ]),
    languageModelLayer
  ])

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
    }).pipe(Effect.provide(annotateRuntimeLayer(mockProviderLanguageModelLayer)))
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
              ? "[{\"extractionClass\":\"event\",\"extractionText\":\"Alice visited\"}]"
              : "[{\"extractionClass\":\"event\",\"extractionText\":\"Alice visited Paris\"}]"

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
          annotateRuntimeLayer(Layer.succeed(LanguageModel, passAwareLanguageModel))
        )
      )

      const extractionTexts = result.extractions.map((item) => item.extractionText)
      expect(extractionTexts).toContain("Alice visited")
      expect(extractionTexts).not.toContain("Alice visited Paris")
    })
  )
})
