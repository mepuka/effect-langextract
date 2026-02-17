import { Effect, Layer } from "effect"

import { AlignmentStatus, CharInterval, Extraction } from "./Data.js"
import { AlignmentError, ResolverParsingError } from "./Errors.js"
import { FormatHandler } from "./FormatHandler.js"
import { TokenInterval, TokenizedText, Tokenizer } from "./Tokenizer.js"

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
  const extractString = (
    keys: ReadonlyArray<string>
  ): string | undefined => {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === "string" && value.trim().length > 0) {
        return value
      }
    }
    return undefined
  }

  const extractionClass =
    extractString(["extractionClass", "class", "type"]) ?? "unknown"

  const extractionText =
    extractString(["extractionText", "text", "value"]) ?? ""

  return new Extraction({
    extractionClass,
    extractionText,
    extractionIndex: index
  })
}

type AlignmentMatch = {
  readonly status: AlignmentStatus
  readonly interval: CharInterval
  readonly tokenInterval: TokenInterval
}

const findTokenRangeFromChars = (
  tokenized: TokenizedText,
  startPos: number,
  endPos: number
): TokenInterval => {
  let startIndex = -1
  let endIndex = -1

  for (const token of tokenized.tokens) {
    const tokenStart = token.charInterval.startPos ?? 0
    const tokenEnd = token.charInterval.endPos ?? tokenStart

    if (startIndex < 0 && tokenEnd > startPos) {
      startIndex = token.index
    }

    if (tokenStart < endPos) {
      endIndex = token.index + 1
    } else {
      break
    }
  }

  const boundedStart = Math.max(0, startIndex < 0 ? 0 : startIndex)
  const boundedEnd = Math.max(boundedStart, endIndex < 0 ? boundedStart : endIndex)

  return new TokenInterval({
    startIndex: boundedStart,
    endIndex: boundedEnd
  })
}

const computeExactAlignment = (
  tokenized: TokenizedText,
  extractionText: string
): AlignmentMatch | undefined => {
  const sourceText = tokenized.text
  const searchText = extractionText.trim()
  if (searchText.length === 0) {
    return undefined
  }

  const start = sourceText.indexOf(searchText)
  if (start < 0) {
    return undefined
  }

  const end = start + searchText.length
  return {
    status: "match_exact",
    interval: new CharInterval({
      startPos: start,
      endPos: end
    }),
    tokenInterval: findTokenRangeFromChars(tokenized, start, end)
  }
}

const normalizeToken = (value: string): string =>
  value.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, "")

const compareTokenWindows = (
  sourceTokens: ReadonlyArray<string>,
  targetTokens: ReadonlyArray<string>
): number => {
  if (sourceTokens.length === 0 || targetTokens.length === 0) {
    return 0
  }

  const targetSet = new Set(targetTokens)
  let matches = 0
  for (const token of sourceTokens) {
    if (targetSet.has(token)) {
      matches += 1
    }
  }
  return matches / targetTokens.length
}

const computeFuzzyAlignment = (
  tokenized: TokenizedText,
  extractionText: string,
  options?: {
    enableFuzzyAlignment?: boolean
    fuzzyAlignmentThreshold?: number
    acceptMatchLesser?: boolean
  }
): AlignmentMatch | undefined => {
  if (options?.enableFuzzyAlignment === false) {
    return undefined
  }

  const targetTokens = extractionText
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length > 0)

  if (targetTokens.length === 0) {
    return undefined
  }

  const sourceTokens = tokenized.tokens.map((token) => normalizeToken(token.text))
  const threshold = options?.fuzzyAlignmentThreshold ?? 0.75
  const targetLength = targetTokens.length
  const minWindow = Math.max(1, targetLength - 2)
  const maxWindow = Math.min(sourceTokens.length, targetLength + 2)

  let best:
    | {
        readonly score: number
        readonly startIndex: number
        readonly endIndex: number
      }
    | undefined

  for (let window = minWindow; window <= maxWindow; window += 1) {
    for (let start = 0; start + window <= sourceTokens.length; start += 1) {
      const end = start + window
      const score = compareTokenWindows(
        sourceTokens.slice(start, end),
        targetTokens
      )
      if (best === undefined || score > best.score) {
        best = { score, startIndex: start, endIndex: end }
      }
    }
  }

  if (best === undefined || best.score < threshold) {
    return undefined
  }

  const startToken = tokenized.tokens[best.startIndex]
  const endToken = tokenized.tokens[best.endIndex - 1]
  if (startToken === undefined || endToken === undefined) {
    return undefined
  }

  const tokenSpan = best.endIndex - best.startIndex
  let status: AlignmentStatus
  if (tokenSpan === targetLength) {
    status = "match_fuzzy"
  } else if (tokenSpan > targetLength) {
    status = "match_greater"
  } else {
    status = "match_lesser"
  }

  if (status === "match_lesser" && options?.acceptMatchLesser === false) {
    return undefined
  }

  return {
    status,
    interval: new CharInterval({
      startPos: startToken.charInterval.startPos ?? 0,
      endPos: endToken.charInterval.endPos ?? (startToken.charInterval.startPos ?? 0)
    }),
    tokenInterval: new TokenInterval({
      startIndex: best.startIndex,
      endIndex: best.endIndex
    })
  }
}

const withOffsets = (
  extraction: Extraction,
  match: AlignmentMatch | undefined,
  tokenOffset: number,
  charOffset: number
): Extraction => {
  if (match === undefined) {
    return extraction
  }

  const startPos = (match.interval.startPos ?? 0) + charOffset
  const endPos = (match.interval.endPos ?? startPos) + charOffset
  const startIndex = match.tokenInterval.startIndex + tokenOffset
  const endIndex = match.tokenInterval.endIndex + tokenOffset

  return new Extraction({
    ...extraction,
    alignmentStatus: match.status,
    charInterval: new CharInterval({
      startPos,
      endPos
    }),
    tokenInterval: {
      startIndex,
      endIndex
    }
  })
}

export class Resolver extends Effect.Service<Resolver>()(
  "@effect-langextract/Resolver",
  {
    dependencies: [FormatHandler.Default, Tokenizer.Default],
    effect: Effect.gen(function* () {
      const formatHandler = yield* FormatHandler
      const tokenizer = yield* Tokenizer

      return {
        resolve: (inputText: string, options) =>
          formatHandler.parseOutput(inputText, {
            strict: options?.suppressParseErrors !== true
          }).pipe(
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
          tokenOffset: number,
          charOffset: number,
          options
        ) =>
          Effect.sync(() => {
            const tokenizedSource = tokenizer.tokenize(sourceText)

            return extractions.map((extraction) => {
              const exact = computeExactAlignment(
                tokenizedSource,
                extraction.extractionText
              )
              const match =
                exact ??
                computeFuzzyAlignment(
                  tokenizedSource,
                  extraction.extractionText,
                  options
                )

              return withOffsets(
                extraction,
                match,
                tokenOffset,
                charOffset
              )
            })
          })
      } satisfies ResolverService
    })
  }
) {
  static readonly Test: Layer.Layer<Resolver> = Resolver.Default

  static testLayer = (
    service?: ResolverService
  ): Layer.Layer<Resolver, never, FormatHandler | Tokenizer> =>
    service !== undefined
      ? Layer.succeed(Resolver, Resolver.make(service as any))
      : Resolver.DefaultWithoutDependencies
}

export const ResolverLive: Layer.Layer<Resolver> = Resolver.Default

export const ResolverTest: Layer.Layer<Resolver> = Resolver.Test
