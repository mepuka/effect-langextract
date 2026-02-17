import * as NativeLanguageModel from "@effect/ai/LanguageModel"
import * as AnthropicClient from "@effect/ai-anthropic/AnthropicClient"
import * as AnthropicLanguageModel from "@effect/ai-anthropic/AnthropicLanguageModel"
import * as HttpClient from "@effect/platform/HttpClient"
import { Effect, Layer, Redacted } from "effect"

import { FormatType } from "../FormatType.js"
import { LanguageModel } from "../LanguageModel.js"
import { PrimedCache, PrimedCachePolicy } from "../PrimedCache.js"
import { FormatModeSchema } from "../ProviderSchema.js"
import { RuntimeControl } from "../RuntimeControl.js"
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

const defaultAnthropicConfig: AnthropicConfigService = {
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
}

const optionalRedacted = (value: string | undefined): Redacted.Redacted | undefined =>
  value !== undefined && value.trim().length > 0 ? Redacted.make(value) : undefined

export class AnthropicConfig extends Effect.Service<AnthropicConfig>()(
  "@effect-langextract/providers/AnthropicConfig",
  {
    sync: () => ({ ...defaultAnthropicConfig } satisfies AnthropicConfigService)
  }
) {
  static readonly Test: Layer.Layer<AnthropicConfig> = AnthropicConfig.Default

  static testLayer = (
    overrides?: Partial<AnthropicConfigService>
  ): Layer.Layer<AnthropicConfig> =>
    Layer.succeed(
      AnthropicConfig,
      AnthropicConfig.make({
        ...defaultAnthropicConfig,
        ...overrides,
        primedCachePolicy:
          overrides?.primedCachePolicy ?? defaultAnthropicConfig.primedCachePolicy
      })
    )
}

export const AnthropicConfigLive: Layer.Layer<AnthropicConfig> =
  AnthropicConfig.Default

export const AnthropicNativeLanguageModelLive: Layer.Layer<
  NativeLanguageModel.LanguageModel,
  never,
  AnthropicConfig | HttpClient.HttpClient
> = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* AnthropicConfig

    const clientLayer = AnthropicClient.layer({
      ...(optionalRedacted(config.apiKey) !== undefined
        ? { apiKey: optionalRedacted(config.apiKey) }
        : {}),
      ...(config.baseUrl !== undefined ? { apiUrl: config.baseUrl } : {})
    })

    const modelLayer = AnthropicLanguageModel.layer({
      model: config.modelId,
      config: {
        ...(config.temperature !== undefined
          ? { temperature: config.temperature }
          : {})
      }
    })

    return Layer.provide(modelLayer, clientLayer)
  })
)

export const AnthropicLanguageModelLive: Layer.Layer<
  LanguageModel,
  never,
  AnthropicConfig | PrimedCache | RuntimeControl | HttpClient.HttpClient
> = Layer.provide(
  Layer.effect(
    LanguageModel,
    Effect.gen(function* () {
      const config = yield* AnthropicConfig
      const cache = yield* PrimedCache
      const runtimeControl = yield* RuntimeControl
      const nativeModel = yield* NativeLanguageModel.LanguageModel

      return LanguageModel.make(
        makeProviderLanguageModelService({
          provider: "anthropic",
          modelId: config.modelId,
          requiresFenceOutput: config.formatType !== "json",
          schema: new FormatModeSchema({
            formatType: config.formatType,
            useFences: config.formatType !== "json"
          }),
          cache,
          runtimeControl,
          nativeModel,
          defaultProviderConcurrency: config.providerConcurrency
        })
      )
    })
  ),
  AnthropicNativeLanguageModelLive
)
