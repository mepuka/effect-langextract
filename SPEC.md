# effect-langextract Port Specification

A complete specification for porting [google/langextract](https://github.com/google/langextract) from Python to Effect TypeScript.

---

## 1. Module Map

Every Python module maps to a TypeScript module under `src/`. Backward-compatibility shims (e.g., `langextract/data.py`, `langextract/tokenizer.py`, `langextract/schema.py`, `langextract/inference.py`, `langextract/registry.py`, `langextract/exceptions.py`) are omitted -- the Effect port uses a clean module layout without legacy re-exports.

```
langextract/core/types.py          -> src/FormatType.ts         (FormatType, ScoredOutput, Constraint enums/schemas)
langextract/core/data.py           -> src/Data.ts               (Extraction, Document, AnnotatedDocument, ExampleData, CharInterval, AlignmentStatus)
langextract/data_lib.py            -> src/DataLib.ts             (AnnotatedDocument <-> JSON serialization; mostly replaced by Schema.encode/decode)
langextract/core/exceptions.py     -> src/Errors.ts             (All TaggedError types)
langextract/core/tokenizer.py      -> src/Tokenizer.ts          (Token, TokenInterval, TokenizedText, Tokenizer service, RegexTokenizer, UnicodeTokenizer)
langextract/core/schema.py         -> src/ProviderSchema.ts     (BaseSchema, FormatModeSchema, Constraint re-exports)
langextract/core/format_handler.py -> src/FormatHandler.ts      (FormatHandler class for parsing/formatting model output)
langextract/core/base_model.py     -> src/LanguageModel.ts      (LanguageModel service interface)
langextract/providers/patterns.py  -> src/providers/Patterns.ts (Provider regex pattern constants)
langextract/providers/router.py    -> (eliminated -- replaced by Effect Layer composition)
langextract/providers/builtin_registry.py -> (eliminated -- replaced by Effect Layer composition)
langextract/providers/__init__.py  -> (eliminated -- replaced by Effect Layer composition)
langextract/providers/gemini.py    -> src/providers/Gemini.ts   (GeminiLanguageModel Layer)
langextract/providers/gemini_batch.py -> src/providers/GeminiBatch.ts (Batch API support)
langextract/providers/openai.py    -> src/providers/OpenAI.ts   (OpenAILanguageModel Layer)
langextract/providers/ollama.py    -> src/providers/Ollama.ts   (OllamaLanguageModel Layer)
langextract/providers/schemas/gemini.py -> src/providers/GeminiSchema.ts (Gemini JSON schema generation)
langextract/prompting.py           -> src/Prompting.ts          (PromptTemplate, QAPromptGenerator, ContextAwarePromptBuilder)
langextract/chunking.py            -> src/Chunking.ts           (TextChunk, ChunkIterator, SentenceIterator, batching)
langextract/resolver.py            -> src/Resolver.ts           (Resolver service, WordAligner, alignment algorithms)
langextract/annotation.py          -> src/Annotator.ts          (Annotator service, orchestration, multi-pass merging)
langextract/extraction.py          -> src/Extract.ts            (Top-level extract() function as Effect program)
langextract/prompt_validation.py   -> src/PromptValidation.ts   (Validation of few-shot examples)
langextract/io.py                  -> src/IO.ts                 (Dataset loading, JSONL I/O, URL download)
langextract/visualization.py       -> src/Visualization.ts      (HTML visualization generation)
langextract/progress.py            -> (eliminated -- replaced by Effect logging)
langextract/factory.py             -> (eliminated -- replaced by Effect Layer composition + Config)
langextract/plugins.py             -> (eliminated -- no plugin system needed; use Layer composition)
langextract/__init__.py            -> src/index.ts              (Public API re-exports)
(new)                              -> src/Cli.ts                (@effect/cli command definitions)
```

---

## 2. Data Model Specifications

All data types use `Schema.Struct` from `effect/Schema`. Fields use exact `Schema` types. Python `None` becomes `Schema.optional(...)` with the `exact` modifier (matching `exactOptionalPropertyTypes` in tsconfig).

### 2.1 FormatType

```typescript
// src/FormatType.ts
import { Schema } from "effect"

export const FormatType = Schema.Literal("json", "yaml")
export type FormatType = typeof FormatType.Type
```

### 2.2 AlignmentStatus

```typescript
// src/Data.ts
import { Schema } from "effect"

export const AlignmentStatus = Schema.Literal(
  "match_exact",
  "match_greater",
  "match_lesser",
  "match_fuzzy"
)
export type AlignmentStatus = typeof AlignmentStatus.Type
```

### 2.3 CharInterval

```typescript
export class CharInterval extends Schema.Class<CharInterval>("CharInterval")({
  startPos: Schema.optionalWith(Schema.Int, { exact: true }),
  endPos: Schema.optionalWith(Schema.Int, { exact: true })
}) {}
```

### 2.4 TokenInterval

```typescript
// src/Tokenizer.ts
export class TokenInterval extends Schema.Class<TokenInterval>("TokenInterval")({
  startIndex: Schema.Int.pipe(Schema.withDefault(() => 0)),
  endIndex: Schema.Int.pipe(Schema.withDefault(() => 0))
}) {}
```

### 2.5 TokenType

```typescript
export const TokenType = Schema.Literal("word", "number", "punctuation")
export type TokenType = typeof TokenType.Type
```

### 2.6 Token

```typescript
export class Token extends Schema.Class<Token>("Token")({
  index: Schema.Int,
  tokenType: TokenType,
  charInterval: CharInterval,
  firstTokenAfterNewline: Schema.Boolean.pipe(Schema.withDefault(() => false))
}) {}
```

### 2.7 TokenizedText

```typescript
export class TokenizedText extends Schema.Class<TokenizedText>("TokenizedText")({
  text: Schema.String,
  tokens: Schema.Array(Token).pipe(Schema.withDefault(() => []))
}) {}
```

### 2.8 ScoredOutput

```typescript
// src/FormatType.ts
export class ScoredOutput extends Schema.Class<ScoredOutput>("ScoredOutput")({
  score: Schema.optionalWith(Schema.Number, { exact: true }),
  output: Schema.optionalWith(Schema.String, { exact: true })
}) {}
```

### 2.9 Extraction

```typescript
// src/Data.ts
export class Extraction extends Schema.Class<Extraction>("Extraction")({
  extractionClass: Schema.String,
  extractionText: Schema.String,
  charInterval: Schema.optionalWith(CharInterval, { exact: true }),
  alignmentStatus: Schema.optionalWith(AlignmentStatus, { exact: true }),
  extractionIndex: Schema.optionalWith(Schema.Int, { exact: true }),
  groupIndex: Schema.optionalWith(Schema.Int, { exact: true }),
  description: Schema.optionalWith(Schema.String, { exact: true }),
  attributes: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: Schema.Union(Schema.String, Schema.Array(Schema.String)) }),
    { exact: true }
  ),
  tokenInterval: Schema.optionalWith(TokenInterval, { exact: true })
}) {}
```

### 2.10 Document

```typescript
export class Document extends Schema.Class<Document>("Document")({
  text: Schema.String,
  documentId: Schema.optionalWith(Schema.String, { exact: true }),
  additionalContext: Schema.optionalWith(Schema.String, { exact: true })
}) {}
```

Note: In the Python version, `Document.document_id` auto-generates a UUID if not set. In the Effect port, we handle this with a smart constructor:

```typescript
export const makeDocument = (args: {
  readonly text: string
  readonly documentId?: string | undefined
  readonly additionalContext?: string | undefined
}): Document =>
  new Document({
    ...args,
    documentId: args.documentId ?? `doc_${crypto.randomUUID().slice(0, 8)}`
  })
```

### 2.11 AnnotatedDocument

```typescript
export class AnnotatedDocument extends Schema.Class<AnnotatedDocument>("AnnotatedDocument")({
  documentId: Schema.optionalWith(Schema.String, { exact: true }),
  extractions: Schema.optionalWith(Schema.Array(Extraction), { exact: true }),
  text: Schema.optionalWith(Schema.String, { exact: true })
}) {}
```

### 2.12 ExampleData

```typescript
export class ExampleData extends Schema.Class<ExampleData>("ExampleData")({
  text: Schema.String,
  extractions: Schema.Array(Extraction).pipe(Schema.withDefault(() => []))
}) {}
```

### 2.13 TextChunk

```typescript
// src/Chunking.ts
export class TextChunk extends Schema.Class<TextChunk>("TextChunk")({
  tokenInterval: TokenInterval,
  documentId: Schema.optionalWith(Schema.String, { exact: true }),
  chunkText: Schema.String,
  sanitizedChunkText: Schema.String,
  charInterval: CharInterval,
  additionalContext: Schema.optionalWith(Schema.String, { exact: true })
}) {}
```

Note: Unlike the Python version which lazily computes `chunk_text` from the document, the Effect port pre-computes these at construction time. This eliminates mutable state and `ValueError` possibilities.

### 2.14 PromptTemplateStructured

```typescript
// src/Prompting.ts
export class PromptTemplateStructured extends Schema.Class<PromptTemplateStructured>("PromptTemplateStructured")({
  description: Schema.String,
  examples: Schema.Array(ExampleData).pipe(Schema.withDefault(() => []))
}) {}
```

### 2.15 ModelConfig

```typescript
// src/LanguageModel.ts
export class ModelConfig extends Schema.Class<ModelConfig>("ModelConfig")({
  modelId: Schema.optionalWith(Schema.String, { exact: true }),
  provider: Schema.optionalWith(Schema.String, { exact: true }),
  providerKwargs: Schema.Record({ key: Schema.String, value: Schema.Unknown }).pipe(
    Schema.withDefault(() => ({}))
  )
}) {}
```

### 2.16 FormatHandler

```typescript
// src/FormatHandler.ts
export class FormatHandlerConfig extends Schema.Class<FormatHandlerConfig>("FormatHandlerConfig")({
  formatType: FormatType.pipe(Schema.withDefault(() => "json" as const)),
  useWrapper: Schema.Boolean.pipe(Schema.withDefault(() => true)),
  wrapperKey: Schema.optionalWith(Schema.String, { exact: true }),
  useFences: Schema.Boolean.pipe(Schema.withDefault(() => true)),
  attributeSuffix: Schema.String.pipe(Schema.withDefault(() => "_attributes")),
  strictFences: Schema.Boolean.pipe(Schema.withDefault(() => false)),
  allowTopLevelList: Schema.Boolean.pipe(Schema.withDefault(() => true))
}) {}
```

### 2.17 Validation Types

```typescript
// src/PromptValidation.ts
export const PromptValidationLevel = Schema.Literal("off", "warning", "error")
export type PromptValidationLevel = typeof PromptValidationLevel.Type

export class AlignmentPolicy extends Schema.Class<AlignmentPolicy>("AlignmentPolicy")({
  enableFuzzyAlignment: Schema.Boolean.pipe(Schema.withDefault(() => true)),
  fuzzyAlignmentThreshold: Schema.Number.pipe(Schema.withDefault(() => 0.75)),
  acceptMatchLesser: Schema.Boolean.pipe(Schema.withDefault(() => true))
}) {}

export class ValidationIssue extends Schema.Class<ValidationIssue>("ValidationIssue")({
  exampleIndex: Schema.Int,
  exampleId: Schema.optionalWith(Schema.String, { exact: true }),
  extractionClass: Schema.String,
  extractionTextPreview: Schema.String,
  alignmentStatus: Schema.optionalWith(AlignmentStatus, { exact: true }),
  issueKind: Schema.Literal("failed", "non_exact"),
  charInterval: Schema.optionalWith(Schema.Tuple(Schema.Int, Schema.Int), { exact: true }),
  tokenInterval: Schema.optionalWith(Schema.Tuple(Schema.Int, Schema.Int), { exact: true })
}) {}

export class ValidationReport extends Schema.Class<ValidationReport>("ValidationReport")({
  issues: Schema.Array(ValidationIssue)
}) {
  get hasFailed(): boolean {
    return this.issues.some((i) => i.issueKind === "failed")
  }
  get hasNonExact(): boolean {
    return this.issues.some((i) => i.issueKind === "non_exact")
  }
}
```

---

## 3. Service Definitions

Each service is defined as a `Context.Tag` with an interface specifying methods, input types, and return types (including the Effect error channel).

### 3.1 Tokenizer Service

```typescript
// src/Tokenizer.ts
import { Context, Effect } from "effect"

export interface TokenizerService {
  readonly tokenize: (text: string) => TokenizedText
  readonly tokensText: (tokenizedText: TokenizedText, interval: TokenInterval) => string
  readonly findSentenceRange: (
    text: string,
    tokens: ReadonlyArray<Token>,
    startTokenIndex: number
  ) => TokenInterval
}

export class Tokenizer extends Context.Tag("Tokenizer")<Tokenizer, TokenizerService>() {}
```

### 3.2 LanguageModel Service

```typescript
// src/LanguageModel.ts
import { Context, Effect, Stream } from "effect"

export interface LanguageModelService {
  /** Run inference on a batch of prompts. Returns one ScoredOutput[] per prompt. */
  readonly infer: (
    batchPrompts: ReadonlyArray<string>,
    options?: Record<string, unknown>
  ) => Effect.Effect<ReadonlyArray<ReadonlyArray<ScoredOutput>>, InferenceRuntimeError>

  /** The model identifier */
  readonly modelId: string

  /** Whether this model requires fence output for parsing */
  readonly requiresFenceOutput: boolean

  /** The current schema instance, if any */
  readonly schema: ProviderSchema | undefined
}

export class LanguageModel extends Context.Tag("LanguageModel")<LanguageModel, LanguageModelService>() {}
```

### 3.3 FormatHandler Service

```typescript
// src/FormatHandler.ts
import { Context, Effect } from "effect"

export interface FormatHandlerService {
  /** Format extractions for a prompt example */
  readonly formatExtractionExample: (extractions: ReadonlyArray<Extraction>) => string

  /** Parse model output to extract data */
  readonly parseOutput: (
    text: string,
    options?: { strict?: boolean }
  ) => Effect.Effect<ReadonlyArray<Record<string, unknown>>, FormatParseError>

  /** Configuration accessors */
  readonly config: FormatHandlerConfig
}

export class FormatHandler extends Context.Tag("FormatHandler")<FormatHandler, FormatHandlerService>() {}
```

### 3.4 Resolver Service

```typescript
// src/Resolver.ts
import { Context, Effect } from "effect"

export interface ResolverService {
  /** Parse LLM output text into unaligned Extractions */
  readonly resolve: (
    inputText: string,
    options?: { suppressParseErrors?: boolean }
  ) => Effect.Effect<ReadonlyArray<Extraction>, ResolverParsingError>

  /** Align extractions to source text, computing char/token intervals */
  readonly align: (
    extractions: ReadonlyArray<Extraction>,
    sourceText: string,
    tokenOffset: number,
    charOffset: number,
    options?: {
      enableFuzzyAlignment?: boolean
      fuzzyAlignmentThreshold?: number
      acceptMatchLesser?: boolean
    }
  ) => Effect.Effect<ReadonlyArray<Extraction>, AlignmentError>
}

export class Resolver extends Context.Tag("Resolver")<Resolver, ResolverService>() {}
```

### 3.5 PromptBuilder Service

```typescript
// src/Prompting.ts
import { Context, Effect } from "effect"

export interface PromptBuilderService {
  /** Build a prompt for the given chunk text */
  readonly buildPrompt: (
    chunkText: string,
    documentId: string,
    additionalContext?: string | undefined
  ) => string

  /** Get the underlying prompt template */
  readonly template: PromptTemplateStructured
}

export class PromptBuilder extends Context.Tag("PromptBuilder")<PromptBuilder, PromptBuilderService>() {}
```

### 3.6 Annotator Service

```typescript
// src/Annotator.ts
import { Context, Effect, Stream } from "effect"

export interface AnnotatorService {
  /** Annotate a stream of documents, producing annotated documents */
  readonly annotateDocuments: (
    documents: ReadonlyArray<Document>,
    options: AnnotateOptions
  ) => Stream.Stream<AnnotatedDocument, LangExtractError, LanguageModel | Resolver | Tokenizer>

  /** Annotate a single text string */
  readonly annotateText: (
    text: string,
    options: AnnotateOptions
  ) => Effect.Effect<AnnotatedDocument, LangExtractError, LanguageModel | Resolver | Tokenizer>
}

export interface AnnotateOptions {
  readonly maxCharBuffer: number
  readonly batchLength: number
  readonly extractionPasses: number
  readonly contextWindowChars?: number | undefined
  readonly additionalContext?: string | undefined
}

export class Annotator extends Context.Tag("Annotator")<Annotator, AnnotatorService>() {}
```

### 3.7 Visualizer Service

```typescript
// src/Visualization.ts
import { Context, Effect } from "effect"

export interface VisualizerService {
  /** Generate HTML visualization for an annotated document */
  readonly visualize: (
    doc: AnnotatedDocument,
    options?: {
      animationSpeed?: number
      showLegend?: boolean
    }
  ) => Effect.Effect<string, VisualizationError>
}

export class Visualizer extends Context.Tag("Visualizer")<Visualizer, VisualizerService>() {}
```

### 3.8 PromptValidator Service

```typescript
// src/PromptValidation.ts
import { Context, Effect } from "effect"

export interface PromptValidatorService {
  /** Validate few-shot examples for alignment quality */
  readonly validatePromptAlignment: (
    examples: ReadonlyArray<ExampleData>,
    policy?: AlignmentPolicy
  ) => Effect.Effect<ValidationReport, never, Tokenizer>

  /** Handle validation report based on level */
  readonly handleAlignmentReport: (
    report: ValidationReport,
    level: PromptValidationLevel,
    options?: { strictNonExact?: boolean }
  ) => Effect.Effect<void, PromptAlignmentError>
}

export class PromptValidator extends Context.Tag("PromptValidator")<
  PromptValidator,
  PromptValidatorService
>() {}
```

---

## 4. Layer Definitions

Each service has one or more Layer implementations. Layers are constructed with `Layer.effect` or `Layer.succeed` and composed with `Layer.provide`.

### 4.1 Tokenizer Layers

```typescript
// src/Tokenizer.ts

/** Regex-based tokenizer (default, fast for English) */
export const RegexTokenizerLive: Layer.Layer<Tokenizer> =
  Layer.succeed(Tokenizer, {
    tokenize: regexTokenize,
    tokensText: tokensTextImpl,
    findSentenceRange: findSentenceRangeImpl
  })

/** Unicode-aware tokenizer (better for CJK, Thai, etc.) */
export const UnicodeTokenizerLive: Layer.Layer<Tokenizer> =
  Layer.succeed(Tokenizer, {
    tokenize: unicodeTokenize,
    tokensText: tokensTextImpl,
    findSentenceRange: findSentenceRangeImpl
  })
```

### 4.2 LanguageModel Layers

```typescript
// src/providers/Gemini.ts

export const GeminiLanguageModelLive: Layer.Layer<LanguageModel, InferenceConfigError, GeminiConfig> =
  Layer.effect(
    LanguageModel,
    Effect.gen(function* () {
      const config = yield* GeminiConfig
      // Validate config, initialize client
      return {
        modelId: config.modelId,
        requiresFenceOutput: false,
        schema: undefined,
        infer: (prompts, options) =>
          Effect.tryPromise({
            try: () => callGeminiApi(prompts, config, options),
            catch: (error) => new InferenceRuntimeError({ message: String(error) })
          })
      }
    })
  )
```

```typescript
// src/providers/OpenAI.ts

export const OpenAILanguageModelLive: Layer.Layer<LanguageModel, InferenceConfigError, OpenAIConfig> =
  Layer.effect(
    LanguageModel,
    Effect.gen(function* () {
      const config = yield* OpenAIConfig
      return {
        modelId: config.modelId,
        requiresFenceOutput: config.formatType !== "json",
        schema: undefined,
        infer: (prompts, options) =>
          Effect.tryPromise({
            try: () => callOpenAIApi(prompts, config, options),
            catch: (error) => new InferenceRuntimeError({ message: String(error) })
          })
      }
    })
  )
```

```typescript
// src/providers/Ollama.ts

export const OllamaLanguageModelLive: Layer.Layer<LanguageModel, InferenceConfigError, OllamaConfig> =
  Layer.effect(
    LanguageModel,
    Effect.gen(function* () {
      const config = yield* OllamaConfig
      return {
        modelId: config.modelId,
        requiresFenceOutput: false,
        schema: undefined,
        infer: (prompts, options) =>
          Effect.tryPromise({
            try: () => callOllamaApi(prompts, config, options),
            catch: (error) => new InferenceRuntimeError({ message: String(error) })
          })
      }
    })
  )
```

### 4.3 FormatHandler Layer

```typescript
// src/FormatHandler.ts

export const FormatHandlerLive: Layer.Layer<FormatHandler> =
  Layer.effect(
    FormatHandler,
    Effect.gen(function* () {
      // Defaults: JSON, wrapper, fences
      return makeFormatHandler(new FormatHandlerConfig({}))
    })
  )

/** Create a FormatHandler Layer from explicit config */
export const makeFormatHandlerLayer = (
  config: FormatHandlerConfig
): Layer.Layer<FormatHandler> =>
  Layer.succeed(FormatHandler, makeFormatHandler(config))
```

### 4.4 Resolver Layer

```typescript
// src/Resolver.ts

export const ResolverLive: Layer.Layer<Resolver, never, FormatHandler | Tokenizer> =
  Layer.effect(
    Resolver,
    Effect.gen(function* () {
      const formatHandler = yield* FormatHandler
      const tokenizer = yield* Tokenizer
      return {
        resolve: (inputText, options) => resolveImpl(formatHandler, inputText, options),
        align: (extractions, sourceText, tokenOffset, charOffset, options) =>
          alignImpl(tokenizer, extractions, sourceText, tokenOffset, charOffset, options)
      }
    })
  )
```

### 4.5 Annotator Layer

```typescript
// src/Annotator.ts

export const AnnotatorLive: Layer.Layer<Annotator, never, LanguageModel | Resolver | Tokenizer | PromptBuilder> =
  Layer.effect(
    Annotator,
    Effect.gen(function* () {
      const lm = yield* LanguageModel
      const resolver = yield* Resolver
      const tokenizer = yield* Tokenizer
      const promptBuilder = yield* PromptBuilder
      return {
        annotateDocuments: (docs, opts) =>
          annotateDocumentsImpl(lm, resolver, tokenizer, promptBuilder, docs, opts),
        annotateText: (text, opts) =>
          annotateTextImpl(lm, resolver, tokenizer, promptBuilder, text, opts)
      }
    })
  )
```

### 4.6 Visualizer Layer

```typescript
// src/Visualization.ts

export const VisualizerLive: Layer.Layer<Visualizer> =
  Layer.succeed(Visualizer, {
    visualize: (doc, options) => visualizeImpl(doc, options)
  })
```

---

## 5. Error Model

Python exceptions map to `Schema.TaggedError` types. Each error has a `_tag` discriminant for pattern matching and carries structured data.

```typescript
// src/Errors.ts
import { Schema } from "effect"

/** Base error -- all langextract errors extend this */
export class LangExtractError extends Schema.TaggedError<LangExtractError>()(
  "LangExtractError",
  { message: Schema.String }
) {}

/** Configuration errors (missing API keys, invalid model IDs) */
export class InferenceConfigError extends Schema.TaggedError<InferenceConfigError>()(
  "InferenceConfigError",
  { message: Schema.String }
) {}

/** Runtime inference errors (API failures, timeouts) */
export class InferenceRuntimeError extends Schema.TaggedError<InferenceRuntimeError>()(
  "InferenceRuntimeError",
  {
    message: Schema.String,
    provider: Schema.optionalWith(Schema.String, { exact: true })
  }
) {}

/** No scored outputs from the language model */
export class InferenceOutputError extends Schema.TaggedError<InferenceOutputError>()(
  "InferenceOutputError",
  { message: Schema.String }
) {}

/** Invalid document input (duplicate IDs, malformed) */
export class InvalidDocumentError extends Schema.TaggedError<InvalidDocumentError>()(
  "InvalidDocumentError",
  { message: Schema.String }
) {}

/** Internal invariant violations (bugs in the library) */
export class InternalError extends Schema.TaggedError<InternalError>()(
  "InternalError",
  { message: Schema.String }
) {}

/** Provider/backend specific errors */
export class ProviderError extends Schema.TaggedError<ProviderError>()(
  "ProviderError",
  { message: Schema.String }
) {}

/** Schema validation errors */
export class SchemaValidationError extends Schema.TaggedError<SchemaValidationError>()(
  "SchemaValidationError",
  { message: Schema.String }
) {}

/** Base format handling error */
export class FormatError extends Schema.TaggedError<FormatError>()(
  "FormatError",
  { message: Schema.String }
) {}

/** Format parsing failures (fences, JSON/YAML decode, structure) */
export class FormatParseError extends Schema.TaggedError<FormatParseError>()(
  "FormatParseError",
  { message: Schema.String }
) {}

/** Resolver cannot parse model output */
export class ResolverParsingError extends Schema.TaggedError<ResolverParsingError>()(
  "ResolverParsingError",
  { message: Schema.String }
) {}

/** Alignment failed */
export class AlignmentError extends Schema.TaggedError<AlignmentError>()(
  "AlignmentError",
  { message: Schema.String }
) {}

/** Tokenizer errors */
export class TokenizerError extends Schema.TaggedError<TokenizerError>()(
  "TokenizerError",
  { message: Schema.String }
) {}

export class InvalidTokenIntervalError extends Schema.TaggedError<InvalidTokenIntervalError>()(
  "InvalidTokenIntervalError",
  { message: Schema.String }
) {}

export class SentenceRangeError extends Schema.TaggedError<SentenceRangeError>()(
  "SentenceRangeError",
  { message: Schema.String }
) {}

/** Chunking errors */
export class TokenUtilError extends Schema.TaggedError<TokenUtilError>()(
  "TokenUtilError",
  { message: Schema.String }
) {}

/** Prompt building errors */
export class PromptBuilderError extends Schema.TaggedError<PromptBuilderError>()(
  "PromptBuilderError",
  { message: Schema.String }
) {}

/** Prompt template parse error */
export class PromptParseError extends Schema.TaggedError<PromptParseError>()(
  "PromptParseError",
  { message: Schema.String }
) {}

/** Prompt alignment validation failed */
export class PromptAlignmentError extends Schema.TaggedError<PromptAlignmentError>()(
  "PromptAlignmentError",
  { message: Schema.String }
) {}

/** Dataset/IO errors */
export class InvalidDatasetError extends Schema.TaggedError<InvalidDatasetError>()(
  "InvalidDatasetError",
  { message: Schema.String }
) {}

/** Visualization errors */
export class VisualizationError extends Schema.TaggedError<VisualizationError>()(
  "VisualizationError",
  { message: Schema.String }
) {}
```

---

## 6. Config Model

All configuration is expressed via `Config` from the `effect` package. API keys resolve from environment variables. Provider-specific config uses `Schema.Class` with `Config.all` for construction.

### 6.1 Extraction Config

```typescript
// src/Extract.ts
import { Config } from "effect"

export const ExtractionConfig = Config.all({
  modelId: Config.string("MODEL_ID").pipe(Config.withDefault("gemini-2.5-flash")),
  maxCharBuffer: Config.integer("MAX_CHAR_BUFFER").pipe(Config.withDefault(1000)),
  temperature: Config.number("TEMPERATURE").pipe(Config.option),
  batchLength: Config.integer("BATCH_LENGTH").pipe(Config.withDefault(10)),
  maxWorkers: Config.integer("MAX_WORKERS").pipe(Config.withDefault(10)),
  extractionPasses: Config.integer("EXTRACTION_PASSES").pipe(Config.withDefault(1)),
  contextWindowChars: Config.integer("CONTEXT_WINDOW_CHARS").pipe(Config.option),
  formatType: Config.literal("json", "yaml")("FORMAT_TYPE").pipe(Config.withDefault("json" as const)),
  useFences: Config.boolean("USE_FENCES").pipe(Config.option),
  useSchemaConstraints: Config.boolean("USE_SCHEMA_CONSTRAINTS").pipe(Config.withDefault(true)),
  debug: Config.boolean("DEBUG").pipe(Config.withDefault(false))
})
```

### 6.2 Provider Configs

```typescript
// src/providers/Gemini.ts
export class GeminiConfig extends Context.Tag("GeminiConfig")<
  GeminiConfig,
  {
    readonly modelId: string
    readonly apiKey: string
    readonly temperature: number
    readonly maxWorkers: number
    readonly vertexai: boolean
    readonly project?: string | undefined
    readonly location?: string | undefined
  }
>() {}

export const GeminiConfigLive: Layer.Layer<GeminiConfig> = Layer.effect(
  GeminiConfig,
  Config.all({
    modelId: Config.string("GEMINI_MODEL_ID").pipe(Config.withDefault("gemini-2.5-flash")),
    apiKey: Config.string("GEMINI_API_KEY").pipe(
      Config.orElse(() => Config.string("LANGEXTRACT_API_KEY"))
    ),
    temperature: Config.number("GEMINI_TEMPERATURE").pipe(Config.withDefault(0.0)),
    maxWorkers: Config.integer("GEMINI_MAX_WORKERS").pipe(Config.withDefault(10)),
    vertexai: Config.boolean("GEMINI_VERTEXAI").pipe(Config.withDefault(false)),
    project: Config.string("GOOGLE_CLOUD_PROJECT").pipe(Config.option),
    location: Config.string("GEMINI_LOCATION").pipe(Config.option)
  }).pipe(
    Effect.map((c) => ({
      ...c,
      project: c.project.pipe(Option.getOrUndefined),
      location: c.location.pipe(Option.getOrUndefined)
    }))
  )
)
```

```typescript
// src/providers/OpenAI.ts
export class OpenAIConfig extends Context.Tag("OpenAIConfig")<
  OpenAIConfig,
  {
    readonly modelId: string
    readonly apiKey: string
    readonly baseUrl?: string | undefined
    readonly organization?: string | undefined
    readonly temperature?: number | undefined
    readonly maxWorkers: number
    readonly formatType: FormatType
  }
>() {}

export const OpenAIConfigLive: Layer.Layer<OpenAIConfig> = Layer.effect(
  OpenAIConfig,
  Config.all({
    modelId: Config.string("OPENAI_MODEL_ID").pipe(Config.withDefault("gpt-4o-mini")),
    apiKey: Config.string("OPENAI_API_KEY").pipe(
      Config.orElse(() => Config.string("LANGEXTRACT_API_KEY"))
    ),
    baseUrl: Config.string("OPENAI_BASE_URL").pipe(Config.option),
    organization: Config.string("OPENAI_ORGANIZATION").pipe(Config.option),
    temperature: Config.number("OPENAI_TEMPERATURE").pipe(Config.option),
    maxWorkers: Config.integer("OPENAI_MAX_WORKERS").pipe(Config.withDefault(10)),
    formatType: Config.literal("json", "yaml")("OPENAI_FORMAT_TYPE").pipe(Config.withDefault("json" as const))
  }).pipe(Effect.map((c) => ({
    ...c,
    baseUrl: c.baseUrl.pipe(Option.getOrUndefined),
    organization: c.organization.pipe(Option.getOrUndefined),
    temperature: c.temperature.pipe(Option.getOrUndefined)
  })))
)
```

```typescript
// src/providers/Ollama.ts
export class OllamaConfig extends Context.Tag("OllamaConfig")<
  OllamaConfig,
  {
    readonly modelId: string
    readonly baseUrl: string
    readonly formatType: FormatType
    readonly timeout: number
  }
>() {}

export const OllamaConfigLive: Layer.Layer<OllamaConfig> = Layer.effect(
  OllamaConfig,
  Config.all({
    modelId: Config.string("OLLAMA_MODEL_ID"),
    baseUrl: Config.string("OLLAMA_BASE_URL").pipe(Config.withDefault("http://localhost:11434")),
    formatType: Config.literal("json", "yaml")("OLLAMA_FORMAT_TYPE").pipe(Config.withDefault("json" as const)),
    timeout: Config.integer("OLLAMA_TIMEOUT").pipe(Config.withDefault(120))
  })
)
```

---

## 7. CLI Specification

The CLI uses `@effect/cli` with a top-level `extract` command and sub-commands.

### 7.1 Command Structure

```
effect-langextract extract [options] <input>
effect-langextract visualize [options] <jsonl-path>
```

### 7.2 Extract Command

```typescript
// src/Cli.ts
import { Args, Command, Options } from "@effect/cli"

const input = Args.text({ name: "input" }).pipe(
  Args.withDescription("Text to extract from, or URL, or file path")
)

const extractOptions = {
  promptDescription: Options.text("prompt").pipe(
    Options.withAlias("p"),
    Options.withDescription("Instructions for what to extract")
  ),
  examplesFile: Options.file("examples").pipe(
    Options.withAlias("e"),
    Options.withDescription("Path to YAML/JSON file with few-shot examples")
  ),
  modelId: Options.text("model").pipe(
    Options.withAlias("m"),
    Options.withDefault("gemini-2.5-flash"),
    Options.withDescription("Model ID (e.g., gemini-2.5-flash, gpt-4o, gemma2:2b)")
  ),
  provider: Options.text("provider").pipe(
    Options.optional,
    Options.withDescription("Explicit provider: gemini, openai, ollama")
  ),
  maxCharBuffer: Options.integer("max-chars").pipe(
    Options.withDefault(1000),
    Options.withDescription("Max characters per chunk for inference")
  ),
  batchLength: Options.integer("batch-length").pipe(
    Options.withDefault(10),
    Options.withDescription("Number of chunks per batch")
  ),
  maxWorkers: Options.integer("max-workers").pipe(
    Options.withDefault(10),
    Options.withDescription("Max parallel workers")
  ),
  extractionPasses: Options.integer("passes").pipe(
    Options.withDefault(1),
    Options.withDescription("Number of extraction passes (higher = better recall, more cost)")
  ),
  contextWindow: Options.integer("context-window").pipe(
    Options.optional,
    Options.withDescription("Characters from previous chunk for coreference")
  ),
  formatType: Options.choice("format", ["json", "yaml"]).pipe(
    Options.withDefault("json" as const),
    Options.withDescription("Output format")
  ),
  output: Options.directory("output").pipe(
    Options.withAlias("o"),
    Options.withDefault("output"),
    Options.withDescription("Output directory for JSONL results")
  ),
  outputName: Options.text("output-name").pipe(
    Options.withDefault("data.jsonl"),
    Options.withDescription("Output file name")
  ),
  temperature: Options.float("temperature").pipe(
    Options.optional,
    Options.withDescription("Sampling temperature")
  ),
  debug: Options.boolean("debug").pipe(
    Options.withDefault(false),
    Options.withDescription("Enable debug logging")
  ),
  noProgress: Options.boolean("no-progress").pipe(
    Options.withDefault(false),
    Options.withDescription("Disable progress output")
  )
}

const extractCommand = Command.make("extract", extractOptions, (args) =>
  Effect.gen(function* () {
    // 1. Load examples from file
    // 2. Determine provider from model ID
    // 3. Build Layer stack (LanguageModel + Tokenizer + FormatHandler + Resolver + PromptBuilder + Annotator)
    // 4. Run extraction pipeline
    // 5. Save results to JSONL
  })
)
```

### 7.3 Visualize Command

```typescript
const visualizeOptions = {
  input: Args.file({ name: "jsonl-path" }),
  animationSpeed: Options.float("speed").pipe(
    Options.withDefault(1.0),
    Options.withDescription("Animation speed in seconds")
  ),
  output: Options.file("output").pipe(
    Options.withAlias("o"),
    Options.optional,
    Options.withDescription("Output HTML file path")
  )
}

const visualizeCommand = Command.make("visualize", visualizeOptions, (args) =>
  Effect.gen(function* () {
    // 1. Load JSONL
    // 2. Generate HTML
    // 3. Write to stdout or file
  })
)
```

### 7.4 Root Command

```typescript
const command = Command.make("effect-langextract").pipe(
  Command.withSubcommands([extractCommand, visualizeCommand])
)

export const cli = Command.run(command, {
  name: "effect-langextract",
  version: "0.1.0"
})
```

---

## 8. Pipeline Flow (Effect Style)

### 8.1 Main Extraction Pipeline

```typescript
// src/Extract.ts
export const extract = (options: ExtractOptions) =>
  Effect.gen(function* () {
    const { text, promptDescription, examples, ...opts } = options

    // 1. Validate examples
    if (examples.length === 0) {
      return yield* Effect.fail(
        new InferenceConfigError({ message: "Examples are required for reliable extraction." })
      )
    }

    // 2. Optional prompt validation
    if (opts.promptValidationLevel !== "off") {
      const validator = yield* PromptValidator
      const report = yield* validator.validatePromptAlignment(examples)
      yield* validator.handleAlignmentReport(report, opts.promptValidationLevel)
    }

    // 3. Build prompt template
    const template = new PromptTemplateStructured({
      description: promptDescription,
      examples
    })

    // 4. Fetch URL if needed
    const inputText = opts.fetchUrls && isUrl(text)
      ? yield* downloadText(text)
      : text

    // 5. Run annotation
    const annotator = yield* Annotator
    const result = yield* annotator.annotateText(inputText, {
      maxCharBuffer: opts.maxCharBuffer,
      batchLength: opts.batchLength,
      extractionPasses: opts.extractionPasses,
      contextWindowChars: opts.contextWindowChars,
      additionalContext: opts.additionalContext
    })

    return result
  })
```

### 8.2 Single-Pass Document Annotation

```typescript
// src/Annotator.ts
const annotateDocumentsSinglePass = (
  documents: ReadonlyArray<Document>,
  options: AnnotateOptions
) =>
  Effect.gen(function* () {
    const lm = yield* LanguageModel
    const resolver = yield* Resolver
    const tokenizer = yield* Tokenizer
    const promptBuilder = yield* PromptBuilder

    // 1. Chunk all documents
    const chunks = yield* chunkDocuments(documents, options.maxCharBuffer, tokenizer)

    // 2. Batch chunks
    const batches = makeBatches(chunks, options.batchLength)

    // 3. Process batches with bounded concurrency
    const perDoc = new Map<string, Array<Extraction>>()

    yield* Effect.forEach(batches, (batch) =>
      Effect.gen(function* () {
        // Build prompts for batch
        const prompts = batch.map((chunk) =>
          promptBuilder.buildPrompt(
            chunk.chunkText,
            chunk.documentId ?? "",
            chunk.additionalContext
          )
        )

        // LLM inference (this is where the actual API call happens)
        const outputs = yield* lm.infer(prompts)

        // Resolve and align each chunk's output
        yield* Effect.forEach(
          Array.zip(batch, outputs),
          ([chunk, scoredOutputs]) =>
            Effect.gen(function* () {
              const firstOutput = scoredOutputs[0]
              if (!firstOutput?.output) {
                return yield* Effect.fail(
                  new InferenceOutputError({ message: "No scored outputs from language model." })
                )
              }

              const resolved = yield* resolver.resolve(firstOutput.output)
              const aligned = yield* resolver.align(
                resolved,
                chunk.chunkText,
                chunk.tokenInterval.startIndex,
                chunk.charInterval.startPos ?? 0
              )

              const docId = chunk.documentId ?? ""
              const existing = perDoc.get(docId) ?? []
              perDoc.set(docId, [...existing, ...aligned])
            }),
          { concurrency: "unbounded" }
        )
      }),
      { concurrency: 1 } // batches processed sequentially, but LLM calls within batch are parallel
    )

    // 4. Emit annotated documents in order
    return documents.map((doc) => {
      const docId = doc.documentId ?? ""
      return new AnnotatedDocument({
        documentId: docId,
        extractions: perDoc.get(docId) ?? [],
        text: doc.text
      })
    })
  })
```

### 8.3 Multi-Pass Extraction with Merge

```typescript
const annotateDocumentsMultiPass = (
  documents: ReadonlyArray<Document>,
  options: AnnotateOptions
) =>
  Effect.gen(function* () {
    const passResults = new Map<string, Array<Array<Extraction>>>()
    const documentTexts = new Map<string, string>()

    for (const doc of documents) {
      const docId = doc.documentId ?? ""
      documentTexts.set(docId, doc.text)
      passResults.set(docId, [])
    }

    // Run each pass sequentially
    for (let pass = 0; pass < options.extractionPasses; pass++) {
      const passAnnotations = yield* annotateDocumentsSinglePass(documents, options)

      for (const annotatedDoc of passAnnotations) {
        const docId = annotatedDoc.documentId ?? ""
        const existing = passResults.get(docId) ?? []
        existing.push(annotatedDoc.extractions ?? [])
        passResults.set(docId, existing)
      }
    }

    // Merge non-overlapping extractions (first-pass wins)
    return documents.map((doc) => {
      const docId = doc.documentId ?? ""
      const allPassExtractions = passResults.get(docId) ?? []
      const merged = mergeNonOverlappingExtractions(allPassExtractions)
      return new AnnotatedDocument({
        documentId: docId,
        extractions: merged,
        text: documentTexts.get(docId)
      })
    })
  })
```

### 8.4 Layer Composition Example

```typescript
// Composing the full application layer for Gemini extraction
const AppLayer = Annotator.Live.pipe(
  Layer.provide(ResolverLive),
  Layer.provide(PromptBuilderLive),
  Layer.provide(FormatHandlerLive),
  Layer.provide(GeminiLanguageModelLive),
  Layer.provide(GeminiConfigLive),
  Layer.provide(RegexTokenizerLive)
)

// Running an extraction
const program = extract({
  text: "Marie Curie was a physicist...",
  promptDescription: "Extract person names",
  examples: [myExample],
  maxCharBuffer: 1000,
  batchLength: 10,
  extractionPasses: 1
})

const result = Effect.runPromise(
  program.pipe(Effect.provide(AppLayer))
)
```

---

## 9. Implementation Order

A bottom-up implementation order that ensures each phase can be tested independently.

### Phase 1: Foundation (Data Models + Errors)

**Files**: `src/Errors.ts`, `src/FormatType.ts`, `src/Data.ts`, `src/DataLib.ts`

- All `Schema.TaggedError` types
- All `Schema.Class` data models (CharInterval, TokenInterval, Extraction, Document, AnnotatedDocument, ExampleData, ScoredOutput)
- FormatType literal union
- JSON serialization helpers (though Schema.encode/decode handles most of this)

**Dependencies**: None
**Tests**: Schema roundtrip tests, construction tests, serialization

### Phase 2: Tokenizer + Alignment Core

**Files**: `src/Tokenizer.ts`

- Token, TokenInterval, TokenizedText schemas
- Tokenizer service interface
- `RegexTokenizer` implementation (port the regex patterns from Python)
- `UnicodeTokenizer` implementation (port the Unicode grapheme clustering)
- `tokensText` function
- `findSentenceRange` function
- Sentence boundary detection

**Dependencies**: Phase 1 (CharInterval, errors)
**Tests**: Port tokenizer_test.py -- verify identical tokenization behavior

### Phase 3: Format Handler

**Files**: `src/FormatHandler.ts`

- FormatHandlerConfig schema
- FormatHandler service interface and implementation
- Fence detection/extraction regex
- JSON/YAML parsing with fallback (think-tag stripping)
- Extraction example formatting
- Wrapper key handling

**Dependencies**: Phase 1 (data models, FormatType, errors)
**Tests**: Port format_handler_test.py

### Phase 4: Resolver + Word Alignment

**Files**: `src/Resolver.ts`

- Resolver service interface
- `resolve()` -- parse LLM output into Extractions via FormatHandler
- `extractOrderedExtractions()` -- index sorting, attribute extraction
- WordAligner class (port the difflib SequenceMatcher alignment)
- `alignExtractions()` -- exact matching via matching blocks
- `fuzzyAlignExtraction()` -- sliding window fuzzy alignment
- `tokenizeWithLowercase()` helper
- `normalizeToken()` light stemming

**Dependencies**: Phase 1, Phase 2 (Tokenizer), Phase 3 (FormatHandler)
**Tests**: Port resolver_test.py -- this is the most critical test suite

**Note on difflib port**: TypeScript does not have a built-in `difflib.SequenceMatcher`. Options:
1. Port the core SequenceMatcher algorithm (recommended -- it is ~200 lines)
2. Use an npm package like `difflib` or `diff-match-patch`
The port should implement `set_seqs()`, `get_matching_blocks()`, and `ratio()`.

### Phase 5: Prompting System

**Files**: `src/Prompting.ts`

- PromptTemplateStructured schema
- QAPromptGenerator -- render prompts with examples
- PromptBuilder service interface
- ContextAwarePromptBuilder -- cross-chunk context tracking

**Dependencies**: Phase 1, Phase 3 (FormatHandler)
**Tests**: Port prompting_test.py

### Phase 6: Chunking System

**Files**: `src/Chunking.ts`

- TextChunk schema
- SentenceIterator -- iterate through sentences using Tokenizer
- ChunkIterator -- break documents into chunks respecting maxCharBuffer
- `makeBatches()` -- batch chunks for processing
- Character interval computation from token intervals

**Dependencies**: Phase 1, Phase 2 (Tokenizer)
**Tests**: Port chunking_test.py

### Phase 7: Provider System

**Files**: `src/LanguageModel.ts`, `src/ProviderSchema.ts`, `src/providers/Gemini.ts`, `src/providers/OpenAI.ts`, `src/providers/Ollama.ts`, `src/providers/GeminiSchema.ts`

- LanguageModel service interface
- ProviderSchema base (BaseSchema, FormatModeSchema)
- GeminiSchema -- generate JSON schema from examples
- Gemini provider Layer (using `@google/generative-ai` or `google-genai` npm package)
- OpenAI provider Layer (using `openai` npm package)
- Ollama provider Layer (using HTTP fetch to Ollama REST API)
- Each provider implements the `infer()` method with proper error handling

**Dependencies**: Phase 1 (errors, ScoredOutput), Phase 6 (Config)
**Tests**: Mock-based provider tests, integration tests with real APIs

### Phase 8: Prompt Validation

**Files**: `src/PromptValidation.ts`

- ValidationIssue, ValidationReport schemas
- AlignmentPolicy schema
- PromptValidationLevel
- `validatePromptAlignment()` -- run alignment on examples
- `handleAlignmentReport()` -- log or raise based on level

**Dependencies**: Phase 1, Phase 2, Phase 4 (Resolver/WordAligner)
**Tests**: Port prompt_validation_test.py

### Phase 9: Annotation Orchestration

**Files**: `src/Annotator.ts`

- Annotator service interface + Layer
- Single-pass annotation pipeline
- Multi-pass annotation with non-overlapping merge
- Document chunk iteration
- Batch processing with Effect concurrency

**Dependencies**: Phase 1-8 (all previous phases)
**Tests**: Port annotation_test.py

### Phase 10: Top-Level API + I/O

**Files**: `src/Extract.ts`, `src/IO.ts`

- `extract()` -- the main entry point combining everything
- URL detection and download
- Dataset loading from CSV (using `@effect/platform` file system)
- JSONL reading/writing
- Progress logging via Effect logger

**Dependencies**: Phase 1-9
**Tests**: Port integration tests

### Phase 11: Visualization

**Files**: `src/Visualization.ts`

- HTML generation with color-coded highlights
- Span nesting algorithm
- Legend generation
- Animated visualization with JavaScript
- Tooltip construction

**Dependencies**: Phase 1 (data models)
**Tests**: Port visualization_test.py

### Phase 12: CLI

**Files**: `src/Cli.ts`, `src/index.ts`

- `@effect/cli` command definitions
- Extract command with all options
- Visualize command
- Layer composition based on CLI options
- Entry point that wires everything together

**Dependencies**: All previous phases
**Tests**: CLI integration tests

---

## 10. Differences from Python

### 10.1 Service/Layer Pattern Replaces Factory/Registry

**Python**: Uses a global mutable registry (`router.py`) with regex-based model ID matching. Providers register themselves at import time using decorators. A factory function (`factory.py`) resolves model IDs to provider classes.

**Effect**: The provider is selected at Layer composition time. No global registry. Users compose their Layer stack explicitly:

```typescript
// Instead of:  factory.create_model(ModelConfig(model_id="gemini-2.5-flash"))
// Do:
const layer = GeminiLanguageModelLive.pipe(Layer.provide(GeminiConfigLive))
```

This eliminates runtime registration, import-order dependencies, and global mutable state. The CLI maps the `--provider` flag to the appropriate Layer.

### 10.2 Immutable Data Instead of Mutable Dataclasses

**Python**: Uses mutable dataclasses with property setters (e.g., `Extraction._token_interval`, `Document._tokenized_text`). State is mutated during alignment.

**Effect**: Uses `Schema.Class` which produces immutable objects. Alignment creates new `Extraction` instances with updated fields rather than mutating in place. This makes the code more predictable and thread-safe.

```typescript
// Instead of: extraction.token_interval = TokenInterval(...)
// Do:
const aligned = new Extraction({
  ...extraction,
  tokenInterval: new TokenInterval({ startIndex: i, endIndex: j }),
  charInterval: new CharInterval({ startPos: s, endPos: e }),
  alignmentStatus: "match_exact"
})
```

### 10.3 Effect Error Channel Instead of Exceptions

**Python**: Uses `try/except` with a class hierarchy (LangExtractError -> InferenceError -> InferenceConfigError, etc.). Errors are sometimes silently logged and swallowed (e.g., `suppress_parse_errors`).

**Effect**: Errors appear in the type signature via `Effect<A, E, R>`. The error channel `E` is a union of `Schema.TaggedError` types. This makes error handling explicit and exhaustive. "Suppress" behavior uses `Effect.catchTag`:

```typescript
// Python: if suppress_parse_errors: logging.exception(...); return []
// Effect:
resolver.resolve(text).pipe(
  Effect.catchTag("ResolverParsingError", (e) =>
    Effect.logWarning(`Parse error: ${e.message}`).pipe(Effect.as([]))
  )
)
```

### 10.4 Effect Concurrency Instead of ThreadPoolExecutor

**Python**: Uses `concurrent.futures.ThreadPoolExecutor` for parallel API calls in Gemini/OpenAI providers.

**Effect**: Uses Effect fibers with bounded concurrency:

```typescript
// Python: concurrent.futures.ThreadPoolExecutor(max_workers=10)
// Effect:
Effect.forEach(prompts, (prompt) =>
  callApi(prompt),
  { concurrency: 10 }
)
```

This integrates with Effect's structured concurrency model, providing proper cancellation, resource cleanup, and error propagation.

### 10.5 Config from Environment via Effect Config

**Python**: Reads environment variables inline with `os.getenv()`. API key resolution is scattered across factory.py and provider constructors.

**Effect**: Uses `Config` for all environment variable access, with type-safe defaults and composition. Failed config resolution produces a `ConfigError` automatically. No manual `os.getenv()` calls.

### 10.6 Lazy Computation Becomes Upfront Computation

**Python**: `TextChunk` lazily computes `chunk_text`, `char_interval`, and `sanitized_chunk_text` from the document reference, raising `ValueError` if the document is missing.

**Effect**: `TextChunk` is constructed with all fields pre-computed. The construction function is effectful (can fail) but the resulting value is a plain immutable record. This eliminates runtime surprises from lazy property access.

### 10.7 Stream Instead of Iterator/Generator

**Python**: Uses Python generators (`yield from`) and iterators extensively for lazy document processing.

**Effect**: Uses `Stream` from Effect for lazy sequences with proper resource management:

```typescript
// Python: yield from self._annotate_documents_single_pass(...)
// Effect:
Stream.fromIterable(documents).pipe(
  Stream.flatMap((doc) => chunkDocument(doc, maxCharBuffer)),
  Stream.grouped(batchLength),
  Stream.mapEffect((batch) => processBatch(batch))
)
```

### 10.8 No Backward-Compatibility Shims

**Python**: Has many compatibility modules (`langextract/data.py`, `langextract/tokenizer.py`, `langextract/schema.py`, `langextract/inference.py`, `langextract/registry.py`, `langextract/exceptions.py`, `langextract/_compat/`) for v1.x migration.

**Effect**: Clean slate. No deprecated parameters, no legacy re-exports, no `v2.0.0 removal` warnings. The API is designed fresh using Effect idioms.

### 10.9 No Plugin System

**Python**: Has an entry-point-based plugin system (`plugins.py`, `load_plugins_once()`) for third-party providers.

**Effect**: Extensibility is natural via Layers. Third-party providers simply implement the `LanguageModel` service interface and provide a Layer. No discovery mechanism needed:

```typescript
// Third-party provider
export const MyCustomModelLive: Layer.Layer<LanguageModel, InferenceConfigError, MyConfig> = ...

// User code
const AppLayer = AnnotatorLive.pipe(
  Layer.provide(MyCustomModelLive),
  ...
)
```

### 10.10 TypeScript Regex Instead of Python `regex` Module

**Python**: Uses the `regex` module (not `re`) for Unicode property support (`\p{Is_Han}`, `\p{Script=Latin}`, `\X` grapheme clusters).

**Effect**: TypeScript's built-in regex supports Unicode categories via `/\p{...}/u` flag (ES2018+). For grapheme cluster iteration, use `Intl.Segmenter` (available in all modern runtimes including Bun):

```typescript
// Python: regex.finditer(r"\X", text)
// TypeScript:
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
for (const { segment } of segmenter.segment(text)) { ... }

// Python: regex.compile(r"\p{Is_Han}")
// TypeScript: /\p{Script=Han}/u
```

### 10.11 JSON/YAML Parsing

**Python**: Uses `json` (stdlib) and `yaml` (PyYAML) for parsing.

**Effect**: Uses `JSON.parse()` for JSON. For YAML, use a lightweight npm package like `yaml` (the `yaml` package on npm). YAML support is mainly for prompt template file loading and formatting; most LLM output is JSON.

### 10.12 HTTP Requests

**Python**: Uses `requests` for HTTP (URL downloads, Ollama API).

**Effect**: Uses `@effect/platform`'s `HttpClient` service for all HTTP, providing proper error handling, timeouts, and resource management through the Effect ecosystem.

---

## Appendix A: Constants

These constants should be defined alongside their relevant modules:

```typescript
// src/Data.ts
export const EXTRACTIONS_KEY = "extractions" as const
export const ATTRIBUTE_SUFFIX = "_attributes" as const

// src/Resolver.ts
export const FUZZY_ALIGNMENT_MIN_THRESHOLD = 0.75
export const DEFAULT_INDEX_SUFFIX = "_index"

// src/Tokenizer.ts
export const KNOWN_ABBREVIATIONS = new Set(["Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "St."])
export const CLOSING_PUNCTUATION = new Set(['"', "'", "\u201D", "\u2019", "\u00BB", ")", "]", "}"])
```

## Appendix B: SequenceMatcher Port

The core alignment algorithm depends on Python's `difflib.SequenceMatcher`. This needs to be ported to TypeScript. The key methods needed are:

1. `setSeqs(a: string[], b: string[])` -- set the two sequences
2. `getMatchingBlocks(): Array<[number, number, number]>` -- find all matching blocks
3. `ratio(): number` -- compute similarity ratio

The algorithm uses a hash-map of element positions for fast lookup, then finds the longest common subsequences. A faithful port should be approximately 150-200 lines of TypeScript.

## Appendix C: File Tree

```
src/
  index.ts              -- Public API re-exports
  Errors.ts             -- All TaggedError types
  FormatType.ts         -- FormatType, ScoredOutput, Constraint
  Data.ts               -- Extraction, Document, AnnotatedDocument, ExampleData, CharInterval, AlignmentStatus
  DataLib.ts            -- JSON serialization helpers
  Tokenizer.ts          -- Token types, Tokenizer service, RegexTokenizer, UnicodeTokenizer
  FormatHandler.ts      -- FormatHandler service, parsing, formatting
  ProviderSchema.ts     -- BaseSchema, FormatModeSchema
  LanguageModel.ts      -- LanguageModel service interface, ModelConfig
  Prompting.ts          -- PromptTemplate, QAPromptGenerator, ContextAwarePromptBuilder
  Chunking.ts           -- TextChunk, ChunkIterator, SentenceIterator, batching
  Resolver.ts           -- Resolver service, WordAligner, SequenceMatcher
  Annotator.ts          -- Annotator service, orchestration, multi-pass merge
  Extract.ts            -- Top-level extract() function
  PromptValidation.ts   -- Prompt alignment validation
  IO.ts                 -- Dataset loading, JSONL I/O, URL download
  Visualization.ts      -- HTML visualization generation
  Cli.ts                -- @effect/cli command definitions
  providers/
    Patterns.ts         -- Provider regex patterns (for CLI model-to-provider mapping)
    Gemini.ts           -- Gemini provider Layer + Config
    GeminiBatch.ts      -- Gemini batch API support
    GeminiSchema.ts     -- Gemini JSON schema generation from examples
    OpenAI.ts           -- OpenAI provider Layer + Config
    Ollama.ts           -- Ollama provider Layer + Config
```
