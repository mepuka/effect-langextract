import { Effect, Stream } from "effect"

import { makeStaticLanguageModel } from "../LanguageModel.js"
import type {
  InferOptions,
  LanguageModelService
} from "../LanguageModel.js"
import { ScoredOutput } from "../FormatType.js"

export const makeProviderLanguageModelService = (options: {
  readonly provider: string
  readonly modelId: string
  readonly requiresFenceOutput?: boolean
}): LanguageModelService =>
  makeStaticLanguageModel({
    provider: options.provider,
    modelId: options.modelId,
    ...(options.requiresFenceOutput !== undefined
      ? { requiresFenceOutput: options.requiresFenceOutput }
      : {})
  })

export const inferWithProviderPrefix = (
  provider: string,
  prompts: ReadonlyArray<string>,
  _options?: InferOptions
): Effect.Effect<ReadonlyArray<ReadonlyArray<ScoredOutput>>> =>
  Effect.succeed(
    prompts.map((prompt) => [
      new ScoredOutput({
        provider,
        output: prompt,
        score: 1
      })
    ])
  )

export const streamProviderText = (
  provider: string,
  prompt: string
): Stream.Stream<string> =>
  Stream.fromIterable([`[${provider}]`, prompt])
