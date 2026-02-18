import { Command, Options } from "@effect/cli"
import * as HttpClient from "@effect/platform/HttpClient"
import * as KeyValueStore from "@effect/platform/KeyValueStore"
import * as FileSystem from "@effect/platform/FileSystem"
import { Chunk, ConfigProvider, Effect, Layer, Option, Schema, Stream } from "effect"
import * as Console from "effect/Console"

import { AlignmentExecutor } from "./AlignmentExecutor.js"
import { Annotator } from "./Annotator.js"
import { AnnotatedDocument, DocumentIdGenerator, ExampleData } from "./Data.js"
import { decodeAnnotatedDocumentJson, encodeAnnotatedDocumentJson } from "./DataLib.js"
import { InferenceConfigError } from "./Errors.js"
import { ExtractionConfig } from "./Extract.js"
import { FormatHandler } from "./FormatHandler.js"
import { readTextFile, writeTextFile } from "./IO.js"
import { Ingestion, ingestDocuments } from "./Ingestion.js"
import { LanguageModel } from "./LanguageModel.js"
import {
  PrimedCache,
  PrimedCachePolicy,
  makePrimedCacheLayer
} from "./PrimedCache.js"
import { PromptValidator } from "./PromptValidation.js"
import { PromptBuilder } from "./Prompting.js"
import { Resolver } from "./Resolver.js"
import {
  RuntimeControl,
  makeRuntimeControlPermitLayer
} from "./RuntimeControl.js"
import { Tokenizer } from "./Tokenizer.js"
import { Visualizer } from "./Visualization.js"
import { extractDocumentsStream } from "./ingestion/ExtractDocuments.js"
import {
  AdditionalContextMapping,
  CsvIngestionOptions,
  DocumentMappingSpec,
  FieldSelector,
  IngestionRequest,
  IngestionSourceFile,
  IngestionSourceStdin,
  IngestionSourceText,
  IngestionSourceUrl
} from "./ingestion/Models.js"
import {
  AnthropicConfigLive,
  AnthropicLanguageModelLive
} from "./providers/Anthropic.js"
import { GeminiConfigLive, GeminiLanguageModelLive } from "./providers/Gemini.js"
import { OllamaConfigLive, OllamaLanguageModelLive } from "./providers/Ollama.js"
import { OpenAIConfigLive, OpenAILanguageModelLive } from "./providers/OpenAI.js"
import { detectProviderFromModelId } from "./providers/Patterns.js"

export const ProviderName = Schema.Literal(
  "gemini",
  "openai",
  "anthropic",
  "ollama"
)
export type ProviderName = typeof ProviderName.Type

export const OutputFormat = Schema.Literal("json", "jsonl", "html")
export type OutputFormat = typeof OutputFormat.Type

export const InputFormat = Schema.Literal(
  "auto",
  "text",
  "json",
  "jsonl",
  "csv",
  "url",
  "stdin"
)
export type InputFormat = typeof InputFormat.Type

const CliRowErrorMode = Schema.Literal("fail-fast", "skip-row")
type CliRowErrorMode = typeof CliRowErrorMode.Type

type ConfigSource = "cli" | "env" | "default"

export interface ExecuteExtractCommandOptions {
  input?: string | undefined
  inputFormat?: InputFormat | undefined
  textField?: string | undefined
  idField?: string | undefined
  contextField?: ReadonlyArray<string> | undefined
  csvDelimiter?: string | undefined
  csvHeader?: boolean | undefined
  rowErrorMode?: CliRowErrorMode | undefined
  documentBatchSize?: number | undefined
  prompt?: string | undefined
  examplesFile?: string | undefined
  provider?: ProviderName | undefined
  modelId?: string | undefined
  temperature?: number | undefined
  output?: OutputFormat | undefined
  outputPath?: string | undefined
  maxCharBuffer?: number | undefined
  batchLength?: number | undefined
  batchConcurrency?: number | undefined
  providerConcurrency?: number | undefined
  extractionPasses?: number | undefined
  contextWindowChars?: number | undefined
  maxBatchInputTokens?: number | undefined
  primedCacheEnabled?: boolean | undefined
  primedCacheDir?: string | undefined
  primedCacheNamespace?: string | undefined
  primedCacheTtlSeconds?: number | undefined
  primedCacheDeterministicOnly?: boolean | undefined
  clearPrimedCacheOnStart?: boolean | undefined
  openAiApiKey?: string | undefined
  openAiBaseUrl?: string | undefined
  openAiOrganization?: string | undefined
  geminiApiKey?: string | undefined
  geminiBaseUrl?: string | undefined
  anthropicApiKey?: string | undefined
  anthropicBaseUrl?: string | undefined
  ollamaBaseUrl?: string | undefined
  env?: Readonly<Record<string, string | undefined>> | undefined
  primedCacheStoreLayer?:
    | Layer.Layer<KeyValueStore.KeyValueStore>
    | undefined
  languageModelLayer?: Layer.Layer<LanguageModel> | undefined
  alignmentExecutorLayer?: Layer.Layer<AlignmentExecutor> | undefined
}

export interface CliRuntimeOptions {
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
  readonly primedCacheStoreLayer?:
    | Layer.Layer<KeyValueStore.KeyValueStore>
    | undefined
  readonly languageModelLayer?: Layer.Layer<LanguageModel> | undefined
  readonly alignmentExecutorLayer?: Layer.Layer<AlignmentExecutor> | undefined
  readonly emitResultToStdout?: boolean | undefined
}

export interface ExecuteVisualizeCommandOptions {
  readonly input: string
  readonly outputPath?: string | undefined
  readonly animationSpeed?: number | undefined
  readonly showLegend?: boolean | undefined
}

export interface ExecuteExtractCommandResult {
  readonly documents: ReadonlyArray<AnnotatedDocument>
  readonly renderedOutput: string
}

export interface ResolvedExtractCommandConfig {
  readonly input?: string | undefined
  readonly inputFormat: InputFormat
  readonly textField?: string | undefined
  readonly idField?: string | undefined
  readonly contextField: ReadonlyArray<string>
  readonly csvDelimiter?: string | undefined
  readonly csvHeader?: boolean | undefined
  readonly rowErrorMode: CliRowErrorMode
  readonly documentBatchSize: number
  readonly prompt: string
  readonly examplesFile: string
  readonly provider: ProviderName
  readonly modelId: string
  readonly temperature?: number | undefined
  readonly output: OutputFormat
  readonly outputPath?: string | undefined
  readonly maxCharBuffer: number
  readonly batchLength: number
  readonly batchConcurrency: number
  readonly providerConcurrency: number
  readonly extractionPasses: number
  readonly contextWindowChars?: number | undefined
  readonly maxBatchInputTokens?: number | undefined
  readonly primedCacheEnabled: boolean
  readonly primedCacheDir: string
  readonly primedCacheNamespace: string
  readonly primedCacheTtlSeconds: number
  readonly primedCacheDeterministicOnly: boolean
  readonly clearPrimedCacheOnStart: boolean
  readonly openAiApiKey: string
  readonly openAiBaseUrl?: string | undefined
  readonly openAiOrganization?: string | undefined
  readonly geminiApiKey: string
  readonly geminiBaseUrl?: string | undefined
  readonly anthropicApiKey: string
  readonly anthropicBaseUrl?: string | undefined
  readonly ollamaBaseUrl: string
}

const defaultsByProvider: Readonly<Record<ProviderName, string>> = {
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-latest",
  ollama: "llama3.2:latest"
}

const parseProvider = (value: string | undefined): ProviderName | undefined => {
  if (value === undefined) {
    return undefined
  }
  const lowered = value.trim().toLowerCase()
  if (
    lowered === "gemini" ||
    lowered === "openai" ||
    lowered === "anthropic" ||
    lowered === "ollama"
  ) {
    return lowered
  }
  return undefined
}

const parseOutput = (value: string | undefined): OutputFormat | undefined => {
  if (value === undefined) {
    return undefined
  }
  const lowered = value.trim().toLowerCase()
  if (lowered === "json" || lowered === "jsonl" || lowered === "html") {
    return lowered
  }
  return undefined
}

const parseInputFormat = (value: string | undefined): InputFormat | undefined => {
  if (value === undefined) {
    return undefined
  }

  const lowered = value.trim().toLowerCase()
  if (
    lowered === "auto" ||
    lowered === "text" ||
    lowered === "json" ||
    lowered === "jsonl" ||
    lowered === "csv" ||
    lowered === "url" ||
    lowered === "stdin"
  ) {
    return lowered
  }
  return undefined
}

const parseRowErrorMode = (value: string | undefined): CliRowErrorMode | undefined => {
  if (value === undefined) {
    return undefined
  }

  const lowered = value.trim().toLowerCase()
  if (lowered === "fail-fast" || lowered === "skip-row") {
    return lowered
  }
  return undefined
}

const resolveConfigSource = (
  cliValue: unknown,
  envValue: unknown
): ConfigSource => {
  if (cliValue !== undefined) {
    return "cli"
  }
  if (envValue !== undefined) {
    return "env"
  }
  return "default"
}

const pickFirstDefined = <A>(
  ...values: ReadonlyArray<A | undefined>
): A | undefined => values.find((value) => value !== undefined)

const defaultCommandConfig = {
  prompt: "Extract structured entities.",
  examplesFile: "examples.json",
  output: "json" as const,
  inputFormat: "auto" as const,
  rowErrorMode: "fail-fast" as const,
  documentBatchSize: 100,
  ollamaBaseUrl: "http://localhost:11434"
}

const setConfigValue = (
  map: Map<string, string>,
  key: string,
  value: string | number | boolean | undefined
): void => {
  if (value === undefined) {
    return
  }
  map.set(key, String(value))
}

const buildExtractionConfigMap = (
  options: ExecuteExtractCommandOptions,
  env: Readonly<Record<string, string | undefined>>
): Map<string, string> => {
  const map = new Map<string, string>()
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      map.set(key, value)
    }
  }

  const providerFromCli = options.provider
  const providerFromEnv = parseProvider(
    pickFirstDefined(env.LANGEXTRACT_PROVIDER, env.PROVIDER)
  )
  const providerForModelDefault = providerFromCli ?? providerFromEnv ?? "gemini"

  setConfigValue(
    map,
    "MODEL_ID",
    options.modelId ?? env.MODEL_ID ?? defaultsByProvider[providerForModelDefault]
  )
  setConfigValue(map, "MAX_CHAR_BUFFER", options.maxCharBuffer)
  setConfigValue(map, "TEMPERATURE", options.temperature)
  setConfigValue(map, "BATCH_LENGTH", options.batchLength)
  setConfigValue(map, "BATCH_CONCURRENCY", options.batchConcurrency)
  setConfigValue(map, "PROVIDER_CONCURRENCY", options.providerConcurrency)
  setConfigValue(map, "MAX_BATCH_INPUT_TOKENS", options.maxBatchInputTokens)
  setConfigValue(map, "EXTRACTION_PASSES", options.extractionPasses)
  setConfigValue(map, "CONTEXT_WINDOW_CHARS", options.contextWindowChars)
  setConfigValue(map, "PRIMED_CACHE_ENABLED", options.primedCacheEnabled)
  setConfigValue(map, "PRIMED_CACHE_DIR", options.primedCacheDir)
  setConfigValue(map, "PRIMED_CACHE_NAMESPACE", options.primedCacheNamespace)
  setConfigValue(map, "PRIMED_CACHE_TTL_SECONDS", options.primedCacheTtlSeconds)
  setConfigValue(
    map,
    "PRIMED_CACHE_DETERMINISTIC_ONLY",
    options.primedCacheDeterministicOnly
  )
  setConfigValue(
    map,
    "CLEAR_PRIMED_CACHE_ON_START",
    options.clearPrimedCacheOnStart
  )

  return map
}

export const resolveExtractCommandConfig = (
  options: ExecuteExtractCommandOptions,
  envInput?: Readonly<Record<string, string | undefined>>
): Effect.Effect<ResolvedExtractCommandConfig, InferenceConfigError> =>
  Effect.gen(function* () {
    const env = envInput ?? options.env ?? {}
    const providerFromCli = options.provider
    const providerFromEnv = parseProvider(
      pickFirstDefined(env.LANGEXTRACT_PROVIDER, env.PROVIDER)
    )

    const extractionConfigMap = buildExtractionConfigMap(options, env)
    const extractedConfig = yield* ConfigProvider
      .fromMap(extractionConfigMap)
      .load(ExtractionConfig).pipe(
        Effect.mapError(
          (error) =>
            new InferenceConfigError({
              message: `Failed to decode extraction config: ${String(error)}`
            })
        )
      )

    const provider =
      providerFromCli ??
      providerFromEnv ??
      detectProviderFromModelId(extractedConfig.modelId)

    return {
      input: options.input,
      inputFormat:
        pickFirstDefined(
          options.inputFormat,
          parseInputFormat(env.LANGEXTRACT_INPUT_FORMAT)
        ) ?? defaultCommandConfig.inputFormat,
      textField: options.textField,
      idField: options.idField,
      contextField: options.contextField ?? [],
      csvDelimiter: options.csvDelimiter,
      csvHeader: options.csvHeader,
      rowErrorMode:
        pickFirstDefined(
          options.rowErrorMode,
          parseRowErrorMode(env.LANGEXTRACT_ROW_ERROR_MODE)
        ) ?? defaultCommandConfig.rowErrorMode,
      documentBatchSize: options.documentBatchSize ?? defaultCommandConfig.documentBatchSize,
      prompt:
        pickFirstDefined(options.prompt, env.PROMPT_DESCRIPTION) ??
        defaultCommandConfig.prompt,
      examplesFile:
        pickFirstDefined(options.examplesFile, env.EXAMPLES_FILE) ??
        defaultCommandConfig.examplesFile,
      provider,
      modelId: extractedConfig.modelId,
      temperature: Option.getOrUndefined(extractedConfig.temperature),
      output:
        pickFirstDefined(options.output, parseOutput(env.OUTPUT_FORMAT)) ??
        defaultCommandConfig.output,
      outputPath: pickFirstDefined(options.outputPath, env.OUTPUT_PATH),
      maxCharBuffer: extractedConfig.maxCharBuffer,
      batchLength: extractedConfig.batchLength,
      batchConcurrency: extractedConfig.batchConcurrency,
      providerConcurrency: extractedConfig.providerConcurrency,
      extractionPasses: extractedConfig.extractionPasses,
      contextWindowChars: Option.getOrUndefined(extractedConfig.contextWindowChars),
      maxBatchInputTokens: Option.getOrUndefined(extractedConfig.maxBatchInputTokens),
      primedCacheEnabled: extractedConfig.primedCacheEnabled,
      primedCacheDir: extractedConfig.primedCacheDir,
      primedCacheNamespace: extractedConfig.primedCacheNamespace,
      primedCacheTtlSeconds: extractedConfig.primedCacheTtlSeconds,
      primedCacheDeterministicOnly: extractedConfig.primedCacheDeterministicOnly,
      clearPrimedCacheOnStart: extractedConfig.clearPrimedCacheOnStart,
      openAiApiKey:
        pickFirstDefined(options.openAiApiKey, env.OPENAI_API_KEY) ?? "",
      openAiBaseUrl: pickFirstDefined(options.openAiBaseUrl, env.OPENAI_BASE_URL),
      openAiOrganization: pickFirstDefined(
        options.openAiOrganization,
        env.OPENAI_ORGANIZATION
      ),
      geminiApiKey:
        pickFirstDefined(options.geminiApiKey, env.GEMINI_API_KEY) ?? "",
      geminiBaseUrl: pickFirstDefined(options.geminiBaseUrl, env.GEMINI_BASE_URL),
      anthropicApiKey:
        pickFirstDefined(options.anthropicApiKey, env.ANTHROPIC_API_KEY) ?? "",
      anthropicBaseUrl: pickFirstDefined(
        options.anthropicBaseUrl,
        env.ANTHROPIC_BASE_URL
      ),
      ollamaBaseUrl:
        pickFirstDefined(options.ollamaBaseUrl, env.OLLAMA_BASE_URL) ??
        defaultCommandConfig.ollamaBaseUrl
    }
  })

const ExamplesJson = Schema.parseJson(Schema.Array(ExampleData))

const decodeExamples = (
  raw: string,
  examplesPath: string
): Effect.Effect<ReadonlyArray<ExampleData>, InferenceConfigError> =>
  Schema.decodeUnknown(ExamplesJson)(raw).pipe(
    Effect.mapError(
      (error) =>
        new InferenceConfigError({
          message: `Failed to decode examples file (${examplesPath}): ${String(error)}`
        })
    )
  )

const readExamples = (
  examplesPath: string
): Effect.Effect<ReadonlyArray<ExampleData>, InferenceConfigError, FileSystem.FileSystem> =>
  readTextFile(examplesPath).pipe(
    Effect.mapError(
      (error) =>
        new InferenceConfigError({
          message: error.message
        })
    ),
    Effect.flatMap((raw) => decodeExamples(raw, examplesPath))
  )

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

const buildDocumentMapping = (
  config: ResolvedExtractCommandConfig
): DocumentMappingSpec | undefined => {
  const hasAnyFieldMapping =
    config.textField !== undefined ||
    config.idField !== undefined ||
    config.contextField.length > 0

  if (!hasAnyFieldMapping) {
    return undefined
  }

  const contextFields = config.contextField
    .map((field) => field.trim())
    .filter((field) => field.length > 0)

  return new DocumentMappingSpec({
    ...(config.textField !== undefined
      ? {
          text: new FieldSelector({
            path: config.textField,
            required: true,
            trim: true
          })
        }
      : {}),
    ...(config.idField !== undefined
      ? {
          documentId: new FieldSelector({
            path: config.idField,
            required: false,
            trim: true
          })
        }
      : {}),
    ...(contextFields.length === 1 && contextFields[0] !== undefined
      ? {
          additionalContext: new FieldSelector({
            path: contextFields[0],
            required: false,
            trim: true
          })
        }
      : contextFields.length > 1
        ? {
            additionalContext: new AdditionalContextMapping({
              fields: contextFields.map(
                (path) =>
                  new FieldSelector({
                    path,
                    required: false,
                    trim: true
                  })
              ),
              includeFieldNames: true,
              joinWith: "\n"
            })
          }
        : {})
  })
}

const resolveIngestionRequest = (
  config: ResolvedExtractCommandConfig
): Effect.Effect<IngestionRequest, InferenceConfigError> => {
  if (config.input === undefined || config.input.trim().length === 0) {
    return Effect.fail(
      new InferenceConfigError({
        message: "Extract command requires --input."
      })
    )
  }

  const input = config.input.trim()
  const mapping = buildDocumentMapping(config)

  if (config.inputFormat === "text") {
    return Effect.succeed(
      new IngestionRequest({
        source: new IngestionSourceText({ _tag: "text", text: input }),
        format: "text",
        ...(mapping !== undefined ? { mapping } : {}),
        onRowError: config.rowErrorMode
      })
    )
  }

  if (config.inputFormat === "url") {
    if (!isHttpUrl(input)) {
      return Effect.fail(
        new InferenceConfigError({
          message: "--input-format url requires an http/https URL in --input."
        })
      )
    }

    return Effect.succeed(
      new IngestionRequest({
        source: new IngestionSourceUrl({ _tag: "url", url: input }),
        format: "text",
        ...(mapping !== undefined ? { mapping } : {}),
        onRowError: config.rowErrorMode
      })
    )
  }

  const source =
    config.inputFormat === "stdin" || input === "-"
      ? new IngestionSourceStdin({ _tag: "stdin" })
      : isHttpUrl(input)
        ? new IngestionSourceUrl({ _tag: "url", url: input })
        : new IngestionSourceFile({ _tag: "file", path: input })

  const format =
    config.inputFormat === "stdin" ||
    config.inputFormat === "auto"
      ? "auto"
      : config.inputFormat

  return Effect.succeed(
    new IngestionRequest({
      source,
      format,
      ...(mapping !== undefined ? { mapping } : {}),
      ...(config.csvDelimiter !== undefined || config.csvHeader !== undefined
        ? {
            csv: new CsvIngestionOptions({
              ...(config.csvDelimiter !== undefined
                ? { delimiter: config.csvDelimiter }
                : {}),
              ...(config.csvHeader !== undefined
                ? { hasHeader: config.csvHeader }
                : {})
            })
          }
        : {}),
      onRowError: config.rowErrorMode
    })
  )
}

const makeProviderLayer = (
  config: ResolvedExtractCommandConfig,
  cacheLayer: Layer.Layer<PrimedCache>
): Layer.Layer<LanguageModel, never, HttpClient.HttpClient | RuntimeControl> => {
  const makeProviderConfigLayer = (
    entries: ReadonlyArray<
      readonly [string, string | number | boolean | undefined]
    >
  ): Layer.Layer<never> => {
    const map = new Map<string, string>()
    for (const [key, value] of entries) {
      if (value !== undefined) {
        map.set(key, String(value))
      }
    }
    return Layer.setConfigProvider(ConfigProvider.fromMap(map))
  }

  switch (config.provider) {
    case "anthropic": {
      const anthropicConfigLayer = Layer.provide(
        AnthropicConfigLive,
        makeProviderConfigLayer([
          ["ANTHROPIC_MODEL_ID", config.modelId],
          ["ANTHROPIC_API_KEY", config.anthropicApiKey],
          ["ANTHROPIC_BASE_URL", config.anthropicBaseUrl],
          ["ANTHROPIC_TEMPERATURE", config.temperature],
          ["ANTHROPIC_PROVIDER_CONCURRENCY", config.providerConcurrency],
          ["ANTHROPIC_PRIMED_CACHE_NAMESPACE", config.primedCacheNamespace]
        ])
      )
      return Layer.provide(AnthropicLanguageModelLive, [
        anthropicConfigLayer,
        cacheLayer
      ])
    }
    case "openai": {
      const openAiConfigLayer = Layer.provide(
        OpenAIConfigLive,
        makeProviderConfigLayer([
          ["OPENAI_MODEL_ID", config.modelId],
          ["OPENAI_API_KEY", config.openAiApiKey],
          ["OPENAI_BASE_URL", config.openAiBaseUrl],
          ["OPENAI_ORGANIZATION", config.openAiOrganization],
          ["OPENAI_TEMPERATURE", config.temperature],
          ["OPENAI_PROVIDER_CONCURRENCY", config.providerConcurrency],
          ["OPENAI_PRIMED_CACHE_NAMESPACE", config.primedCacheNamespace]
        ])
      )
      return Layer.provide(OpenAILanguageModelLive, [
        openAiConfigLayer,
        cacheLayer
      ])
    }
    case "ollama": {
      const ollamaConfigLayer = Layer.provide(
        OllamaConfigLive,
        makeProviderConfigLayer([
          ["OLLAMA_MODEL_ID", config.modelId],
          ["OLLAMA_BASE_URL", config.ollamaBaseUrl],
          ["OLLAMA_TEMPERATURE", config.temperature],
          ["OLLAMA_PROVIDER_CONCURRENCY", config.providerConcurrency],
          ["OLLAMA_PRIMED_CACHE_NAMESPACE", config.primedCacheNamespace]
        ])
      )
      return Layer.provide(OllamaLanguageModelLive, [
        ollamaConfigLayer,
        cacheLayer
      ])
    }
    case "gemini": {
      const geminiConfigLayer = Layer.provide(
        GeminiConfigLive,
        makeProviderConfigLayer([
          ["GEMINI_MODEL_ID", config.modelId],
          ["GEMINI_API_KEY", config.geminiApiKey],
          ["GEMINI_BASE_URL", config.geminiBaseUrl],
          ["GEMINI_TEMPERATURE", config.temperature ?? 0],
          ["GEMINI_PROVIDER_CONCURRENCY", config.providerConcurrency],
          ["GEMINI_PRIMED_CACHE_NAMESPACE", config.primedCacheNamespace]
        ])
      )
      return Layer.provide(GeminiLanguageModelLive, [
        geminiConfigLayer,
        cacheLayer
      ])
    }
  }
}

const resolverBaseLayer = Layer.provide(Resolver.DefaultWithoutDependencies, [
  Tokenizer.Default,
  FormatHandler.Default
])

const promptValidatorBaseLayer = Layer.provide(
  PromptValidator.DefaultWithoutDependencies,
  [resolverBaseLayer]
)

const visualizerBaseLayer = Visualizer.Default

const makeExecutionLayer = (
  config: ResolvedExtractCommandConfig,
  storeLayer?: Layer.Layer<KeyValueStore.KeyValueStore>,
  languageModelLayer?: Layer.Layer<LanguageModel>,
  alignmentExecutorLayer?: Layer.Layer<AlignmentExecutor>
): Layer.Layer<
  Annotator | PromptValidator | PrimedCache | Visualizer,
  never,
  HttpClient.HttpClient
> => {
  const cacheLayer = makePrimedCacheLayer({
    enableRequestStore: true,
    enableSessionStore: true,
    ...(storeLayer !== undefined ? { keyValueStoreLayer: storeLayer } : {})
  })

  const providerLayer: Layer.Layer<
    LanguageModel,
    never,
    HttpClient.HttpClient | RuntimeControl
  > =
    languageModelLayer ?? makeProviderLayer(config, cacheLayer)

  const effectiveAlignmentExecutorLayer =
    alignmentExecutorLayer ??
    Layer.provide(AlignmentExecutor.DefaultWithoutDependencies, [resolverBaseLayer])

  const annotatorLayer = Layer.provide(Annotator.DefaultWithoutDependencies, [
    Tokenizer.Default,
    PromptBuilder.Default,
    FormatHandler.Default,
    effectiveAlignmentExecutorLayer,
    resolverBaseLayer,
    providerLayer,
    DocumentIdGenerator.Default
  ])

  const mergedLayer = Layer.mergeAll(
    annotatorLayer,
    promptValidatorBaseLayer,
    cacheLayer,
    visualizerBaseLayer
  )

  return Layer.provideMerge(
    mergedLayer,
    makeRuntimeControlPermitLayer(config.providerConcurrency)
  )
}

const AnnotatedDocumentsJson = Schema.parseJson(Schema.Array(AnnotatedDocument))

const encodeAnnotatedDocumentsJson = (
  documents: ReadonlyArray<AnnotatedDocument>
): Effect.Effect<string, InferenceConfigError> =>
  Schema.encode(AnnotatedDocumentsJson)(documents).pipe(
    Effect.mapError(
      (error) =>
        new InferenceConfigError({
          message: `Failed to encode annotated documents JSON: ${String(error)}`
        })
    )
  )

const encodeAnnotatedDocumentsJsonl = (
  documents: ReadonlyArray<AnnotatedDocument>
): Effect.Effect<string, InferenceConfigError> =>
  Effect.forEach(documents, (document) => encodeAnnotatedDocumentJson(document)).pipe(
    Effect.map((rows) => `${rows.join("\n")}\n`),
    Effect.mapError(
      (error) =>
        error instanceof InferenceConfigError
          ? error
          : new InferenceConfigError({
              message: `Failed to encode annotated documents JSONL: ${String(error)}`
            })
    )
  )

const renderExtractOutput = (
  config: ResolvedExtractCommandConfig,
  documents: ReadonlyArray<AnnotatedDocument>,
  executionLayer: Layer.Layer<
    Annotator | PromptValidator | PrimedCache | Visualizer,
    never,
    HttpClient.HttpClient
  >
): Effect.Effect<string, InferenceConfigError, HttpClient.HttpClient> => {
  if (config.output === "json") {
    if (documents.length === 1) {
      const firstDocument = documents[0]
      if (firstDocument === undefined) {
        return Effect.fail(
          new InferenceConfigError({
            message: "Expected a single annotated document."
          })
        )
      }

      return encodeAnnotatedDocumentJson(firstDocument).pipe(
        Effect.mapError(
          (error) =>
            new InferenceConfigError({
              message: `Failed to encode annotated document JSON: ${String(error)}`
            })
        )
      )
    }
    return encodeAnnotatedDocumentsJson(documents)
  }

  if (config.output === "jsonl") {
    return encodeAnnotatedDocumentsJsonl(documents)
  }

  if (documents.length !== 1) {
    return Effect.fail(
      new InferenceConfigError({
        message: "HTML output is only supported for single-document ingestion."
      })
    )
  }

  const firstDocument = documents[0]
  if (firstDocument === undefined) {
    return Effect.fail(
      new InferenceConfigError({
        message: "Expected a single annotated document."
      })
    )
  }

  return Effect.gen(function* () {
    const visualizer = yield* Visualizer
    return yield* visualizer.visualize(firstDocument)
  }).pipe(
    Effect.provide(executionLayer),
    Effect.mapError(
      (error) =>
        new InferenceConfigError({
          message: `Failed to build visualization output: ${String(error)}`
        })
    )
  )
}

export const executeExtractCommand = (
  options: ExecuteExtractCommandOptions
): Effect.Effect<
  ExecuteExtractCommandResult,
  InferenceConfigError,
  FileSystem.FileSystem | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const env = options.env ?? {}
    const config = yield* resolveExtractCommandConfig(options, env)
    const providerEnvValue = pickFirstDefined(env.LANGEXTRACT_PROVIDER, env.PROVIDER)
    const providerSource: "cli" | "env" | "model-id" =
      options.provider !== undefined
        ? "cli"
        : providerEnvValue !== undefined
          ? "env"
          : "model-id"

    yield* Effect.logDebug("langextract.cli.config_resolved").pipe(
      Effect.annotateLogs({
        provider: config.provider,
        modelId: config.modelId,
        output: config.output,
        providerSource,
        modelIdSource: resolveConfigSource(options.modelId, env.MODEL_ID),
        outputSource: resolveConfigSource(options.output, env.OUTPUT_FORMAT),
        primedCacheEnabledSource: resolveConfigSource(
          options.primedCacheEnabled,
          env.PRIMED_CACHE_ENABLED
        ),
        configPath: "effect-config"
      })
    )

    const ingestionRequest = yield* resolveIngestionRequest(config)
    const examples = yield* readExamples(config.examplesFile)
    if (examples.length === 0) {
      return yield* new InferenceConfigError({
        message: "Examples are required for reliable extraction."
      })
    }
    const executionLayer = makeExecutionLayer(
      config,
      options.primedCacheStoreLayer,
      options.languageModelLayer,
      options.alignmentExecutorLayer
    )
    const ingestionLayer = Ingestion.Default

    if (config.clearPrimedCacheOnStart) {
      yield* Effect.gen(function* () {
        const primedCache = yield* PrimedCache
        yield* primedCache.clearNamespace(config.primedCacheNamespace)
      }).pipe(
        Effect.provide(executionLayer),
        Effect.mapError(
          (error) =>
            new InferenceConfigError({
              message: `Failed to clear primed cache namespace: ${String(error)}`
            })
        )
      )
    }

    const documentsStream = ingestDocuments(ingestionRequest)

    const annotatedDocuments = yield* extractDocumentsStream(documentsStream, {
      maxCharBuffer: config.maxCharBuffer,
      batchLength: config.batchLength,
      batchConcurrency: config.batchConcurrency,
      providerConcurrency: config.providerConcurrency,
      extractionPasses: config.extractionPasses,
      ...(config.contextWindowChars !== undefined
        ? { contextWindowChars: config.contextWindowChars }
        : {}),
      ...(config.maxBatchInputTokens !== undefined
        ? { maxBatchInputTokens: config.maxBatchInputTokens }
        : {}),
      promptDescription: config.prompt,
      promptExamples: examples,
      cachePolicy: new PrimedCachePolicy({
        enabled: config.primedCacheEnabled,
        namespace: config.primedCacheNamespace,
        ttlSeconds: config.primedCacheTtlSeconds,
        deterministicOnly: config.primedCacheDeterministicOnly
      }),
      documentBatchSize: config.documentBatchSize
    }).pipe(
      Stream.runCollect,
      Effect.map((values) => Chunk.toReadonlyArray(values)),
      Effect.mapError(
        (error) =>
          new InferenceConfigError({
            message: error.message
          })
      ),
      Effect.provide(
        Layer.mergeAll(
          executionLayer,
          ingestionLayer,
          DocumentIdGenerator.Default
        )
      )
    )

    if (annotatedDocuments.length === 0) {
      return yield* new InferenceConfigError({
        message: "Ingestion produced zero documents."
      })
    }

    const outputText = yield* renderExtractOutput(
      config,
      annotatedDocuments,
      executionLayer
    )

    if (config.outputPath !== undefined) {
      yield* writeTextFile(config.outputPath, outputText).pipe(
        Effect.mapError(
          (error) =>
            new InferenceConfigError({
              message: error.message
            })
        )
      )
    }

    return {
      documents: annotatedDocuments,
      renderedOutput: outputText
    }
  })

export const executeVisualizeCommand = (
  options: ExecuteVisualizeCommandOptions
): Effect.Effect<
  string,
  InferenceConfigError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    if (options.input.trim().length === 0) {
      return yield* new InferenceConfigError({
        message: "Visualize command requires a non-empty --input path."
      })
    }

    const raw = yield* readTextFile(options.input).pipe(
      Effect.mapError(
        (error) =>
          new InferenceConfigError({
            message: error.message
          })
      )
    )

    const document = yield* decodeAnnotatedDocumentJson(raw).pipe(
      Effect.mapError(
        (error) =>
          new InferenceConfigError({
            message: `Failed to decode annotated document JSON (${options.input}): ${String(error)}`
          })
      )
    )

    const html = yield* Effect.gen(function* () {
      const visualizer = yield* Visualizer
      return yield* visualizer.visualize(document, {
        ...(options.animationSpeed !== undefined
          ? { animationSpeed: options.animationSpeed }
          : {}),
        ...(options.showLegend !== undefined
          ? { showLegend: options.showLegend }
          : {})
      })
    }).pipe(
      Effect.mapError(
        (error) =>
          new InferenceConfigError({
            message: `Failed to render visualization HTML: ${String(error)}`
          })
      )
    )

    if (options.outputPath !== undefined) {
      yield* writeTextFile(options.outputPath, html).pipe(
        Effect.mapError(
          (error) =>
            new InferenceConfigError({
              message: error.message
            })
        )
      )
    }

    return html
  }).pipe(Effect.provide(Visualizer.Default))

const optionalTextOption = (
  name: string,
  description: string
): Options.Options<string | undefined> =>
  Options.withDescription(
    Options.withDefault(Options.text(name), undefined),
    description
  )

const repeatedTextOption = (
  name: string,
  description: string
): Options.Options<ReadonlyArray<string>> =>
  Options.withDescription(
    Options.withDefault(Options.repeated(Options.text(name)), []),
    description
  )

const optionalIntegerOption = (
  name: string,
  description: string
): Options.Options<number | undefined> =>
  Options.withDescription(
    Options.withDefault(Options.integer(name), undefined),
    description
  )

const optionalFloatOption = (
  name: string,
  description: string
): Options.Options<number | undefined> =>
  Options.withDescription(
    Options.withDefault(Options.float(name), undefined),
    description
  )

const optionalBooleanOption = (
  name: string,
  description: string
): Options.Options<boolean | undefined> =>
  Options.withDescription(
    Options.withDefault(
      Options.map(
        Options.choice(name, ["true", "false"] as const),
        (value) => value === "true"
      ),
      undefined
    ),
    description
  )

const optionalProviderOption: Options.Options<ProviderName | undefined> =
  Options.withDescription(
    Options.withDefault(
      Options.choice("provider", [
        "gemini",
        "openai",
        "anthropic",
        "ollama"
      ] as const),
      undefined
    ),
    "Provider to use for inference."
  )

const optionalOutputOption: Options.Options<OutputFormat | undefined> =
  Options.withDescription(
    Options.withDefault(
      Options.choice("output", ["json", "jsonl", "html"] as const),
      undefined
    ),
    "Output format."
  )

const optionalInputFormatOption: Options.Options<InputFormat | undefined> =
  Options.withDescription(
    Options.withDefault(
      Options.choice("input-format", [
        "auto",
        "text",
        "json",
        "jsonl",
        "csv",
        "url",
        "stdin"
      ] as const),
      undefined
    ),
    "Input source/format mode."
  )

const optionalRowErrorModeOption: Options.Options<CliRowErrorMode | undefined> =
  Options.withDescription(
    Options.withDefault(
      Options.choice("row-error-mode", ["fail-fast", "skip-row"] as const),
      undefined
    ),
    "Structured-row handling mode."
  )

const extractCliConfig = {
  input: optionalTextOption(
    "input",
    "Unified input value (path, URL, '-', or inline text when --input-format text)."
  ),
  inputFormat: optionalInputFormatOption,
  textField: optionalTextOption(
    "text-field",
    "Structured row field/path mapped to Document.text."
  ),
  idField: optionalTextOption(
    "id-field",
    "Structured row field/path mapped to Document.documentId."
  ),
  contextField: repeatedTextOption(
    "context-field",
    "Repeatable structured row field/path mapped to Document.additionalContext."
  ),
  csvDelimiter: optionalTextOption(
    "csv-delimiter",
    "CSV delimiter character (defaults to ',')."
  ),
  csvHeader: optionalBooleanOption(
    "csv-header",
    "Whether CSV has a header row (true|false)."
  ),
  rowErrorMode: optionalRowErrorModeOption,
  documentBatchSize: optionalIntegerOption(
    "document-batch-size",
    "Number of documents grouped per annotation call."
  ),
  prompt: optionalTextOption("prompt", "Prompt description."),
  examplesFile: optionalTextOption(
    "examples-file",
    "Path to few-shot examples JSON file."
  ),
  provider: optionalProviderOption,
  modelId: optionalTextOption("model-id", "Model identifier."),
  temperature: optionalFloatOption("temperature", "Model sampling temperature."),
  output: optionalOutputOption,
  outputPath: optionalTextOption("output-path", "Output destination path."),
  maxCharBuffer: optionalIntegerOption(
    "max-char-buffer",
    "Maximum character buffer per chunk."
  ),
  batchLength: optionalIntegerOption(
    "batch-length",
    "Target number of chunks per batch."
  ),
  batchConcurrency: optionalIntegerOption(
    "batch-concurrency",
    "Concurrent batch worker count."
  ),
  providerConcurrency: optionalIntegerOption(
    "provider-concurrency",
    "Concurrent provider request count."
  ),
  extractionPasses: optionalIntegerOption(
    "extraction-passes",
    "Number of extraction passes."
  ),
  contextWindowChars: optionalIntegerOption(
    "context-window-chars",
    "Context window size in characters."
  ),
  maxBatchInputTokens: optionalIntegerOption(
    "max-batch-input-tokens",
    "Maximum estimated tokens per batch."
  ),
  primedCacheEnabled: optionalBooleanOption(
    "primed-cache-enabled",
    "Enable primed cache (true|false)."
  ),
  primedCacheDir: optionalTextOption(
    "primed-cache-dir",
    "Primed cache root directory."
  ),
  primedCacheNamespace: optionalTextOption(
    "primed-cache-namespace",
    "Primed cache namespace."
  ),
  primedCacheTtlSeconds: optionalIntegerOption(
    "primed-cache-ttl-seconds",
    "Primed cache TTL in seconds."
  ),
  primedCacheDeterministicOnly: optionalBooleanOption(
    "primed-cache-deterministic-only",
    "Only cache deterministic requests (true|false)."
  ),
  clearPrimedCacheOnStart: optionalBooleanOption(
    "clear-primed-cache-on-start",
    "Clear namespace at startup (true|false)."
  )
} as const

type ExtractCliConfig = Command.Command.ParseConfig<typeof extractCliConfig>

const visualizeCliConfig = {
  input: Options.withDescription(
    Options.text("input"),
    "Path to an annotated document JSON file."
  ),
  outputPath: optionalTextOption("output-path", "Output HTML file path."),
  animationSpeed: optionalFloatOption(
    "animation-speed",
    "Animation speed in seconds."
  ),
  showLegend: optionalBooleanOption(
    "show-legend",
    "Render extraction legend (true|false)."
  )
} as const

type VisualizeCliConfig = Command.Command.ParseConfig<typeof visualizeCliConfig>

const runExtractFromCli = (
  config: ExtractCliConfig,
  runtime: CliRuntimeOptions
): Effect.Effect<
  void,
  InferenceConfigError,
  FileSystem.FileSystem | HttpClient.HttpClient
> =>
  executeExtractCommand({
    ...config,
    env: runtime.env,
    primedCacheStoreLayer: runtime.primedCacheStoreLayer,
    languageModelLayer: runtime.languageModelLayer,
    alignmentExecutorLayer: runtime.alignmentExecutorLayer
  }).pipe(
    Effect.flatMap((result) => {
      if (runtime.emitResultToStdout === false || config.outputPath !== undefined) {
        return Effect.void
      }

      return Console.log(result.renderedOutput)
    })
  )

const runVisualizeFromCli = (
  config: VisualizeCliConfig,
  runtime: CliRuntimeOptions
): Effect.Effect<void, InferenceConfigError, FileSystem.FileSystem> =>
  executeVisualizeCommand({
    input: config.input,
    outputPath: config.outputPath,
    animationSpeed: config.animationSpeed,
    showLegend: config.showLegend
  }).pipe(
    Effect.flatMap((html) => {
      if (runtime.emitResultToStdout === false || config.outputPath !== undefined) {
        return Effect.void
      }
      return Console.log(html)
    })
  )

export const makeExtractCommand = (
  runtime: CliRuntimeOptions = {}
)=>
  Command.make(
    "extract",
    extractCliConfig,
    (config) => runExtractFromCli(config, runtime)
  ).pipe(
    Command.withDescription(
      "Extract structured data from unified ingestion inputs."
    )
  )

export const makeVisualizeCommand = (
  runtime: CliRuntimeOptions = {}
)=>
  Command.make(
    "visualize",
    visualizeCliConfig,
    (config) => runVisualizeFromCli(config, runtime)
  ).pipe(
    Command.withDescription(
      "Render HTML visualization from an annotated document JSON file."
    )
  )

export const makeCliCommand = (
  runtime: CliRuntimeOptions = {}
)=>
  Command.make(
    "effect-langextract",
    {},
    () =>
      Console.log(
        "Use the `extract` or `visualize` subcommand. Run with `--help` for details."
      )
  ).pipe(
    Command.withDescription("Effect-native LangExtract CLI."),
    Command.withSubcommands([
      makeExtractCommand(runtime),
      makeVisualizeCommand(runtime)
    ])
  )

export const runCli = (
  argv: ReadonlyArray<string>,
  runtime: CliRuntimeOptions = {}
) =>
  Command.run(
    makeCliCommand(runtime),
    {
      name: "effect-langextract",
      version: "0.1.0"
    }
  )(argv)
