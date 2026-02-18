import * as FileSystem from "@effect/platform/FileSystem"
import * as HttpClient from "@effect/platform/HttpClient"
import { Chunk, Effect, Stream } from "effect"

import { Annotator } from "../Annotator.js"
import { AnnotatedDocument, DocumentIdGenerator, ExampleData } from "../Data.js"
import {
  InferenceConfigError,
  LangExtractError,
  PrimedCacheError
} from "../Errors.js"
import { Ingestion, ingestDocuments } from "../Ingestion.js"
import { PrimedCache, PrimedCachePolicy } from "../PrimedCache.js"
import { extractDocumentsStream } from "../ingestion/ExtractDocuments.js"
import { IngestionRequest } from "../ingestion/Models.js"
import type { IngestionError } from "../Ingestion.js"

export interface ExtractRequest {
  readonly ingestion: IngestionRequest
  readonly prompt: {
    readonly description: string
    readonly examples: ReadonlyArray<ExampleData>
  }
  readonly annotate: {
    readonly maxCharBuffer: number
    readonly batchLength: number
    readonly batchConcurrency: number
    readonly providerConcurrency: number
    readonly extractionPasses: number
    readonly contextWindowChars?: number | undefined
    readonly maxBatchInputTokens?: number | undefined
    readonly documentBatchSize?: number | undefined
    readonly additionalContext?: string | undefined
  }
  readonly cachePolicy?: PrimedCachePolicy | undefined
  readonly clearPrimedCacheOnStart?: boolean | undefined
  readonly requireNonEmptyResult?: boolean | undefined
}

export type ExtractApiError =
  | InferenceConfigError
  | IngestionError
  | LangExtractError
  | PrimedCacheError

const defaultCachePolicy = (): PrimedCachePolicy => new PrimedCachePolicy({})

const validateRequest = (
  request: ExtractRequest
): Effect.Effect<void, InferenceConfigError> =>
  Effect.gen(function* () {
    if (request.prompt.examples.length === 0) {
      return yield* new InferenceConfigError({
        message: "Examples are required for reliable extraction."
      })
    }

    if (request.prompt.description.trim().length === 0) {
      return yield* new InferenceConfigError({
        message: "Prompt description must be non-empty."
      })
    }
  })

export const extractStream = (
  request: ExtractRequest
): Stream.Stream<
  AnnotatedDocument,
  ExtractApiError,
  | Ingestion
  | Annotator
  | PrimedCache
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | DocumentIdGenerator
> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* validateRequest(request)

      const cachePolicy = request.cachePolicy ?? defaultCachePolicy()
      if (request.clearPrimedCacheOnStart === true) {
        const primedCache = yield* PrimedCache
        yield* primedCache.clearNamespace(cachePolicy.namespace)
      }

      return extractDocumentsStream(ingestDocuments(request.ingestion), {
        maxCharBuffer: request.annotate.maxCharBuffer,
        batchLength: request.annotate.batchLength,
        batchConcurrency: request.annotate.batchConcurrency,
        providerConcurrency: request.annotate.providerConcurrency,
        extractionPasses: request.annotate.extractionPasses,
        ...(request.annotate.contextWindowChars !== undefined
          ? { contextWindowChars: request.annotate.contextWindowChars }
          : {}),
        ...(request.annotate.additionalContext !== undefined
          ? { additionalContext: request.annotate.additionalContext }
          : {}),
        ...(request.annotate.maxBatchInputTokens !== undefined
          ? { maxBatchInputTokens: request.annotate.maxBatchInputTokens }
          : {}),
        ...(request.annotate.documentBatchSize !== undefined
          ? { documentBatchSize: request.annotate.documentBatchSize }
          : {}),
        promptDescription: request.prompt.description,
        promptExamples: request.prompt.examples,
        cachePolicy
      })
    })
  )

export const extract = (
  request: ExtractRequest
): Effect.Effect<
  ReadonlyArray<AnnotatedDocument>,
  ExtractApiError,
  | Ingestion
  | Annotator
  | PrimedCache
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | DocumentIdGenerator
> =>
  extractStream(request).pipe(
    Stream.runCollect,
    Effect.map(Chunk.toReadonlyArray),
    Effect.flatMap((documents) => {
      const requireNonEmptyResult = request.requireNonEmptyResult ?? true
      if (requireNonEmptyResult && documents.length === 0) {
        return Effect.fail(
          new InferenceConfigError({
            message: "Ingestion produced zero documents."
          })
        )
      }
      return Effect.succeed(documents)
    })
  )
