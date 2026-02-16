import { Effect, Layer } from "effect"

import { FormatType } from "../FormatType.js"
import { LanguageModel } from "../LanguageModel.js"
import { PrimedCache, PrimedCachePolicy } from "../PrimedCache.js"
import { makeProviderLanguageModelService } from "./AiAdapters.js"

export interface AnthropicConfigService {
  readonly modelId: string
  readonly apiKey: string
  readonly baseUrl?: string | undefined
  readonly temperature?: number | undefined
  readonly providerConcurrency: number
  readonly formatType: FormatType
  readonly primedCacheScope: "request" | "session"
  readonly primedCachePolicy: PrimedCachePolicy
}

export class AnthropicConfig extends Effect.Service<AnthropicConfig>()(
  "@effect-langextract/providers/AnthropicConfig",
  {
    sync: () => ({
      modelId: "claude-3-5-sonnet-latest",
      apiKey: "",
      baseUrl: undefined,
      temperature: undefined,
      providerConcurrency: 8,
      formatType: "json",
      primedCacheScope: "session",
      primedCachePolicy: new PrimedCachePolicy({
        namespace: "anthropic"
      })
    } satisfies AnthropicConfigService)
  }
) {}

export const AnthropicConfigLive: Layer.Layer<AnthropicConfig> =
  AnthropicConfig.Default

export const AnthropicLanguageModelLive: Layer.Layer<
  LanguageModel,
  never,
  AnthropicConfig | PrimedCache
> = Layer.effect(
  LanguageModel,
  Effect.gen(function* () {
    const config = yield* AnthropicConfig
    const cache = yield* PrimedCache
    return LanguageModel.make(
      makeProviderLanguageModelService({
        provider: "anthropic",
        modelId: config.modelId,
        requiresFenceOutput: config.formatType !== "json",
        cache
      })
    )
  })
)
