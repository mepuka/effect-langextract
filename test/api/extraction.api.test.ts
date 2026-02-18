import * as BunContext from "@effect/platform-bun/BunContext"
import * as FetchHttpClient from "@effect/platform/FetchHttpClient"
import * as FileSystem from "@effect/platform/FileSystem"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientResponse from "@effect/platform/HttpClientResponse"
import * as KeyValueStore from "@effect/platform/KeyValueStore"

import { Chunk, Effect, Layer, Stream } from "effect"
import { describe, expect, it } from "@effect/vitest"

import { DocumentIdGenerator, ExampleData } from "../../src/Data.js"
import { Ingestion } from "../../src/Ingestion.js"
import { LanguageModel } from "../../src/LanguageModel.js"
import { PrimedCachePolicy } from "../../src/PrimedCache.js"
import { extract, extractStream } from "../../src/api/Extraction.js"
import {
  makeExtractionExecutionLayer
} from "../../src/api/ExecutionLayer.js"
import {
  DocumentMappingSpec,
  FieldSelector,
  IngestionRequest,
  IngestionSourceFile,
  IngestionSourceText,
  IngestionSourceUrl
} from "../../src/ingestion/Models.js"
import { removeFile, tempPath } from "../helpers/cli.js"

const mockLanguageModelLayer = LanguageModel.testLayer({
  provider: "test-mock",
  defaultText:
    '[{"extractionClass":"snippet","extractionText":"Alice visited"}]'
})

const writeFile = (
  path: string,
  content: string
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    yield* fileSystem.writeFileString(path, content)
  }).pipe(Effect.orDie)

const makeExtractionLayer = () =>
  makeExtractionExecutionLayer(
    {
      provider: "openai",
      modelId: "gpt-4o-mini",
      apiKey: "",
      providerConcurrency: 8,
      primedCacheNamespace: "test"
    },
    {
      languageModelLayer: mockLanguageModelLayer,
      primedCacheStoreLayer: KeyValueStore.layerMemory
    }
  )

const runtimeLayer = Layer.mergeAll(BunContext.layer, FetchHttpClient.layer)

const mockUrlHttpClientLayer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request, url) => {
    if (url.pathname === "/input.txt") {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response("Alice visited Paris from URL input.", {
            status: 200,
            headers: {
              "content-type": "text/plain; charset=utf-8"
            }
          })
        )
      )
    }

    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response("Not found", { status: 404 })
      )
    )
  })
)

const appLayer = Layer.mergeAll(
  runtimeLayer,
  Ingestion.Default,
  DocumentIdGenerator.Default,
  makeExtractionLayer()
)

const urlAppLayer = Layer.mergeAll(
  BunContext.layer,
  mockUrlHttpClientLayer,
  Ingestion.Default,
  DocumentIdGenerator.Default,
  makeExtractionLayer()
)

const examples = [
  new ExampleData({
    text: "Alice visited Paris.",
    extractions: []
  })
]

describe("Extraction API", () => {
  it.effect("extracts from raw text ingestion", () =>
    extract({
      ingestion: new IngestionRequest({
        source: new IngestionSourceText({
          _tag: "text",
          text: "Alice visited Paris and Bob stayed in London."
        }),
        format: "text"
      }),
      prompt: {
        description: "Extract snippets.",
        examples
      },
      annotate: {
        maxCharBuffer: 1000,
        batchLength: 10,
        batchConcurrency: 1,
        providerConcurrency: 8,
        extractionPasses: 1
      },
      cachePolicy: new PrimedCachePolicy({
        enabled: false,
        namespace: "test"
      })
    }).pipe(
      Effect.provide(appLayer),
      Effect.tap((documents) =>
        Effect.sync(() => {
          expect(documents).toHaveLength(1)
          expect((documents[0]?.extractions.length ?? 0) > 0).toBe(true)
        })
      ),
      Effect.asVoid
    )
  )

  it.effect("extracts streamed documents from JSONL file mapping", () =>
    Effect.gen(function* () {
      const inputPath = tempPath("api-extract", "rows.jsonl")
      yield* writeFile(
        inputPath,
        [
          '{"post_id":"evt-1","body":"First row"}',
          '{"post_id":"evt-2","body":"Second row"}'
        ].join("\n")
      ).pipe(Effect.provide(runtimeLayer))

      const documents = yield* extractStream({
        ingestion: new IngestionRequest({
          source: new IngestionSourceFile({ _tag: "file", path: inputPath }),
          format: "jsonl",
          mapping: new DocumentMappingSpec({
            text: new FieldSelector({ path: "body", required: true, trim: true }),
            documentId: new FieldSelector({
              path: "post_id",
              required: false,
              trim: true
            })
          })
        }),
        prompt: {
          description: "Extract snippets.",
          examples
        },
        annotate: {
          maxCharBuffer: 1000,
          batchLength: 10,
          batchConcurrency: 1,
          providerConcurrency: 8,
          extractionPasses: 1,
          documentBatchSize: 1
        },
        cachePolicy: new PrimedCachePolicy({
          enabled: false,
          namespace: "test"
        })
      }).pipe(
        Stream.runCollect,
        Effect.map((values) => Chunk.toReadonlyArray(values)),
        Effect.provide(appLayer)
      )

      expect(documents).toHaveLength(2)
      expect(documents[0]?.documentId).toBe("evt-1")
      expect(documents[1]?.documentId).toBe("evt-2")

      yield* removeFile(inputPath)
    })
  )

  it.effect("extracts from URL ingestion", () =>
    extract({
      ingestion: new IngestionRequest({
        source: new IngestionSourceUrl({
          _tag: "url",
          url: "https://fixtures.local/input.txt"
        }),
        format: "text"
      }),
      prompt: {
        description: "Extract snippets.",
        examples
      },
      annotate: {
        maxCharBuffer: 1000,
        batchLength: 10,
        batchConcurrency: 1,
        providerConcurrency: 8,
        extractionPasses: 1
      },
      cachePolicy: new PrimedCachePolicy({
        enabled: false,
        namespace: "test"
      })
    }).pipe(
      Effect.provide(urlAppLayer),
      Effect.tap((documents) =>
        Effect.sync(() => {
          expect(documents).toHaveLength(1)
          expect((documents[0]?.extractions.length ?? 0) > 0).toBe(true)
        })
      ),
      Effect.asVoid
    )
  )
})
