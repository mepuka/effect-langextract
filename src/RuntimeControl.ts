import { Effect, Layer } from "effect"

export interface RuntimeControlService {
  readonly acquireProviderPermit: (provider: string) => Effect.Effect<void>
  readonly releaseProviderPermit: (provider: string) => Effect.Effect<void>
}

const makeNoopRuntimeControl = (): RuntimeControlService => ({
  acquireProviderPermit: (_provider) => Effect.void,
  releaseProviderPermit: (_provider) => Effect.void
})

const makePermitRuntimeControl = (
  maxConcurrency: number
): Effect.Effect<RuntimeControlService> =>
  Effect.gen(function* () {
    const semaphore = yield* Effect.makeSemaphore(Math.max(1, maxConcurrency))
    return {
      acquireProviderPermit: (_provider) => semaphore.take(1).pipe(Effect.asVoid),
      releaseProviderPermit: (_provider) =>
        semaphore.release(1).pipe(Effect.asVoid)
    } satisfies RuntimeControlService
  })

export class RuntimeControl extends Effect.Service<RuntimeControl>()(
  "@effect-langextract/RuntimeControl",
  {
    sync: makeNoopRuntimeControl
  }
) {
  static readonly Test: Layer.Layer<RuntimeControl> = RuntimeControl.Default

  static testLayer = (
    service?: RuntimeControlService
  ): Layer.Layer<RuntimeControl> =>
    Layer.succeed(
      RuntimeControl,
      RuntimeControl.make(service ?? makeNoopRuntimeControl())
    )
}

export const RuntimeControlLive: Layer.Layer<RuntimeControl> = RuntimeControl.Default

export const RuntimeControlTest: Layer.Layer<RuntimeControl> = RuntimeControl.Test

export const makeRuntimeControlPermitLayer = (
  maxConcurrency: number
): Layer.Layer<RuntimeControl> =>
  Layer.effect(
    RuntimeControl,
    makePermitRuntimeControl(maxConcurrency).pipe(
      Effect.map((service) => RuntimeControl.make(service))
    )
  )
