import { Effect, Layer, Schema } from "effect"

import { CharInterval } from "./Data.js"

export const FUZZY_ALIGNMENT_MIN_THRESHOLD = 0.75

export const TokenType = Schema.Literal("word", "number", "punctuation")
export type TokenType = typeof TokenType.Type

export class TokenInterval extends Schema.Class<TokenInterval>("TokenInterval")({
  startIndex: Schema.optionalWith(Schema.Int, { default: () => 0 }),
  endIndex: Schema.optionalWith(Schema.Int, { default: () => 0 })
}) {}

export class Token extends Schema.Class<Token>("Token")({
  index: Schema.Int,
  tokenType: TokenType,
  text: Schema.String,
  charInterval: CharInterval,
  firstTokenAfterNewline: Schema.optionalWith(Schema.Boolean, {
    default: () => false
  })
}) {}

export class TokenizedText extends Schema.Class<TokenizedText>("TokenizedText")({
  text: Schema.String,
  tokens: Schema.optionalWith(Schema.Array(Token), {
    default: () => [] as const
  })
}) {}

export interface TokenizerService {
  readonly tokenize: (text: string) => TokenizedText
  readonly tokensText: (tokenizedText: TokenizedText, interval: TokenInterval) => string
  readonly findSentenceRange: (
    text: string,
    tokens: ReadonlyArray<Token>,
    startTokenIndex: number
  ) => TokenInterval
}

const tokenTypeFromText = (value: string): TokenType => {
  if (/^[0-9]+$/.test(value)) {
    return "number"
  }
  if (/^[\p{L}\p{M}_-]+$/u.test(value)) {
    return "word"
  }
  return "punctuation"
}

const regexTokenize = (text: string): TokenizedText => {
  const matcher = /\S+/g
  const tokens: Array<Token> = []
  let match: RegExpExecArray | null = matcher.exec(text)

  while (match !== null) {
    const value = match[0]
    const startPos = match.index
    const endPos = startPos + value.length
    const before = text.slice(0, startPos)

    tokens.push(
      new Token({
        index: tokens.length,
        tokenType: tokenTypeFromText(value),
        text: value,
        charInterval: new CharInterval({
          startPos,
          endPos
        }),
        firstTokenAfterNewline: before.endsWith("\n")
      })
    )

    match = matcher.exec(text)
  }

  return new TokenizedText({ text, tokens })
}

const tokensTextImpl = (tokenizedText: TokenizedText, interval: TokenInterval): string => {
  const boundedStart = Math.max(0, interval.startIndex)
  const boundedEnd = Math.max(boundedStart, interval.endIndex)
  return tokenizedText.tokens
    .slice(boundedStart, boundedEnd)
    .map((token: Token) => token.text)
    .join(" ")
}

const findSentenceRangeImpl = (
  _text: string,
  tokens: ReadonlyArray<Token>,
  startTokenIndex: number
): TokenInterval => {
  if (tokens.length === 0) {
    return new TokenInterval({ startIndex: 0, endIndex: 0 })
  }

  let endIndex = Math.max(0, startTokenIndex)
  while (endIndex < tokens.length) {
    const tokenText = tokens[endIndex]?.text ?? ""
    endIndex += 1
    if (/[.!?]$/.test(tokenText)) {
      break
    }
  }

  return new TokenInterval({
    startIndex: Math.max(0, startTokenIndex),
    endIndex: Math.max(0, endIndex)
  })
}

export class Tokenizer extends Effect.Service<Tokenizer>()(
  "@effect-langextract/Tokenizer",
  {
    sync: () => ({
      tokenize: regexTokenize,
      tokensText: tokensTextImpl,
      findSentenceRange: findSentenceRangeImpl
    } satisfies TokenizerService)
  }
) {}

export const RegexTokenizerLive: Layer.Layer<Tokenizer> = Tokenizer.Default

export const UnicodeTokenizerLive: Layer.Layer<Tokenizer> =
  Layer.succeed(
    Tokenizer,
    Tokenizer.make({
      tokenize: regexTokenize,
      tokensText: tokensTextImpl,
      findSentenceRange: findSentenceRangeImpl
    } satisfies TokenizerService)
  )

export const TokenizerTest: Layer.Layer<Tokenizer> = Tokenizer.Default
