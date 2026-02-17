import * as FetchHttpClient from "@effect/platform/FetchHttpClient"

import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"

import {
  GeminiConfig,
  GeminiLanguageModelLive,
  LanguageModel,
  PrimedCachePolicy,
  RuntimeControl,
  makePrimedCacheLayer
} from "../../src/index.js"

const liveEnabled =
  (process.env.LANGEXTRACT_LIVE_PROVIDER_SMOKE ?? "").toLowerCase() === "true" &&
  (process.env.GEMINI_API_KEY ?? "").length > 0

const geminiRuntimeLayer = Layer.provide(
  GeminiLanguageModelLive,
  [
    GeminiConfig.testLayer({
      modelId: process.env.GEMINI_MODEL_ID ?? "gemini-2.5-flash",
      apiKey: process.env.GEMINI_API_KEY ?? "",
      baseUrl: process.env.GEMINI_BASE_URL,
      temperature: 0,
      providerConcurrency: 2
    }),
    makePrimedCacheLayer({
      enableRequestStore: true,
      enableSessionStore: false
    }),
    RuntimeControl.Test,
    FetchHttpClient.layer
  ]
)

describe("Gemini provider layer", () => {
  it.effect("runs live smoke only when explicitly enabled", () =>
    liveEnabled
      ? Effect.gen(function* () {
          const languageModel = yield* LanguageModel
          const policy = new PrimedCachePolicy({
            namespace: "gemini-live-smoke",
            enabled: true,
            ttlSeconds: 30,
            deterministicOnly: true
          })

          const result = yield* languageModel.infer(
            ["Return a one-sentence extraction summary as plain text."],
            {
              cachePolicy: policy,
              providerConcurrency: 1
            }
          )

          expect((result[0]?.[0]?.output ?? "").length).toBeGreaterThan(0)
        }).pipe(Effect.provide(geminiRuntimeLayer))
      : Effect.sync(() => {
          expect(true).toBe(true)
        })
  )
})
