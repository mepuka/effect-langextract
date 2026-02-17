import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as FileSystem from "@effect/platform/FileSystem"

import { Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"

import { executeVisualizeCommand } from "../../src/Cli.js"
import {
  AnnotatedDocument,
  CharInterval,
  Extraction
} from "../../src/Data.js"
import { encodeAnnotatedDocumentJson } from "../../src/DataLib.js"

const tempPath = (name: string): string =>
  `/tmp/effect-langextract-cli-visualize-${name}-${Date.now()}-${Math.random()}`

const withBunFileSystem = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem>
): Effect.Effect<A, E> =>
  effect.pipe(Effect.provide(BunFileSystem.layer))

const writeAnnotatedDocument = (path: string): Effect.Effect<void> =>
  withBunFileSystem(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const document = new AnnotatedDocument({
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
      const encoded = yield* encodeAnnotatedDocumentJson(document)
      yield* fileSystem.writeFileString(path, encoded)
    })
  )

const readTextFile = (path: string): Effect.Effect<string> =>
  withBunFileSystem(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      return yield* fileSystem.readFileString(path)
    })
  )

const removeFile = (path: string): Effect.Effect<void> =>
  withBunFileSystem(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      yield* fileSystem.remove(path, { force: true })
    })
  )

describe("CLI visualize command", () => {
  it.effect("writes HTML visualization from annotated document JSON", () =>
    Effect.gen(function* () {
      const inputPath = tempPath("annotated.json")
      const outputPath = tempPath("visualization.html")
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
