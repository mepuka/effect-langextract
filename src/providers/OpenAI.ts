import * as NativeLanguageModel from "@effect/ai/LanguageModel"
import * as OpenAiClient from "@effect/ai-openai/OpenAiClient"
import * as OpenAiLanguageModel from "@effect/ai-openai/OpenAiLanguageModel"
import * as HttpClient from "@effect/platform/HttpClient"
import { Effect, Layer, Redacted } from "effect"

import { FormatType } from "../FormatType.js"
import { LanguageModel } from "../LanguageModel.js"
import { PrimedCache, PrimedCachePolicy } from "../PrimedCache.js"
import { RuntimeControl } from "../RuntimeControl.js"
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

const defaultOpenAIConfig: OpenAIConfigService = {
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
}

const optionalRedacted = (value: string | undefined): Redacted.Redacted | undefined =>
  value !== undefined && value.trim().length > 0 ? Redacted.make(value) : undefined

export class OpenAIConfig extends Effect.Service<OpenAIConfig>()(
  "@effect-langextract/providers/OpenAIConfig",
  {
    sync: () => ({ ...defaultOpenAIConfig } satisfies OpenAIConfigService)
  }
) {
  static readonly Test: Layer.Layer<OpenAIConfig> = OpenAIConfig.Default

  static testLayer = (
    overrides?: Partial<OpenAIConfigService>
  ): Layer.Layer<OpenAIConfig> =>
    Layer.succeed(
      OpenAIConfig,
      OpenAIConfig.make({
        ...defaultOpenAIConfig,
        ...overrides,
        primedCachePolicy:
          overrides?.primedCachePolicy ?? defaultOpenAIConfig.primedCachePolicy
      })
    )
}

export const OpenAIConfigLive: Layer.Layer<OpenAIConfig> = OpenAIConfig.Default

export const OpenAINativeLanguageModelLive: Layer.Layer<
  NativeLanguageModel.LanguageModel,
  never,
  OpenAIConfig | HttpClient.HttpClient
> = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* OpenAIConfig

    const clientLayer = OpenAiClient.layer({
      ...(optionalRedacted(config.apiKey) !== undefined
        ? { apiKey: optionalRedacted(config.apiKey) }
        : {}),
      ...(config.baseUrl !== undefined ? { apiUrl: config.baseUrl } : {}),
      ...(optionalRedacted(config.organization) !== undefined
        ? { organizationId: optionalRedacted(config.organization) }
        : {})
    })

    const modelLayer = OpenAiLanguageModel.layer({
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

export const OpenAILanguageModelLive: Layer.Layer<
  LanguageModel,
  never,
  OpenAIConfig | PrimedCache | RuntimeControl | HttpClient.HttpClient
> = Layer.provide(
  Layer.effect(
    LanguageModel,
    Effect.gen(function* () {
      const config = yield* OpenAIConfig
      const cache = yield* PrimedCache
      const runtimeControl = yield* RuntimeControl
      const nativeModel = yield* NativeLanguageModel.LanguageModel

      return LanguageModel.make(
        makeProviderLanguageModelService({
          provider: "openai",
          modelId: config.modelId,
          requiresFenceOutput: config.formatType !== "json",
          cache,
          runtimeControl,
          nativeModel,
          defaultProviderConcurrency: config.providerConcurrency
        })
      )
    })
  ),
  OpenAINativeLanguageModelLive
)
