import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as FileSystem from "@effect/platform/FileSystem"

import { Effect, Schema } from "effect"
import { describe, expect, it } from "@effect/vitest"

import { executeExtractCommand } from "../../src/Cli.js"
import { LanguageModel } from "../../src/LanguageModel.js"

const tempPath = (name: string): string =>
  `/tmp/effect-langextract-cli-${name}-${Date.now()}-${Math.random()}`

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

const mockLanguageModelLayer = LanguageModel.testLayer({
  provider: "test-mock",
  defaultText:
    "[{\"extractionClass\":\"snippet\",\"extractionText\":\"Alice visited\"}]"
})

describe("CLI extract command", () => {
  it.effect("writes JSON output using anthropic provider layer", () =>
    Effect.gen(function* () {
      const examplesPath = tempPath("examples.json")
      const outputPath = tempPath("output.json")
      yield* writeExamplesFile(examplesPath)

      yield* executeExtractCommand({
        text: "Alice visited Paris and Bob stayed in London.",
        prompt: "Extract travel snippets.",
        examplesFile: examplesPath,
        provider: "anthropic",
        output: "json",
        outputPath,
        maxCharBuffer: 1000,
        batchLength: 10,
        batchConcurrency: 1,
        providerConcurrency: 8,
        extractionPasses: 1,
        primedCacheEnabled: true,
        primedCacheNamespace: "cli-test",
        primedCacheTtlSeconds: 60,
        primedCacheDeterministicOnly: true,
        clearPrimedCacheOnStart: true,
        languageModelLayer: mockLanguageModelLayer
      }).pipe(Effect.provide(BunFileSystem.layer))

      const content = yield* readTextFile(outputPath)

      const parsed = JSON.parse(content) as { extractions?: ReadonlyArray<unknown> }
      expect((parsed.extractions?.length ?? 0) > 0).toBe(true)

      yield* removeFile(examplesPath)
      yield* removeFile(outputPath)
    })
  )

  it.effect("fails when no input source is provided", () =>
    executeExtractCommand({
      prompt: "Extract entities.",
      provider: "gemini",
      output: "json",
      maxCharBuffer: 1000,
      batchLength: 10,
      batchConcurrency: 1,
      providerConcurrency: 8,
      extractionPasses: 1,
      primedCacheEnabled: false,
      primedCacheNamespace: "cli-test",
      primedCacheTtlSeconds: 60,
      primedCacheDeterministicOnly: true,
      clearPrimedCacheOnStart: false,
      languageModelLayer: mockLanguageModelLayer
    }).pipe(
      Effect.provide(BunFileSystem.layer),
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => {
          expect(error.message).toContain("Provide one input source")
        })
      ),
      Effect.asVoid
    )
  )
})
