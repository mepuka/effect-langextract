import { Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"

import {
  AlignmentPolicy,
  PromptValidator,
  ValidationIssue,
  ValidationReport
} from "../../src/PromptValidation.js"
import { ExampleData, Extraction } from "../../src/index.js"

describe("PromptValidator", () => {
  it.effect("returns no issues for exact aligned examples", () =>
    Effect.gen(function* () {
      const validator = yield* PromptValidator
      const report = yield* validator.validatePromptAlignment([
        new ExampleData({
          text: "Alice visited Paris.",
          extractions: [
            new Extraction({
              extractionClass: "person",
              extractionText: "Alice"
            })
          ]
        })
      ])

      expect(report.issues.length).toBe(0)
    }).pipe(Effect.provide(PromptValidator.Default))
  )

  it.effect("emits non-exact issues for fuzzy matches", () =>
    Effect.gen(function* () {
      const validator = yield* PromptValidator
      const report = yield* validator.validatePromptAlignment(
        [
          new ExampleData({
            text: "Alice visited Paris.",
            extractions: [
              new Extraction({
                extractionClass: "snippet",
                extractionText: "Alice visited Paris today"
              })
            ]
          })
        ],
        new AlignmentPolicy({
          fuzzyAlignmentThreshold: 0.7,
          acceptMatchLesser: true,
          enableFuzzyAlignment: true
        })
      )

      expect(report.issues.length).toBeGreaterThan(0)
      expect(report.issues[0]?.issueKind).toBe("non_exact")
    }).pipe(Effect.provide(PromptValidator.Default))
  )

  it.effect("emits failed issues when extraction text is not alignable", () =>
    Effect.gen(function* () {
      const validator = yield* PromptValidator
      const report = yield* validator.validatePromptAlignment([
        new ExampleData({
          text: "Alice visited Paris.",
          extractions: [
            new Extraction({
              extractionClass: "snippet",
              extractionText: "Completely unrelated extraction value"
            })
          ]
        })
      ])

      expect(report.issues.length).toBe(1)
      expect(report.issues[0]?.issueKind).toBe("failed")
    }).pipe(Effect.provide(PromptValidator.Default))
  )

  it.effect("fails strict non-exact handling when configured", () =>
    Effect.gen(function* () {
      const validator = yield* PromptValidator
      const report = new ValidationReport({
        issues: [
          new ValidationIssue({
            exampleIndex: 0,
            extractionClass: "snippet",
            extractionTextPreview: "Alice visited Paris today",
            issueKind: "non_exact",
            alignmentStatus: "match_lesser"
          })
        ]
      })

      yield* validator.handleAlignmentReport(report, "error", {
        strictNonExact: true
      }).pipe(
        Effect.flip,
        Effect.tap((error) =>
          Effect.sync(() => {
            expect(error.message).toContain("strict mode")
          })
        ),
        Effect.asVoid
      )
    }).pipe(Effect.provide(PromptValidator.Default))
  )
})
