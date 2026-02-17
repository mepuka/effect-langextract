import * as BunContext from "@effect/platform-bun/BunContext"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as FetchHttpClient from "@effect/platform/FetchHttpClient"
import * as FileSystem from "@effect/platform/FileSystem"
import * as KeyValueStore from "@effect/platform/KeyValueStore"

import { Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "@effect/vitest"

import { runCli } from "../../src/Cli.js"
import {
  AnnotatedDocument,
  CharInterval,
  Extraction
} from "../../src/Data.js"
import { encodeAnnotatedDocumentJson } from "../../src/DataLib.js"
import { LanguageModel } from "../../src/LanguageModel.js"

const tempPath = (name: string): string =>
  `/tmp/effect-langextract-cli-subcommands-${name}-${Date.now()}-${Math.random()}`

const withBunFileSystem = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem>
): Effect.Effect<A, E> =>
  effect.pipe(Effect.provide(BunFileSystem.layer))

const writeExamplesFile = (path: string): Effect.Effect<void> =>
  withBunFileSystem(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const encoded = yield* Schema.encode(Schema.parseJson())([
        {
          text: "Alice visited Paris.",
          extractions: [
            {
              extractionClass: "snippet",
              extractionText: "Alice visited"
            }
          ]
        }
      ])
      yield* fileSystem.writeFileString(path, encoded)
    })
  )

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
            charInterval: new CharInterval({
              startPos: 0,
              endPos: 5
            })
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

const runtimeLayer = Layer.mergeAll(BunContext.layer, FetchHttpClient.layer)

const mockLanguageModelLayer = LanguageModel.testLayer({
  provider: "test-mock",
  defaultText:
    "[{\"extractionClass\":\"snippet\",\"extractionText\":\"Alice visited\"}]"
})

describe("Effect CLI subcommands", () => {
  it.effect("runs typed extract subcommand", () =>
    Effect.gen(function* () {
      const examplesPath = tempPath("examples.json")
      const outputPath = tempPath("output.json")
      yield* writeExamplesFile(examplesPath)

      yield* runCli(
        [
          "bun",
          "src/main.ts",
          "extract",
          "--text",
          "Alice visited Paris and Bob stayed in London.",
          "--prompt",
          "Extract travel snippets.",
          "--examples-file",
          examplesPath,
          "--provider",
          "anthropic",
          "--output",
          "json",
          "--output-path",
          outputPath
        ],
        {
          env: process.env,
          primedCacheStoreLayer: KeyValueStore.layerMemory,
          languageModelLayer: mockLanguageModelLayer,
          emitResultToStdout: false
        }
      ).pipe(Effect.provide(runtimeLayer))

      const content = yield* readTextFile(outputPath)
      const parsed = JSON.parse(content) as { extractions?: ReadonlyArray<unknown> }
      expect((parsed.extractions?.length ?? 0) > 0).toBe(true)

      yield* removeFile(examplesPath)
      yield* removeFile(outputPath)
    })
  )

  it.effect("runs typed visualize subcommand", () =>
    Effect.gen(function* () {
      const inputPath = tempPath("annotated.json")
      const outputPath = tempPath("output.html")
      yield* writeAnnotatedDocument(inputPath)

      yield* runCli(
        [
          "bun",
          "src/main.ts",
          "visualize",
          "--input",
          inputPath,
          "--output-path",
          outputPath,
          "--animation-speed",
          "0.5",
          "--show-legend",
          "true"
        ],
        {
          env: process.env,
          primedCacheStoreLayer: KeyValueStore.layerMemory,
          languageModelLayer: mockLanguageModelLayer,
          emitResultToStdout: false
        }
      ).pipe(Effect.provide(runtimeLayer))

      const html = yield* readTextFile(outputPath)
      expect(html).toContain("<mark")

      yield* removeFile(inputPath)
      yield* removeFile(outputPath)
    })
  )
})
