import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"

import { Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"

import { executeVisualizeCommand } from "../../src/Cli.js"
import {
  readTextFile,
  removeFile,
  tempPath,
  writeAnnotatedDocument
} from "../helpers/cli.js"

describe("CLI visualize command", () => {
  it.effect("writes HTML visualization from annotated document JSON", () =>
    Effect.gen(function* () {
      const inputPath = tempPath("cli-visualize", "annotated.json")
      const outputPath = tempPath("cli-visualize", "visualization.html")
      yield* writeAnnotatedDocument(inputPath)

      yield* executeVisualizeCommand({
        input: inputPath,
        outputPath,
        animationSpeed: 0.5,
        showLegend: true
      }).pipe(Effect.provide(BunFileSystem.layer))

      const html = yield* readTextFile(outputPath)
      expect(html).toContain("<mark")
      expect(html).toContain("person")

      yield* removeFile(inputPath)
      yield* removeFile(outputPath)
    })
  )
})
