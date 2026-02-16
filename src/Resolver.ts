import { Effect, Layer } from "effect"

import { AlignmentStatus, CharInterval, Extraction } from "./Data.js"
import { AlignmentError, ResolverParsingError } from "./Errors.js"
import { FormatHandler } from "./FormatHandler.js"
import { Tokenizer } from "./Tokenizer.js"

export const DEFAULT_INDEX_SUFFIX = "_index"

export interface ResolverService {
  readonly resolve: (
    inputText: string,
    options?: { suppressParseErrors?: boolean }
  ) => Effect.Effect<ReadonlyArray<Extraction>, ResolverParsingError>

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

const toExtraction = (
  record: Record<string, unknown>,
  index: number
): Extraction => {
  const extractionClass =
    typeof record.extractionClass === "string"
      ? record.extractionClass
      : "unknown"

  const extractionText =
    typeof record.extractionText === "string"
      ? record.extractionText
      : ""

  return new Extraction({
    extractionClass,
    extractionText,
    extractionIndex: index
  })
}

const computeAlignmentStatus = (
  sourceText: string,
  extractionText: string
): { status: AlignmentStatus | undefined; interval: CharInterval | undefined } => {
  const searchText = extractionText.trim()
  if (searchText.length === 0) {
    return { status: undefined, interval: undefined }
  }

  const start = sourceText.indexOf(searchText)
  if (start < 0) {
    return { status: undefined, interval: undefined }
  }

  return {
    status: "match_exact",
    interval: new CharInterval({
      startPos: start,
      endPos: start + searchText.length
    })
  }
}

export class Resolver extends Effect.Service<Resolver>()(
  "@effect-langextract/Resolver",
  {
    dependencies: [FormatHandler.Default, Tokenizer.Default],
    effect: Effect.gen(function* () {
      const formatHandler = yield* FormatHandler
      const tokenizer = yield* Tokenizer

      return {
        resolve: (inputText: string) =>
          formatHandler.parseOutput(inputText).pipe(
            Effect.map((records) => records.map(toExtraction)),
            Effect.mapError(
              (error) =>
                new ResolverParsingError({
                  message: error.message
                })
            )
          ),
        align: (
          extractions: ReadonlyArray<Extraction>,
          sourceText: string,
          _tokenOffset: number,
          _charOffset: number
        ) =>
          Effect.sync(() => {
            // Keep tokenization wired in the service until fuzzy alignment is implemented.
            const tokenizedSource = tokenizer.tokenize(sourceText)
            void tokenizedSource

            return extractions.map((extraction) => {
              const alignment = computeAlignmentStatus(sourceText, extraction.extractionText)
              return new Extraction({
                ...extraction,
                ...(alignment.status !== undefined
                  ? { alignmentStatus: alignment.status }
                  : {}),
                ...(alignment.interval !== undefined
                  ? { charInterval: alignment.interval }
                  : {})
              })
            })
          })
      } satisfies ResolverService
    })
  }
) {}

export const ResolverLive: Layer.Layer<Resolver> = Resolver.Default

export const ResolverTest: Layer.Layer<Resolver> = Resolver.Default
