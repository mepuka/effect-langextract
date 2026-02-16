import { Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"

import {
  PrimedCache,
  PrimedCacheTest,
  PrimedCacheKey,
  ScoredOutput,
  TokenInterval,
  Tokenizer
} from "../../src/index.js"

describe("Service contracts", () => {
  it.effect("Tokenizer exposes tokenize/tokensText/findSentenceRange", () =>
    Effect.gen(function* () {
      const tokenizer = yield* Tokenizer
      const tokenized = tokenizer.tokenize("One two. Three four")
      const sentence = tokenizer.findSentenceRange(
        tokenized.text,
        tokenized.tokens,
        0
      )

      expect(typeof tokenizer.tokenize).toBe("function")
      expect(typeof tokenizer.tokensText).toBe("function")
      expect(typeof tokenizer.findSentenceRange).toBe("function")
      expect(sentence.startIndex).toBe(0)
      expect(sentence.endIndex).toBeGreaterThan(0)
      expect(
        tokenizer.tokensText(
          tokenized,
          new TokenInterval({ startIndex: 0, endIndex: 2 })
        )
      ).toContain("One")
    }).pipe(Effect.provide(Tokenizer.Default))
  )

  it.effect("PrimedCache supports put/get/invalidate", () =>
    Effect.gen(function* () {
      const cache = yield* PrimedCache
      const key = new PrimedCacheKey({
        provider: "test",
        modelId: "test-model",
        promptFingerprint: "fp-1",
        promptVersion: "langextract"
      })

      yield* cache.put(key, [new ScoredOutput({ output: "ok", score: 1 })])
      const beforeDelete = yield* cache.get(key)
      yield* cache.invalidate(key)
      const afterDelete = yield* cache.get(key)

      expect(beforeDelete?.[0]?.output).toBe("ok")
      expect(afterDelete).toBeUndefined()
    }).pipe(Effect.provide(PrimedCacheTest))
  )
})
