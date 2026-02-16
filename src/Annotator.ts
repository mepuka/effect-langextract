import { Effect, Layer, Stream } from "effect"

import { chunkDocuments, makeBatches } from "./Chunking.js"
import { AnnotatedDocument, Document } from "./Data.js"
import { LangExtractError } from "./Errors.js"
import { FormatHandler } from "./FormatHandler.js"
import { LanguageModel } from "./LanguageModel.js"
import { PromptBuilder } from "./Prompting.js"
import type { PrimedCachePolicy } from "./PrimedCache.js"
import { Resolver } from "./Resolver.js"
import { Tokenizer } from "./Tokenizer.js"

export interface AnnotateOptions {
  readonly maxCharBuffer: number
  readonly batchLength: number
  readonly batchConcurrency: number
  readonly providerConcurrency: number
  readonly passNumber?: number | undefined
  readonly extractionPasses: number
  readonly contextWindowChars?: number | undefined
  readonly additionalContext?: string | undefined
  readonly maxBatchInputTokens?: number | undefined
  readonly cachePolicy?: PrimedCachePolicy | undefined
}

export interface AnnotatorService {
  readonly annotateDocuments: (
    documents: ReadonlyArray<Document>,
    options: AnnotateOptions
  ) => Stream.Stream<AnnotatedDocument, LangExtractError>

  readonly annotateText: (
    text: string,
    options: AnnotateOptions
  ) => Effect.Effect<AnnotatedDocument, LangExtractError>
}

const defaultAnnotatedDocument = (document: Document): AnnotatedDocument =>
  new AnnotatedDocument({
    text: document.text,
    ...(document.documentId !== undefined ? { documentId: document.documentId } : {})
  })

const toLangExtractError = (error: unknown): LangExtractError =>
  new LangExtractError({
    message:
      typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error)
  })

type AnnotatorDependencies = {
  readonly tokenizer: Tokenizer
  readonly promptBuilder: PromptBuilder
  readonly languageModel: LanguageModel
  readonly resolver: Resolver
}

const annotateDocumentsSinglePass = (
  documents: ReadonlyArray<Document>,
  options: AnnotateOptions,
  dependencies: AnnotatorDependencies
): Effect.Effect<ReadonlyArray<AnnotatedDocument>, LangExtractError> =>
  Effect.gen(function* () {
    const chunks = yield* chunkDocuments(
      documents,
      options.maxCharBuffer,
      dependencies.tokenizer
    )
    const batches = makeBatches(chunks, {
      targetBatchLength: options.batchLength,
      maxBatchInputTokens: options.maxBatchInputTokens,
      estimateTokens: (chunk) => {
        const prompt = dependencies.promptBuilder.buildPrompt(
          chunk.chunkText,
          chunk.documentId ?? "",
          chunk.additionalContext
        )
        return Math.ceil(prompt.length / 4)
      }
    })

    yield* Effect.forEach(
      batches,
      (batch) => {
        const prompts = batch.map((chunk) =>
          dependencies.promptBuilder.buildPrompt(
            chunk.chunkText,
            chunk.documentId ?? "",
            chunk.additionalContext
          )
        )
        return dependencies.languageModel
          .infer(prompts, {
            cachePolicy: options.cachePolicy,
            providerConcurrency: options.providerConcurrency,
            passNumber: options.passNumber
          })
          .pipe(
            Effect.mapError(toLangExtractError),
            Effect.flatMap((outputs) =>
              Effect.forEach(outputs, (candidateOutputs) => {
                const firstOutput = candidateOutputs[0]?.output ?? "[]"
                return dependencies.resolver
                  .resolve(firstOutput)
                  .pipe(
                    Effect.mapError(toLangExtractError),
                    Effect.asVoid
                  )
              })
            ),
            Effect.asVoid
          )
      },
      { concurrency: options.batchConcurrency }
    )

    return documents.map(defaultAnnotatedDocument)
  })

const annotateDocumentsImpl = (
  documents: ReadonlyArray<Document>,
  options: AnnotateOptions,
  dependencies: AnnotatorDependencies
): Stream.Stream<AnnotatedDocument, LangExtractError> =>
  Stream.fromEffect(
    annotateDocumentsSinglePass(documents, options, dependencies)
  ).pipe(
    Stream.flatMap((annotated) => Stream.fromIterable(annotated))
  )

const annotateTextImpl = (
  text: string,
  options: AnnotateOptions,
  dependencies: AnnotatorDependencies
): Effect.Effect<AnnotatedDocument, LangExtractError> =>
  annotateDocumentsSinglePass([new Document({ text })], options, dependencies).pipe(
    Effect.map((documents) => documents[0] ?? new AnnotatedDocument({ text }))
  )

export class Annotator extends Effect.Service<Annotator>()(
  "@effect-langextract/Annotator",
  {
    dependencies: [
      Tokenizer.Default,
      PromptBuilder.Default,
      LanguageModel.Default,
      FormatHandler.Default,
      Resolver.Default
    ],
    effect: Effect.gen(function* () {
      const tokenizer = yield* Tokenizer
      const promptBuilder = yield* PromptBuilder
      const languageModel = yield* LanguageModel
      const resolver = yield* Resolver
      const dependencies: AnnotatorDependencies = {
        tokenizer,
        promptBuilder,
        languageModel,
        resolver
      }
      return {
        annotateDocuments: (documents, options) =>
          annotateDocumentsImpl(documents, options, dependencies),
        annotateText: (text, options) =>
          annotateTextImpl(text, options, dependencies)
      } satisfies AnnotatorService
    })
  }
) {}

export const AnnotatorLive: Layer.Layer<Annotator> = Annotator.Default

export const AnnotatorTest: Layer.Layer<Annotator> = Annotator.Default
