import * as NativeLanguageModel from "@effect/ai/LanguageModel"
import { Effect, Schema, Stream } from "effect"

import type { InferOptions, LanguageModelService } from "../LanguageModel.js"
import { InferenceRuntimeError } from "../Errors.js"
import { ScoredOutput } from "../FormatType.js"
import { PrimedCache, PrimedCacheKey } from "../PrimedCache.js"

const JsonString = Schema.parseJson()
const JsonRecord = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown
})

const hashString = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

const makeCacheFingerprint = (prompt: string): string => hashString(prompt)

const normalizeNamespace = (options?: InferOptions): string =>
  options?.cachePolicy?.namespace ?? "langextract"

const isDeterministicRequest = (options?: InferOptions): boolean => {
  const temperature = options?.providerOptions?.temperature
  if (typeof temperature === "number") {
    return temperature <= 0
  }
  return true
}

const cacheKeyForPrompt = (
  provider: string,
  modelId: string,
  prompt: string,
  options?: InferOptions
): PrimedCacheKey =>
  new PrimedCacheKey({
    provider,
    modelId,
    promptFingerprint: makeCacheFingerprint(prompt),
    promptVersion: `pass-${options?.passNumber ?? 1}`,
    namespace: normalizeNamespace(options)
  })

const withCacheMetadata = (
  value: ReadonlyArray<ScoredOutput>,
  cacheKey: string,
  status: "hit" | "miss"
): ReadonlyArray<ScoredOutput> =>
  value.map(
    (item) =>
      new ScoredOutput({
        ...(item.provider !== undefined ? { provider: item.provider } : {}),
        ...(item.output !== undefined ? { output: item.output } : {}),
        ...(item.score !== undefined ? { score: item.score } : {}),
        cacheStatus: status,
        cacheKey
      })
  )

const toInferenceRuntimeError = (
  provider: string,
  message: string,
  error?: unknown
): InferenceRuntimeError =>
  new InferenceRuntimeError({
    provider,
    message:
      error === undefined
        ? message
        : `${message}: ${
            typeof error === "object" && error !== null && "message" in error
              ? String((error as { readonly message: unknown }).message)
              : String(error)
          }`
  })

const invokeNativeText = (
  nativeModel: NativeLanguageModel.Service,
  provider: string,
  prompt: string
): Effect.Effect<string, InferenceRuntimeError> =>
  nativeModel.generateText({ prompt }).pipe(
    Effect.map((response) => response.text),
    Effect.mapError((error) =>
      toInferenceRuntimeError(provider, "Provider text generation failed", error)
    )
  )

const runPromptInference = (
  nativeModel: NativeLanguageModel.Service,
  provider: string,
  modelId: string,
  cache: PrimedCache,
  prompt: string,
  options?: InferOptions
): Effect.Effect<ReadonlyArray<ScoredOutput>, InferenceRuntimeError> =>
  Effect.gen(function* () {
    const key = cacheKeyForPrompt(provider, modelId, prompt, options)
    const keyString = `${key.namespace}:${key.provider}:${key.modelId}:${key.promptFingerprint}`
    const deterministic = isDeterministicRequest(options)
    const cacheOptions = {
      policy: options?.cachePolicy,
      isDeterministic: deterministic
    } as const

    const cached = yield* cache.get(key, cacheOptions).pipe(
      Effect.mapError((error) =>
        toInferenceRuntimeError(provider, "Failed to read primed cache", error)
      )
    )

    if (cached !== undefined) {
      return withCacheMetadata(cached, keyString, "hit")
    }

    const output = yield* invokeNativeText(nativeModel, provider, prompt)
    const scored = [
      new ScoredOutput({
        provider,
        output,
        score: 1
      })
    ] as const

    yield* cache.put(key, scored, cacheOptions).pipe(
      Effect.mapError((error) =>
        toInferenceRuntimeError(provider, "Failed to write primed cache", error)
      )
    )

    return withCacheMetadata(scored, keyString, "miss")
  })

export const makeProviderLanguageModelService = (options: {
  readonly provider: string
  readonly modelId: string
  readonly requiresFenceOutput?: boolean
  readonly cache: PrimedCache
  readonly nativeModel: NativeLanguageModel.Service
  readonly defaultProviderConcurrency?: number | undefined
}): LanguageModelService => ({
  modelId: options.modelId,
  requiresFenceOutput: options.requiresFenceOutput ?? false,
  schema: undefined,
  infer: (batchPrompts, inferOptions) =>
    Effect.forEach(
      batchPrompts,
      (prompt) =>
        runPromptInference(
          options.nativeModel,
          options.provider,
          options.modelId,
          options.cache,
          prompt,
          inferOptions
        ),
      {
        concurrency:
          inferOptions?.providerConcurrency ??
          options.defaultProviderConcurrency ??
          8
      }
    ),
  generateText: (prompt, inferOptions) =>
    runPromptInference(
      options.nativeModel,
      options.provider,
      options.modelId,
      options.cache,
      prompt,
      inferOptions
    ).pipe(Effect.map((values) => values[0] ?? new ScoredOutput({}))),
  generateObject: (prompt, inferOptions) =>
    options.nativeModel.generateObject({
      prompt,
      schema: JsonRecord
    }).pipe(
      Effect.map((response) => response.value),
      Effect.catchAll(() =>
        runPromptInference(
          options.nativeModel,
          options.provider,
          options.modelId,
          options.cache,
          prompt,
          inferOptions
        ).pipe(
          Effect.flatMap((values) =>
            Schema.decodeUnknown(JsonString)(values[0]?.output ?? "{}").pipe(
              Effect.flatMap((decoded) =>
                Schema.decodeUnknown(JsonRecord)(decoded)
              ),
              Effect.mapError((error) =>
                toInferenceRuntimeError(
                  options.provider,
                  "Failed to parse provider JSON output",
                  error
                )
              )
            )
          )
        )
      ),
      Effect.mapError((error) =>
        toInferenceRuntimeError(options.provider, "Provider object generation failed", error)
      )
    ),
  streamText: (prompt, inferOptions) =>
    Stream.fromEffect(
      runPromptInference(
        options.nativeModel,
        options.provider,
        options.modelId,
        options.cache,
        prompt,
        inferOptions
      ).pipe(Effect.map((values) => values[0]?.output ?? ""))
    )
})
