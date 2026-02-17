import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"

import {
  Extraction,
  FormatHandler,
  FormatHandlerConfig,
  Resolver,
  Tokenizer
} from "../../src/index.js"

const resolverLayer = Layer.provide(Resolver.DefaultWithoutDependencies, [
  Tokenizer.Default,
  FormatHandler.testLayer(
    new FormatHandlerConfig({
      formatType: "json",
      useFences: false,
      strictFences: false,
      useWrapper: true,
      allowTopLevelList: true
    })
  )
])

describe("Resolver parity hardening", () => {
  it.effect("orders indexed extraction maps by *_index values", () =>
    Effect.gen(function* () {
      const resolver = yield* Resolver
      const parsed = yield* resolver.resolve(
        `[{
          "patient": "John Doe",
          "patient_index": 2,
          "condition": "hypertension",
          "condition_index": 1
        }]`
      )

      expect(parsed.length).toBe(2)
      expect(parsed[0]?.extractionClass).toBe("condition")
      expect(parsed[0]?.extractionText).toBe("hypertension")
      expect(parsed[0]?.extractionIndex).toBe(1)
      expect(parsed[1]?.extractionClass).toBe("patient")
      expect(parsed[1]?.extractionText).toBe("John Doe")
      expect(parsed[1]?.extractionIndex).toBe(2)
    }).pipe(Effect.provide(resolverLayer))
  )

  it.effect("supports direct extractionClass/extractionText records", () =>
    Effect.gen(function* () {
      const resolver = yield* Resolver
      const parsed = yield* resolver.resolve(
        `[{"extractionClass":"medication","extractionText":"Naprosyn"}]`
      )

      expect(parsed).toHaveLength(1)
      expect(parsed[0]?.extractionClass).toBe("medication")
      expect(parsed[0]?.extractionText).toBe("Naprosyn")
    }).pipe(Effect.provide(resolverLayer))
  )

  it.effect("keeps SequenceMatcher-style ordering behavior for interleaved extractions", () =>
    Effect.gen(function* () {
      const resolver = yield* Resolver
      const aligned = yield* resolver.align(
        [
          new Extraction({
            extractionClass: "medication",
            extractionText: "Naprosyn"
          }),
          new Extraction({
            extractionClass: "condition",
            extractionText: "arthritis"
          })
        ],
        "Patient with arthritis is prescribed Naprosyn.",
        0,
        0
      )

      expect(aligned[0]?.alignmentStatus).toBeUndefined()
      expect(aligned[0]?.charInterval).toBeUndefined()
      expect(aligned[1]?.alignmentStatus).toBe("match_exact")
      expect(aligned[1]?.charInterval?.startPos).toBe(13)
      expect(aligned[1]?.charInterval?.endPos).toBe(22)
    }).pipe(Effect.provide(resolverLayer))
  )

  it.effect("does not align strict substrings that are not token-exact", () =>
    Effect.gen(function* () {
      const resolver = yield* Resolver
      const aligned = yield* resolver.align(
        [
          new Extraction({
            extractionClass: "medication",
            extractionText: "Napro"
          })
        ],
        "Patient is prescribed Naprosyn and prednisone for treatment.",
        0,
        0,
        {
          enableFuzzyAlignment: false
        }
      )

      expect(aligned[0]?.alignmentStatus).toBeUndefined()
      expect(aligned[0]?.charInterval).toBeUndefined()
    }).pipe(Effect.provide(resolverLayer))
  )

  it.effect("emits match_lesser for partial exact matches and can suppress it", () =>
    Effect.gen(function* () {
      const resolver = yield* Resolver

      const partial = yield* resolver.align(
        [
          new Extraction({
            extractionClass: "condition",
            extractionText: "high blood pressure"
          })
        ],
        "Patient is prescribed high glucose.",
        0,
        0,
        {
          enableFuzzyAlignment: false,
          acceptMatchLesser: true
        }
      )

      expect(partial[0]?.alignmentStatus).toBe("match_lesser")
      expect(partial[0]?.charInterval?.startPos).toBe(22)
      expect(partial[0]?.charInterval?.endPos).toBe(26)

      const suppressed = yield* resolver.align(
        [
          new Extraction({
            extractionClass: "condition",
            extractionText: "high blood pressure"
          })
        ],
        "Patient is prescribed high glucose.",
        0,
        0,
        {
          enableFuzzyAlignment: false,
          acceptMatchLesser: false
        }
      )

      expect(suppressed[0]?.alignmentStatus).toBeUndefined()
      expect(suppressed[0]?.charInterval).toBeUndefined()
    }).pipe(Effect.provide(resolverLayer))
  )

  it.effect("falls back to fuzzy alignment for near matches", () =>
    Effect.gen(function* () {
      const resolver = yield* Resolver
      const source = "Patient is prescribed Naprosyn and prednisone daily."

      const aligned = yield* resolver.align(
        [
          new Extraction({
            extractionClass: "medication",
            extractionText: "naprosins and prednisone daily"
          })
        ],
        source,
        0,
        0,
        {
          enableFuzzyAlignment: true,
          fuzzyAlignmentThreshold: 0.5
        }
      )

      expect(aligned[0]?.alignmentStatus).toBe("match_fuzzy")
      const startPos = aligned[0]?.charInterval?.startPos
      const endPos = aligned[0]?.charInterval?.endPos
      expect(startPos).toBeDefined()
      expect(endPos).toBeDefined()

      const extracted = source.slice(startPos ?? 0, endPos ?? 0)
      expect(extracted.toLowerCase()).toContain("prednisone")
    }).pipe(Effect.provide(resolverLayer))
  )
})
