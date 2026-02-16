import { Config, Effect } from "effect"

import { Annotator } from "./Annotator.js"
import { ExampleData } from "./Data.js"
import { InferenceConfigError } from "./Errors.js"
import { downloadText, isUrl } from "./IO.js"
import { PrimedCache, PrimedCachePolicy } from "./PrimedCache.js"
import { PromptValidationLevel, PromptValidator } from "./PromptValidation.js"

export const ExtractionConfig = Config.all({
  modelId: Config.string("MODEL_ID").pipe(Config.withDefault("gemini-2.5-flash")),
  maxCharBuffer: Config.integer("MAX_CHAR_BUFFER").pipe(Config.withDefault(1000)),
  temperature: Config.number("TEMPERATURE").pipe(Config.option),
  batchLength: Config.integer("BATCH_LENGTH").pipe(Config.withDefault(10)),
  batchConcurrency: Config.integer("BATCH_CONCURRENCY").pipe(Config.withDefault(1)),
  providerConcurrency: Config.integer("PROVIDER_CONCURRENCY").pipe(Config.withDefault(8)),
  maxBatchInputTokens: Config.integer("MAX_BATCH_INPUT_TOKENS").pipe(Config.option),
  extractionPasses: Config.integer("EXTRACTION_PASSES").pipe(Config.withDefault(1)),
  contextWindowChars: Config.integer("CONTEXT_WINDOW_CHARS").pipe(Config.option),
  formatType: Config.literal("json", "yaml")("FORMAT_TYPE").pipe(Config.withDefault("json" as const)),
  useFences: Config.boolean("USE_FENCES").pipe(Config.option),
  useSchemaConstraints: Config.boolean("USE_SCHEMA_CONSTRAINTS").pipe(Config.withDefault(true)),
  primedCacheEnabled: Config.boolean("PRIMED_CACHE_ENABLED").pipe(Config.withDefault(true)),
  primedCacheDir: Config.string("PRIMED_CACHE_DIR").pipe(Config.withDefault(".cache/langextract")),
  primedCacheNamespace: Config.string("PRIMED_CACHE_NAMESPACE").pipe(Config.withDefault("langextract")),
  primedCacheTtlSeconds: Config.integer("PRIMED_CACHE_TTL_SECONDS").pipe(Config.withDefault(86400)),
  primedCacheDeterministicOnly: Config.boolean("PRIMED_CACHE_DETERMINISTIC_ONLY").pipe(
    Config.withDefault(true)
  ),
  clearPrimedCacheOnStart: Config.boolean("CLEAR_PRIMED_CACHE_ON_START").pipe(Config.withDefault(false)),
  debug: Config.boolean("DEBUG").pipe(Config.withDefault(false))
})

export interface ExtractOptions {
  readonly text: string
  readonly promptDescription: string
  readonly examples: ReadonlyArray<ExampleData>
  readonly maxCharBuffer: number
  readonly batchLength: number
  readonly batchConcurrency: number
  readonly providerConcurrency: number
  readonly extractionPasses: number
  readonly contextWindowChars?: number | undefined
  readonly additionalContext?: string | undefined
  readonly maxBatchInputTokens?: number | undefined
  readonly primedCacheEnabled: boolean
  readonly primedCacheNamespace: string
  readonly primedCacheTtlSeconds: number
  readonly primedCacheDeterministicOnly: boolean
  readonly clearPrimedCacheOnStart: boolean
  readonly promptValidationLevel?: PromptValidationLevel | undefined
  readonly fetchUrls?: boolean | undefined
}

export const extract = (options: ExtractOptions) =>
  Effect.gen(function* () {
    if (options.examples.length === 0) {
      return yield* new InferenceConfigError({
        message: "Examples are required for reliable extraction."
      })
    }

    if (options.promptValidationLevel && options.promptValidationLevel !== "off") {
      const validator = yield* PromptValidator
      const report = yield* validator.validatePromptAlignment(options.examples)
      yield* validator.handleAlignmentReport(report, options.promptValidationLevel)
    }

    const inputText = options.fetchUrls && isUrl(options.text)
      ? yield* downloadText(options.text)
      : options.text

    const primedCache = yield* PrimedCache
    if (options.clearPrimedCacheOnStart) {
      yield* primedCache.clearNamespace(options.primedCacheNamespace)
    }

    const annotator = yield* Annotator
    return yield* annotator.annotateText(inputText, {
      maxCharBuffer: options.maxCharBuffer,
      batchLength: options.batchLength,
      batchConcurrency: options.batchConcurrency,
      providerConcurrency: options.providerConcurrency,
      extractionPasses: options.extractionPasses,
      contextWindowChars: options.contextWindowChars,
      additionalContext: options.additionalContext,
      maxBatchInputTokens: options.maxBatchInputTokens,
      cachePolicy: new PrimedCachePolicy({
        enabled: options.primedCacheEnabled,
        namespace: options.primedCacheNamespace,
        ttlSeconds: options.primedCacheTtlSeconds,
        deterministicOnly: options.primedCacheDeterministicOnly
      })
    })
  })
