import { Effect, Layer } from "effect"

import { FormatType } from "../FormatType.js"
import { LanguageModel } from "../LanguageModel.js"
import { PrimedCache, PrimedCachePolicy } from "../PrimedCache.js"
import { makeProviderLanguageModelService } from "./AiAdapters.js"

export interface OllamaConfigService {
  readonly modelId: string
  readonly baseUrl: string
  readonly formatType: FormatType
  readonly timeout: number
  readonly providerConcurrency: number
  readonly primedCacheScope: "request" | "session"
  readonly primedCachePolicy: PrimedCachePolicy
}

export class OllamaConfig extends Effect.Service<OllamaConfig>()(
  "@effect-langextract/providers/OllamaConfig",
  {
    sync: () => ({
      modelId: "llama3.2:latest",
      baseUrl: "http://localhost:11434",
      formatType: "json",
      timeout: 120,
      providerConcurrency: 8,
      primedCacheScope: "session",
      primedCachePolicy: new PrimedCachePolicy({
        namespace: "ollama"
      })
    } satisfies OllamaConfigService)
  }
) {}

export const OllamaConfigLive: Layer.Layer<OllamaConfig> = OllamaConfig.Default

export const OllamaLanguageModelLive: Layer.Layer<
  LanguageModel,
  never,
  OllamaConfig | PrimedCache
> =
  Layer.effect(
    LanguageModel,
    Effect.gen(function* () {
      const config = yield* OllamaConfig
      const cache = yield* PrimedCache
      return LanguageModel.make(
        makeProviderLanguageModelService({
          provider: "ollama",
          modelId: config.modelId,
          requiresFenceOutput: false,
          cache
        })
      )
    })
  )
