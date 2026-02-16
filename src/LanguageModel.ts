import { Effect, Layer, Schema, Stream } from "effect"

import { ScoredOutput } from "./FormatType.js"
import { InferenceRuntimeError } from "./Errors.js"
import type { PrimedCachePolicy } from "./PrimedCache.js"
import type { ProviderSchema } from "./ProviderSchema.js"

export class ModelConfig extends Schema.Class<ModelConfig>("ModelConfig")({
  modelId: Schema.optionalWith(Schema.String, { exact: true }),
  provider: Schema.optionalWith(Schema.String, { exact: true }),
  providerKwargs: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    { default: () => ({}) as const }
  )
}) {}

export interface InferOptions {
  readonly cachePolicy?: PrimedCachePolicy | undefined
  readonly providerConcurrency?: number | undefined
  readonly providerOptions?: Record<string, unknown> | undefined
  readonly passNumber?: number | undefined
  readonly contextWindowChars?: number | undefined
  readonly additionalContextHash?: string | undefined
  readonly preferStructuredOutput?: boolean | undefined
  readonly stream?: boolean | undefined
}

export interface LanguageModelService {
  readonly infer: (
    batchPrompts: ReadonlyArray<string>,
    options?: InferOptions
  ) => Effect.Effect<ReadonlyArray<ReadonlyArray<ScoredOutput>>, InferenceRuntimeError>

  readonly generateText: (
    prompt: string,
    options?: InferOptions
  ) => Effect.Effect<ScoredOutput, InferenceRuntimeError>

  readonly generateObject: (
    prompt: string,
    options?: InferOptions
  ) => Effect.Effect<Record<string, unknown>, InferenceRuntimeError>

  readonly streamText: (
    prompt: string,
    options?: InferOptions
  ) => Stream.Stream<string, InferenceRuntimeError>

  readonly modelId: string
  readonly requiresFenceOutput: boolean
  readonly schema: ProviderSchema | undefined
}

const makeDefaultScoredOutput = (
  provider: string,
  output: string
): ScoredOutput =>
  new ScoredOutput({
    provider,
    output,
    score: 1
  })

export const makeStaticLanguageModel = (options?: {
  readonly provider?: string
  readonly modelId?: string
  readonly requiresFenceOutput?: boolean
}): LanguageModelService => ({
  modelId: options?.modelId ?? "test-model",
  requiresFenceOutput: options?.requiresFenceOutput ?? false,
  schema: undefined,
  infer: (batchPrompts) =>
    Effect.succeed(
      batchPrompts.map((prompt) => [
        makeDefaultScoredOutput(options?.provider ?? "test", prompt)
      ])
    ),
  generateText: (prompt) =>
    Effect.succeed(makeDefaultScoredOutput(options?.provider ?? "test", prompt)),
  generateObject: (_prompt) => Effect.succeed({}),
  streamText: (prompt) => Stream.succeed(prompt)
})

export class LanguageModel extends Effect.Service<LanguageModel>()(
  "@effect-langextract/LanguageModel",
  {
    sync: () => makeStaticLanguageModel({ provider: "test", modelId: "test-model" })
  }
) {}

export const makeStaticLanguageModelLayer = (options?: {
  readonly provider?: string
  readonly modelId?: string
  readonly requiresFenceOutput?: boolean
}): Layer.Layer<LanguageModel> =>
  Layer.succeed(LanguageModel, LanguageModel.make(makeStaticLanguageModel(options)))

export const LanguageModelTest: Layer.Layer<LanguageModel> = LanguageModel.Default
