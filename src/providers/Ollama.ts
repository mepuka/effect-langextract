import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import * as HttpClientResponse from "@effect/platform/HttpClientResponse"
import { Clock, Effect, Layer, Schema, Stream } from "effect"

import { InferenceRuntimeError } from "../Errors.js"
import { FormatType, ScoredOutput } from "../FormatType.js"
import type { InferOptions, LanguageModelService } from "../LanguageModel.js"
import { LanguageModel } from "../LanguageModel.js"
import { PrimedCache, PrimedCacheKey, PrimedCachePolicy } from "../PrimedCache.js"
import { FormatModeSchema } from "../ProviderSchema.js"
import { RuntimeControl, withProviderPermitStream } from "../RuntimeControl.js"

export interface OllamaConfigService {
  readonly modelId: string
  readonly baseUrl: string
  readonly formatType: FormatType
  readonly temperature?: number | undefined
  readonly timeout: number
  readonly providerConcurrency: number
  readonly primedCacheScope: "request" | "session"
  readonly primedCachePolicy: PrimedCachePolicy
}

const defaultOllamaConfig: OllamaConfigService = {
  modelId: "llama3.2:latest",
  baseUrl: "http://localhost:11434",
  formatType: "json",
  temperature: undefined,
  timeout: 120,
  providerConcurrency: 8,
  primedCacheScope: "session",
  primedCachePolicy: new PrimedCachePolicy({
    namespace: "ollama"
  })
}

const JsonString = Schema.parseJson()
const JsonRecord = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown
})

const OllamaGenerateResponse = Schema.Struct({
  response: Schema.String,
  done: Schema.optionalWith(Schema.Boolean, { exact: true })
})

const OllamaGenerateStreamResponse = Schema.Struct({
  response: Schema.optionalWith(Schema.String, { exact: true }),
  done: Schema.optionalWith(Schema.Boolean, { exact: true })
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
  modelId: string,
  prompt: string,
  options?: InferOptions
): PrimedCacheKey =>
  new PrimedCacheKey({
    provider: "ollama",
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
  message: string,
  error?: unknown
): InferenceRuntimeError =>
  new InferenceRuntimeError({
    provider: "ollama",
    message:
      error === undefined
        ? message
        : `${message}: ${
            typeof error === "object" && error !== null && "message" in error
              ? String((error as { readonly message: unknown }).message)
              : String(error)
          }`
  })

const logProviderEvent = (
  message: string,
  fields: Readonly<Record<string, unknown>>
): Effect.Effect<void> =>
  Effect.logDebug(message).pipe(Effect.annotateLogs(fields))

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, "")

const invokeOllama = (
  config: OllamaConfigService,
  client: HttpClient.HttpClient,
  prompt: string
): Effect.Effect<string, InferenceRuntimeError> =>
  Effect.gen(function* () {
    const requestBody = {
      model: config.modelId,
      prompt,
      stream: false,
      ...(config.temperature !== undefined
        ? { options: { temperature: config.temperature } }
        : {})
    }

    const request = HttpClientRequest.bodyUnsafeJson(
      HttpClientRequest.post(`${stripTrailingSlash(config.baseUrl)}/api/generate`),
      requestBody
    )

    const parsedResponse = yield* client.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(OllamaGenerateResponse)),
      Effect.mapError((error) =>
        toInferenceRuntimeError("Invalid Ollama generate response", error)
      )
    )

    return parsedResponse.response
  })

const invokeOllamaStream = (
  config: OllamaConfigService,
  client: HttpClient.HttpClient,
  prompt: string
): Stream.Stream<string, InferenceRuntimeError> => {
  const requestBody = {
    model: config.modelId,
    prompt,
    stream: true,
    ...(config.temperature !== undefined
      ? { options: { temperature: config.temperature } }
      : {})
  }

  const request = HttpClientRequest.bodyUnsafeJson(
    HttpClientRequest.post(`${stripTrailingSlash(config.baseUrl)}/api/generate`),
    requestBody
  )

  return HttpClientResponse.stream(
    client.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.mapError((error) =>
        toInferenceRuntimeError("Ollama stream request failed", error)
      )
    )
  ).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => line.trim().length > 0),
    Stream.mapEffect((line) =>
      Schema.decodeUnknown(JsonString)(line).pipe(
        Effect.flatMap((decoded) =>
          Schema.decodeUnknown(OllamaGenerateStreamResponse)(decoded)
        ),
        Effect.mapError((error) =>
          toInferenceRuntimeError("Invalid Ollama stream chunk", error)
        )
      )
    ),
    Stream.map((chunk) => chunk.response ?? ""),
    Stream.filter((delta) => delta.length > 0),
    Stream.mapError((error) =>
      toInferenceRuntimeError("Ollama stream decoding failed", error)
    )
  )
}

const runPromptInference = (
  config: OllamaConfigService,
  cache: PrimedCache,
  runtimeControl: RuntimeControl,
  client: HttpClient.HttpClient,
  prompt: string,
  options?: InferOptions
): Effect.Effect<ReadonlyArray<ScoredOutput>, InferenceRuntimeError> =>
  Effect.gen(function* () {
    const startedAtMs = yield* Clock.currentTimeMillis
    const key = cacheKeyForPrompt(config.modelId, prompt, options)
    const keyString = `${key.namespace}:${key.provider}:${key.modelId}:${key.promptFingerprint}`
    const deterministic = isDeterministicRequest(options)
    const cacheOptions = {
      policy: options?.cachePolicy,
      isDeterministic: deterministic
    } as const

    yield* logProviderEvent("langextract.provider.request_start", {
      provider: "ollama",
      modelId: config.modelId,
      key: keyString,
      promptVersion: key.promptVersion
    })

    const cached = yield* cache.get(key, cacheOptions).pipe(
      Effect.mapError((error) =>
        toInferenceRuntimeError("Failed to read primed cache", error)
      )
    )

    if (cached !== undefined) {
      yield* logProviderEvent("langextract.provider.cache_hit", {
        provider: "ollama",
        modelId: config.modelId,
        key: keyString,
        promptVersion: key.promptVersion
      })
      return withCacheMetadata(cached, keyString, "hit")
    }

    const output = yield* runtimeControl.withProviderPermit(
      "ollama",
      invokeOllama(config, client, prompt)
    ).pipe(
      Effect.tapError(() =>
        logProviderEvent("langextract.provider.request_failed", {
          provider: "ollama",
          modelId: config.modelId,
          key: keyString,
          promptVersion: key.promptVersion,
          reason: "http_generation_failed"
        })
      )
    )
    const scored = [
      new ScoredOutput({
        provider: "ollama",
        output,
        score: 1
      })
    ] as const

    yield* cache.put(key, scored, cacheOptions).pipe(
      Effect.mapError((error) =>
        toInferenceRuntimeError("Failed to write primed cache", error)
      )
    )

    const finishedAtMs = yield* Clock.currentTimeMillis
    yield* logProviderEvent("langextract.provider.cache_miss", {
      provider: "ollama",
      modelId: config.modelId,
      key: keyString,
      promptVersion: key.promptVersion,
      latencyMs: Math.max(0, finishedAtMs - startedAtMs)
    })

    return withCacheMetadata(scored, keyString, "miss")
  })

const makeOllamaLanguageModelService = (
  config: OllamaConfigService,
  cache: PrimedCache,
  runtimeControl: RuntimeControl,
  client: HttpClient.HttpClient
): LanguageModelService => ({
  modelId: config.modelId,
  requiresFenceOutput: config.formatType !== "json",
  schema: new FormatModeSchema({
    formatType: config.formatType,
    useFences: config.formatType !== "json"
  }),
  infer: (batchPrompts, inferOptions) =>
    Effect.forEach(
      batchPrompts,
      (prompt) =>
        runPromptInference(
          config,
          cache,
          runtimeControl,
          client,
          prompt,
          inferOptions
        ),
      {
        concurrency:
          inferOptions?.providerConcurrency ?? config.providerConcurrency
      }
    ),
  generateText: (prompt, inferOptions) =>
    runPromptInference(
      config,
      cache,
      runtimeControl,
      client,
      prompt,
      inferOptions
    ).pipe(
      Effect.map((values) => values[0] ?? new ScoredOutput({}))
    ),
  generateObject: (prompt, inferOptions) =>
    runPromptInference(
      config,
      cache,
      runtimeControl,
      client,
      prompt,
      inferOptions
    ).pipe(
      Effect.flatMap((values) =>
        Schema.decodeUnknown(JsonString)(values[0]?.output ?? "{}").pipe(
          Effect.flatMap((decoded) => Schema.decodeUnknown(JsonRecord)(decoded)),
          Effect.mapError((error) =>
            toInferenceRuntimeError("Failed to decode Ollama JSON object", error)
          )
        )
      )
    ),
  streamText: (prompt, inferOptions) =>
    Stream.unwrap(
      logProviderEvent("langextract.provider.stream_start", {
        provider: "ollama",
        modelId: config.modelId,
        stream: true,
        hasInferOptions: inferOptions !== undefined
      }).pipe(
        Effect.as(
          withProviderPermitStream(
            runtimeControl,
            "ollama",
            invokeOllamaStream(config, client, prompt)
          ).pipe(
            Stream.ensuring(
              logProviderEvent("langextract.provider.stream_complete", {
                provider: "ollama",
                modelId: config.modelId,
                stream: true
              })
            ),
            Stream.tapError(() =>
              logProviderEvent("langextract.provider.stream_failed", {
                provider: "ollama",
                modelId: config.modelId,
                stream: true
              })
            )
          )
        )
      )
    )
})

export class OllamaConfig extends Effect.Service<OllamaConfig>()(
  "@effect-langextract/providers/OllamaConfig",
  {
    sync: () => ({ ...defaultOllamaConfig } satisfies OllamaConfigService)
  }
) {
  static readonly Test: Layer.Layer<OllamaConfig> = OllamaConfig.Default

  static testLayer = (
    overrides?: Partial<OllamaConfigService>
  ): Layer.Layer<OllamaConfig> =>
    Layer.succeed(
      OllamaConfig,
      OllamaConfig.make({
        ...defaultOllamaConfig,
        ...overrides,
        primedCachePolicy:
          overrides?.primedCachePolicy ?? defaultOllamaConfig.primedCachePolicy
      })
    )
}

export const OllamaConfigLive: Layer.Layer<OllamaConfig> = OllamaConfig.Default

export const OllamaLanguageModelLive: Layer.Layer<
  LanguageModel,
  never,
  OllamaConfig | PrimedCache | RuntimeControl | HttpClient.HttpClient
> = Layer.effect(
  LanguageModel,
  Effect.gen(function* () {
    const config = yield* OllamaConfig
    const cache = yield* PrimedCache
    const runtimeControl = yield* RuntimeControl
    const client = yield* HttpClient.HttpClient
    return LanguageModel.make(
      makeOllamaLanguageModelService(config, cache, runtimeControl, client)
    )
  })
)
