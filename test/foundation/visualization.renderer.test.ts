import { Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"

import {
  AnnotatedDocument,
  CharInterval,
  Extraction,
  Visualizer
} from "../../src/index.js"

const countMarks = (html: string): number =>
  [...html.matchAll(/<mark\b/g)].length

describe("Visualizer renderer", () => {
  it.effect("renders highlight marks for aligned extractions", () =>
    Effect.gen(function* () {
      const visualizer = yield* Visualizer
      const html = yield* visualizer.visualize(
        new AnnotatedDocument({
          text: "Alice visited Paris.",
          extractions: [
            new Extraction({
              extractionClass: "person",
              extractionText: "Alice",
              alignmentStatus: "match_exact",
              charInterval: new CharInterval({ startPos: 0, endPos: 5 })
            })
          ]
        })
      )

      expect(html).toContain("<mark")
      expect(html).toContain("person")
      expect(countMarks(html)).toBe(1)
    }).pipe(Effect.provide(Visualizer.Test))
  )

  it.effect("applies deterministic first-pass-wins for overlapping intervals", () =>
    Effect.gen(function* () {
      const visualizer = yield* Visualizer
      const html = yield* visualizer.visualize(
        new AnnotatedDocument({
          text: "Alice visited Paris.",
          extractions: [
            new Extraction({
              extractionClass: "person",
              extractionText: "Alice",
              alignmentStatus: "match_exact",
              charInterval: new CharInterval({ startPos: 0, endPos: 5 })
            }),
            new Extraction({
              extractionClass: "action",
              extractionText: "Alice visited",
              alignmentStatus: "match_exact",
              charInterval: new CharInterval({ startPos: 0, endPos: 13 })
            })
          ]
        })
      )

      expect(countMarks(html)).toBe(1)
      expect(html).toContain("person")
    }).pipe(Effect.provide(Visualizer.Test))
  )

  it.effect("can hide the legend", () =>
    Effect.gen(function* () {
      const visualizer = yield* Visualizer
      const html = yield* visualizer.visualize(
        new AnnotatedDocument({ text: "No extractions", extractions: [] }),
        { showLegend: false }
      )

      expect(html).not.toContain("<ul class=\"lx-legend\"")
    }).pipe(Effect.provide(Visualizer.Test))
  )
})
