import * as BunWorker from "@effect/platform-bun/BunWorker"
import * as Worker from "@effect/platform/Worker"
import { Context, Effect, Layer } from "effect"

import {
  AlignmentExecutor,
  type AlignChunkOptions
} from "../AlignmentExecutor.js"
import { AlignmentError } from "../Errors.js"
import { type Extraction } from "../Data.js"
import {
  AlignChunkRequest,
  type AlignmentWorkerMessage
} from "./workers/AlignmentWorkerProtocol.js"

interface AlignmentWorkerPoolTag {
  readonly _: unique symbol
}

const AlignmentWorkerPool = Context.GenericTag<
  AlignmentWorkerPoolTag,
  Worker.SerializedWorkerPool<AlignmentWorkerMessage>
>("@effect-langextract/runtime/AlignmentWorkerPool")

const clampPoolSize = (value: number): number =>
  Math.max(1, Math.min(16, Math.trunc(value)))

const hasWorkerConstructor = (): boolean =>
  typeof globalThis.Worker === "function"

const toAlignmentError = (error: unknown): AlignmentError => {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { readonly message: unknown }).message === "string"
  ) {
    return new AlignmentError({
      message: (error as { readonly message: string }).message
    })
  }

  return new AlignmentError({
    message: `Worker alignment failed: ${String(error)}`
  })
}

const makeAlignmentWorkerPoolLayer = (poolSize: number) =>
  Worker.makePoolSerializedLayer(AlignmentWorkerPool, {
    size: clampPoolSize(poolSize)
  }).pipe(
    Layer.provide(
      BunWorker.layer(
        () =>
          new globalThis.Worker(
            new URL("./workers/AlignmentWorkerMain.ts", import.meta.url).href
          )
      )
    )
  )

export const makeBunAlignmentExecutorLayer = (options?: {
  readonly poolSize?: number | undefined
}): Layer.Layer<AlignmentExecutor> => {
  if (!hasWorkerConstructor()) {
    return Layer.succeed(
      AlignmentExecutor,
      AlignmentExecutor.make({
        alignChunk: () =>
          Effect.fail(
            new AlignmentError({
              message: "Bun worker runtime is unavailable in this environment."
            })
          )
      } as any)
    )
  }

  const poolLayer = makeAlignmentWorkerPoolLayer(options?.poolSize ?? 1)

  return Layer.provide(
    Layer.effect(
      AlignmentExecutor,
      Effect.gen(function* () {
        const pool = yield* AlignmentWorkerPool

        return AlignmentExecutor.make({
          alignChunk: (
            extractions: ReadonlyArray<Extraction>,
            sourceText: string,
            tokenOffset: number,
            charOffset: number,
            alignOptions?: AlignChunkOptions
          ) =>
            pool
              .executeEffect(
                new AlignChunkRequest({
                  extractions,
                  sourceText,
                  tokenOffset,
                  charOffset,
                  ...(alignOptions?.enableFuzzyAlignment !== undefined
                    ? {
                        enableFuzzyAlignment: alignOptions.enableFuzzyAlignment
                      }
                    : {}),
                  ...(alignOptions?.fuzzyAlignmentThreshold !== undefined
                    ? {
                        fuzzyAlignmentThreshold:
                          alignOptions.fuzzyAlignmentThreshold
                      }
                    : {}),
                  ...(alignOptions?.acceptMatchLesser !== undefined
                    ? {
                        acceptMatchLesser: alignOptions.acceptMatchLesser
                      }
                    : {})
                })
              )
              .pipe(Effect.mapError(toAlignmentError))
        } as any)
      })
    ),
    poolLayer
  ).pipe(Layer.orDie)
}
