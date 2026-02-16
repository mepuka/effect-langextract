import { Effect, Layer } from "effect"

import { FormatType } from "../FormatType.js"
import { LanguageModel } from "../LanguageModel.js"
import { PrimedCachePolicy } from "../PrimedCache.js"
import { makeProviderLanguageModelService } from "./AiAdapters.js"

export interface OpenAIConfigService {
  readonly modelId: string
  readonly apiKey: string
  readonly baseUrl?: string | undefined
  readonly organization?: string | undefined
  readonly temperature?: number | undefined
  readonly providerConcurrency: number
  readonly formatType: FormatType
  readonly primedCacheScope: "request" | "session"
  readonly primedCachePolicy: PrimedCachePolicy
}

export class OpenAIConfig extends Effect.Service<OpenAIConfig>()(
  "@effect-langextract/providers/OpenAIConfig",
  {
    sync: () => ({
      modelId: "gpt-4o-mini",
      apiKey: "",
      baseUrl: undefined,
      organization: undefined,
      temperature: undefined,
      providerConcurrency: 8,
      formatType: "json",
      primedCacheScope: "session",
      primedCachePolicy: new PrimedCachePolicy({
        namespace: "openai"
      })
    } satisfies OpenAIConfigService)
  }
) {}

export const OpenAIConfigLive: Layer.Layer<OpenAIConfig> = OpenAIConfig.Default

export const OpenAILanguageModelLive: Layer.Layer<LanguageModel, never, OpenAIConfig> =
  Layer.effect(
    LanguageModel,
    Effect.gen(function* () {
      const config = yield* OpenAIConfig
      return LanguageModel.make(
        makeProviderLanguageModelService({
          provider: "openai",
          modelId: config.modelId,
          requiresFenceOutput: config.formatType !== "json"
        })
      )
    })
  )
