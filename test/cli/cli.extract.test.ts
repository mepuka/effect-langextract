import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"

import { Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"

import { executeExtractCommand } from "../../src/Cli.js"
import { LanguageModel } from "../../src/LanguageModel.js"
import {
  readTextFile,
  removeFile,
  tempPath,
  writeExamplesFile
} from "../helpers/cli.js"

const mockLanguageModelLayer = LanguageModel.testLayer({
  provider: "test-mock",
  defaultText:
    "[{\"extractionClass\":\"snippet\",\"extractionText\":\"Alice visited\"}]"
})

describe("CLI extract command", () => {
  it.effect("writes JSON output using anthropic provider layer", () =>
    Effect.gen(function* () {
      const examplesPath = tempPath("cli", "examples.json")
      const outputPath = tempPath("cli", "output.json")
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
