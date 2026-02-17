import { Effect, Layer, Schema, Stream } from "effect"

import { TextChunk, chunkDocuments, makeBatches } from "./Chunking.js"
import { AnnotatedDocument, Document, ExampleData, Extraction } from "./Data.js"
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
  readonly promptDescription?: string | undefined
  readonly promptExamples?: ReadonlyArray<ExampleData> | undefined
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

const JsonString = Schema.parseJson()

const encodeExtractionsForPrompt = (
  extractions: ReadonlyArray<Extraction>
): string => {
  try {
    return Schema.encodeSync(JsonString)(extractions)
  } catch {
    return "[]"
  }
}

const buildPromptForChunk = (
  chunk: TextChunk,
  options: AnnotateOptions,
  dependencies: AnnotatorDependencies
): string => {
  if (
    options.promptDescription !== undefined ||
    (options.promptExamples?.length ?? 0) > 0
  ) {
    const examples = options.promptExamples ?? []
    const exampleSection = examples
      .map((example, index) =>
        [
          `Example ${index + 1}:`,
          example.text,
          encodeExtractionsForPrompt(example.extractions)
        ].join("\n")
      )
      .join("\n\n")

    const description = options.promptDescription ?? "Extract structured entities."
    const documentId = chunk.documentId ?? `doc_${chunk.documentIndex}`
    const context = chunk.additionalContext ?? options.additionalContext

    return [
      description,
      exampleSection,
      `Document: ${documentId}`,
      context !== undefined ? `Context: ${context}` : "",
      `Text:\n${chunk.chunkText}`
    ]
      .filter((part) => part.length > 0)
      .join("\n\n")
  }

  return dependencies.promptBuilder.buildPrompt(
    chunk.chunkText,
    chunk.documentId ?? "",
    chunk.additionalContext ?? options.additionalContext
  )
}

const hasOverlap = (
  left: Extraction,
  right: Extraction
): boolean => {
  const leftStart = left.charInterval?.startPos
  const leftEnd = left.charInterval?.endPos
  const rightStart = right.charInterval?.startPos
  const rightEnd = right.charInterval?.endPos

  if (
    leftStart === undefined ||
    leftEnd === undefined ||
    rightStart === undefined ||
    rightEnd === undefined
  ) {
    return false
  }

  return leftStart < rightEnd && rightStart < leftEnd
}

const mergeExtractions = (
  existing: ReadonlyArray<Extraction>,
  incoming: ReadonlyArray<Extraction>
): ReadonlyArray<Extraction> => {
  const merged = [...existing]
  for (const candidate of incoming) {
    const blocked = merged.some((current) => hasOverlap(current, candidate))
    if (!blocked) {
      merged.push(candidate)
    }
  }
  return merged
}

const sortExtractions = (
  extractions: ReadonlyArray<Extraction>
): ReadonlyArray<Extraction> =>
  [...extractions].sort((left, right) => {
    const leftPos = left.charInterval?.startPos ?? Number.MAX_SAFE_INTEGER
    const rightPos = right.charInterval?.startPos ?? Number.MAX_SAFE_INTEGER
    if (leftPos !== rightPos) {
      return leftPos - rightPos
    }
    return (left.extractionIndex ?? 0) - (right.extractionIndex ?? 0)
  })

const annotateDocumentsPass = (
  documents: ReadonlyArray<Document>,
  options: AnnotateOptions,
  dependencies: AnnotatorDependencies,
  passNumber: number
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
      estimateTokens: (chunk) =>
        Math.ceil(
          buildPromptForChunk(chunk, options, dependencies).length / 4
        )
    })

    const perDocument: Array<Array<Extraction>> = documents.map(() => [])

    yield* Effect.forEach(
      batches,
      (batch) => {
        const prompts = batch.map((chunk) =>
          buildPromptForChunk(chunk, options, dependencies)
        )
        return dependencies.languageModel
          .infer(prompts, {
            cachePolicy: options.cachePolicy,
            providerConcurrency: options.providerConcurrency,
            passNumber
          })
          .pipe(
            Effect.mapError(toLangExtractError),
            Effect.flatMap((outputs) =>
              Effect.forEach(outputs, (candidateOutputs, outputIndex) => {
                const chunk = batch[outputIndex]
                if (chunk === undefined) {
                  return Effect.void
                }

                const firstOutput = candidateOutputs[0]?.output ?? "[]"
                return dependencies.resolver
                  .resolve(firstOutput, {
                    suppressParseErrors: true
                  })
                  .pipe(
                    Effect.mapError(toLangExtractError),
                    Effect.flatMap((resolved) =>
                      dependencies.resolver.align(
                        resolved,
                        chunk.chunkText,
                        chunk.tokenInterval.startIndex,
                        chunk.charInterval.startPos ?? 0,
                        undefined
                      )
                    ),
                    Effect.mapError(toLangExtractError),
                    Effect.tap((aligned) =>
                      Effect.sync(() => {
                        const docIndex = chunk.documentIndex
                        if (perDocument[docIndex] === undefined) {
                          perDocument[docIndex] = []
                        }
                        perDocument[docIndex]?.push(...aligned)
                      })
                    ),
                    Effect.asVoid
                  )
              })
            ),
            Effect.asVoid
          )
      },
      { concurrency: options.batchConcurrency }
    )

    return documents.map((document, index) =>
      new AnnotatedDocument({
        text: document.text,
        ...(document.documentId !== undefined ? { documentId: document.documentId } : {}),
        extractions: sortExtractions(perDocument[index] ?? [])
      })
    )
  })

const annotateDocumentsMerged = (
  documents: ReadonlyArray<Document>,
  options: AnnotateOptions,
  dependencies: AnnotatorDependencies
): Effect.Effect<ReadonlyArray<AnnotatedDocument>, LangExtractError> =>
  Effect.gen(function* () {
    const passes = Math.max(1, options.extractionPasses)
    let merged = documents.map(defaultAnnotatedDocument)

    for (let pass = 1; pass <= passes; pass += 1) {
      const currentPass = yield* annotateDocumentsPass(
        documents,
        options,
        dependencies,
        options.passNumber ?? pass
      )
      merged = merged.map(
        (existing, index) =>
          new AnnotatedDocument({
            text: existing.text,
            ...(existing.documentId !== undefined
              ? { documentId: existing.documentId }
              : {}),
            extractions: sortExtractions(
              mergeExtractions(
                existing.extractions,
                currentPass[index]?.extractions ?? []
              )
            )
          })
      )
    }

    return merged
  })

const annotateDocumentsImpl = (
  documents: ReadonlyArray<Document>,
  options: AnnotateOptions,
  dependencies: AnnotatorDependencies
): Stream.Stream<AnnotatedDocument, LangExtractError> =>
  Stream.fromEffect(
    annotateDocumentsMerged(documents, options, dependencies)
  ).pipe(
    Stream.flatMap((annotated) => Stream.fromIterable(annotated))
  )

const annotateTextImpl = (
  text: string,
  options: AnnotateOptions,
  dependencies: AnnotatorDependencies
): Effect.Effect<AnnotatedDocument, LangExtractError> =>
  annotateDocumentsMerged(
    [
      new Document({
        text,
        ...(options.additionalContext !== undefined
          ? { additionalContext: options.additionalContext }
          : {})
      })
    ],
    options,
    dependencies
  ).pipe(
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
) {
  static readonly Test: Layer.Layer<Annotator> = Annotator.Default
}

export const AnnotatorLive: Layer.Layer<Annotator> = Annotator.Default

export const AnnotatorTest: Layer.Layer<Annotator> = Annotator.Test
