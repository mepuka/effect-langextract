import { Effect, Schema } from "effect"

import { CharInterval, Document } from "./Data.js"
import { TokenInterval } from "./Tokenizer.js"
import type { TokenizerService } from "./Tokenizer.js"

export class TextChunk extends Schema.Class<TextChunk>("TextChunk")({
  documentId: Schema.optionalWith(Schema.String, { exact: true }),
  chunkText: Schema.String,
  sanitizedChunkText: Schema.String,
  charInterval: CharInterval,
  tokenInterval: TokenInterval,
  additionalContext: Schema.optionalWith(Schema.String, { exact: true })
}) {}

export type BatchBuildOptions<T> = {
  readonly targetBatchLength: number
  readonly maxBatchInputTokens?: number | undefined
  readonly estimateTokens: (item: T) => number
}

export const makeBatches = <T>(
  items: ReadonlyArray<T>,
  options: BatchBuildOptions<T>
): ReadonlyArray<ReadonlyArray<T>> => {
  const batches: Array<Array<T>> = []
  let currentBatch: Array<T> = []
  let currentTokens = 0

  const flush = () => {
    if (currentBatch.length > 0) {
      batches.push(currentBatch)
      currentBatch = []
      currentTokens = 0
    }
  }

  for (const item of items) {
    const tokens = options.estimateTokens(item)
    const hitBatchLength = currentBatch.length >= options.targetBatchLength
    const hitTokenBudget =
      options.maxBatchInputTokens !== undefined &&
      currentTokens + tokens > options.maxBatchInputTokens

    if (hitBatchLength || hitTokenBudget) {
      flush()
    }

    currentBatch.push(item)
    currentTokens += tokens
  }

  flush()
  return batches
}

const sanitizeChunkText = (text: string): string => text.trim()

export const chunkDocuments = (
  documents: ReadonlyArray<Document>,
  maxCharBuffer: number,
  tokenizer: TokenizerService
): Effect.Effect<ReadonlyArray<TextChunk>> =>
  Effect.sync(() => {
    const chunks: Array<TextChunk> = []

    for (const document of documents) {
      const tokenized = tokenizer.tokenize(document.text)
      const text = document.text

      for (let start = 0; start < text.length; start += maxCharBuffer) {
        const end = Math.min(text.length, start + maxCharBuffer)
        const chunkText = text.slice(start, end)

        chunks.push(
          new TextChunk({
            chunkText,
            sanitizedChunkText: sanitizeChunkText(chunkText),
            charInterval: new CharInterval({
              startPos: start,
              endPos: end
            }),
            tokenInterval: new TokenInterval({
              startIndex: 0,
              endIndex: tokenized.tokens.length
            }),
            ...(document.documentId !== undefined
              ? { documentId: document.documentId }
              : {}),
            ...(document.additionalContext !== undefined
              ? { additionalContext: document.additionalContext }
              : {})
          })
        )
      }
    }

    return chunks
  })
