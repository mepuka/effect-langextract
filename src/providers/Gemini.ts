import { Effect, Layer } from "effect"

import { FormatType } from "../FormatType.js"
import { LanguageModel } from "../LanguageModel.js"
import { PrimedCache, PrimedCachePolicy } from "../PrimedCache.js"
import { makeProviderLanguageModelService } from "./AiAdapters.js"

export interface GeminiConfigService {
  readonly modelId: string
  readonly apiKey: string
  readonly temperature: number
  readonly providerConcurrency: number
  readonly vertexai: boolean
  readonly project?: string | undefined
  readonly location?: string | undefined
  readonly formatType: FormatType
  readonly primedCacheScope: "request" | "session"
  readonly primedCachePolicy: PrimedCachePolicy
}

export class GeminiConfig extends Effect.Service<GeminiConfig>()(
  "@effect-langextract/providers/GeminiConfig",
  {
    sync: () => ({
      modelId: "gemini-2.5-flash",
      apiKey: "",
      temperature: 0,
      providerConcurrency: 8,
      vertexai: false,
      project: undefined,
      location: undefined,
      formatType: "json",
      primedCacheScope: "session",
      primedCachePolicy: new PrimedCachePolicy({
        namespace: "gemini"
      })
    } satisfies GeminiConfigService)
  }
) {}

export const GeminiConfigLive: Layer.Layer<GeminiConfig> = GeminiConfig.Default

export const GeminiLanguageModelLive: Layer.Layer<
  LanguageModel,
  never,
  GeminiConfig | PrimedCache
> =
  Layer.effect(
    LanguageModel,
    Effect.gen(function* () {
      const config = yield* GeminiConfig
      const cache = yield* PrimedCache
      return LanguageModel.make(
        makeProviderLanguageModelService({
          provider: "gemini",
          modelId: config.modelId,
          requiresFenceOutput: false,
          cache
        })
      )
    })
  )
