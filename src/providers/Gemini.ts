import * as NativeLanguageModel from "@effect/ai/LanguageModel"
import * as GoogleClient from "@effect/ai-google/GoogleClient"
import * as GoogleLanguageModel from "@effect/ai-google/GoogleLanguageModel"
import * as HttpClient from "@effect/platform/HttpClient"
import { Effect, Layer, Redacted } from "effect"

import { FormatType } from "../FormatType.js"
import { LanguageModel } from "../LanguageModel.js"
import { PrimedCache, PrimedCachePolicy } from "../PrimedCache.js"
import { FormatModeSchema } from "../ProviderSchema.js"
import { RuntimeControl } from "../RuntimeControl.js"
import { makeProviderLanguageModelService } from "./AiAdapters.js"

export interface GeminiConfigService {
  readonly modelId: string
  readonly apiKey: string
  readonly baseUrl?: string | undefined
  readonly temperature: number
  readonly providerConcurrency: number
  readonly vertexai: boolean
  readonly project?: string | undefined
  readonly location?: string | undefined
  readonly formatType: FormatType
  readonly primedCacheScope: "request" | "session"
  readonly primedCachePolicy: PrimedCachePolicy
}

const defaultGeminiConfig: GeminiConfigService = {
  modelId: "gemini-2.5-flash",
  apiKey: "",
  baseUrl: undefined,
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
}

const optionalRedacted = (value: string | undefined): Redacted.Redacted | undefined =>
  value !== undefined && value.trim().length > 0 ? Redacted.make(value) : undefined

export class GeminiConfig extends Effect.Service<GeminiConfig>()(
  "@effect-langextract/providers/GeminiConfig",
  {
    sync: () => ({ ...defaultGeminiConfig } satisfies GeminiConfigService)
  }
) {
  static readonly Test: Layer.Layer<GeminiConfig> = GeminiConfig.Default

  static testLayer = (
    overrides?: Partial<GeminiConfigService>
  ): Layer.Layer<GeminiConfig> =>
    Layer.succeed(
      GeminiConfig,
      GeminiConfig.make({
        ...defaultGeminiConfig,
        ...overrides,
        primedCachePolicy:
          overrides?.primedCachePolicy ?? defaultGeminiConfig.primedCachePolicy
      })
    )
}

export const GeminiConfigLive: Layer.Layer<GeminiConfig> = GeminiConfig.Default

export const GeminiNativeLanguageModelLive: Layer.Layer<
  NativeLanguageModel.LanguageModel,
  never,
  GeminiConfig | HttpClient.HttpClient
> = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* GeminiConfig

    const clientLayer = GoogleClient.layer({
      ...(optionalRedacted(config.apiKey) !== undefined
        ? { apiKey: optionalRedacted(config.apiKey) }
        : {}),
      ...(config.baseUrl !== undefined ? { apiUrl: config.baseUrl } : {})
    })

    const modelLayer = GoogleLanguageModel.layer({
      model: config.modelId,
      config: {
        toolConfig: {},
        generationConfig: {
          temperature: config.temperature
        }
      }
    })

    return Layer.provide(modelLayer, clientLayer)
  })
)

export const GeminiLanguageModelLive: Layer.Layer<
  LanguageModel,
  never,
  GeminiConfig | PrimedCache | RuntimeControl | HttpClient.HttpClient
> = Layer.provide(
  Layer.effect(
    LanguageModel,
    Effect.gen(function* () {
      const config = yield* GeminiConfig
      const cache = yield* PrimedCache
      const runtimeControl = yield* RuntimeControl
      const nativeModel = yield* NativeLanguageModel.LanguageModel

      return LanguageModel.make(
        makeProviderLanguageModelService({
          provider: "gemini",
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
  GeminiNativeLanguageModelLive
)
