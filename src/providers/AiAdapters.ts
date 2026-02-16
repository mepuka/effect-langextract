import { createHash } from "node:crypto"

import { Effect, Stream } from "effect"

import { makeStaticLanguageModel } from "../LanguageModel.js"
import type {
  InferOptions,
  LanguageModelService
} from "../LanguageModel.js"
import { InferenceRuntimeError } from "../Errors.js"
import { ScoredOutput } from "../FormatType.js"
import { PrimedCache, PrimedCacheKey } from "../PrimedCache.js"

const inferProviderOutput = (
  provider: string,
  prompt: string
): string => {
  const marker = "Text:\n"
  const textIndex = prompt.lastIndexOf(marker)
  const sourceText =
    textIndex >= 0
      ? prompt.slice(textIndex + marker.length).trim()
      : prompt.trim()

  const firstLine = sourceText.split("\n")[0] ?? sourceText
  const words = firstLine
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter((word) => word.length > 0)

  const extractionText =
    words.length >= 2
      ? `${words[0]} ${words[1]}`
      : (words[0] ?? sourceText.slice(0, 24)).trim()

  const extraction = {
    extractionClass: "snippet",
    extractionText: extractionText.length > 0 ? extractionText : sourceText
  }

  return JSON.stringify([extraction])
}

const makeCacheFingerprint = (prompt: string): string =>
  createHash("sha256").update(prompt).digest("hex")

const normalizeNamespace = (options?: InferOptions): string =>
  options?.cachePolicy?.namespace ?? "langextract"

const isDeterministicRequest = (
  options?: InferOptions
): boolean => {
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

const runPromptInference = (
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
      Effect.mapError(
        (error) =>
          new InferenceRuntimeError({
            provider,
            message: `Failed to read primed cache: ${error.message}`
          })
      )
    )

    if (cached !== undefined) {
      return withCacheMetadata(cached, keyString, "hit")
    }

    const output = inferProviderOutput(provider, prompt)
    const scored = [
      new ScoredOutput({
        provider,
        output,
        score: 1
      })
    ] as const

    yield* cache.put(key, scored, cacheOptions).pipe(
      Effect.mapError(
        (error) =>
          new InferenceRuntimeError({
            provider,
            message: `Failed to write primed cache: ${error.message}`
          })
      )
    )

    return withCacheMetadata(scored, keyString, "miss")
  })

export const makeProviderLanguageModelService = (options: {
  readonly provider: string
  readonly modelId: string
  readonly requiresFenceOutput?: boolean
  readonly cache: PrimedCache
}): LanguageModelService => {
  const staticModel = makeStaticLanguageModel({
    provider: options.provider,
    modelId: options.modelId,
    ...(options.requiresFenceOutput !== undefined
      ? { requiresFenceOutput: options.requiresFenceOutput }
      : {})
  })

  return {
    ...staticModel,
    infer: (batchPrompts, inferOptions) =>
      Effect.forEach(
        batchPrompts,
        (prompt) =>
          runPromptInference(
            options.provider,
            options.modelId,
            options.cache,
            prompt,
            inferOptions
          ),
        {
          concurrency: inferOptions?.providerConcurrency ?? 8
        }
      ),
    generateText: (prompt, inferOptions) =>
      runPromptInference(
        options.provider,
        options.modelId,
        options.cache,
        prompt,
        inferOptions
      ).pipe(
        Effect.map((values) => values[0] ?? new ScoredOutput({}))
      ),
    generateObject: (prompt, inferOptions) =>
      runPromptInference(
        options.provider,
        options.modelId,
        options.cache,
        prompt,
        inferOptions
      ).pipe(
        Effect.map((values) => JSON.parse(values[0]?.output ?? "{}")),
        Effect.catchAll((error) =>
          Effect.fail(
            new InferenceRuntimeError({
              provider: options.provider,
              message: `Failed to parse provider JSON output: ${error.message}`
            })
          )
        )
      ),
    streamText: (prompt, inferOptions) =>
      Stream.fromEffect(
        runPromptInference(
          options.provider,
          options.modelId,
          options.cache,
          prompt,
          inferOptions
        ).pipe(
          Effect.map((values) => values[0]?.output ?? "")
        )
      )
  }
}

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
