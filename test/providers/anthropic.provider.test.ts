import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"

import {
  AnthropicConfig,
  AnthropicLanguageModelLive,
  LanguageModel,
  PrimedCachePolicy,
  makePrimedCacheLayer
} from "../../src/index.js"

const anthropicRuntimeLayer = Layer.provide(
  AnthropicLanguageModelLive,
  [
    AnthropicConfig.Default,
    makePrimedCacheLayer({
      enableRequestStore: true,
      enableSessionStore: false
    })
  ]
)

describe("Anthropic provider layer", () => {
  it.effect("returns cache miss then cache hit for identical prompts", () =>
    Effect.gen(function* () {
      const languageModel = yield* LanguageModel
      const policy = new PrimedCachePolicy({
        namespace: "anthropic-test",
        enabled: true
      })

      const first = yield* languageModel.infer(["Text:\nAlice visited Paris."], {
        cachePolicy: policy
      })
      const second = yield* languageModel.infer(["Text:\nAlice visited Paris."], {
        cachePolicy: policy
      })

      expect(first[0]?.[0]?.cacheStatus).toBe("miss")
      expect(second[0]?.[0]?.cacheStatus).toBe("hit")
      expect(second[0]?.[0]?.provider).toBe("anthropic")
    }).pipe(
      Effect.provide(anthropicRuntimeLayer)
    )
  )
})
