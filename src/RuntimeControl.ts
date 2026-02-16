import { Effect, Layer } from "effect"

export interface RuntimeControlService {
  readonly acquireProviderPermit: (provider: string) => Effect.Effect<void>
  readonly releaseProviderPermit: (provider: string) => Effect.Effect<void>
}

const makeNoopRuntimeControl = (): RuntimeControlService => ({
  acquireProviderPermit: (_provider) => Effect.void,
  releaseProviderPermit: (_provider) => Effect.void
})

export class RuntimeControl extends Effect.Service<RuntimeControl>()(
  "@effect-langextract/RuntimeControl",
  {
    sync: makeNoopRuntimeControl
  }
) {}

export const RuntimeControlLive: Layer.Layer<RuntimeControl> = RuntimeControl.Default

export const RuntimeControlTest: Layer.Layer<RuntimeControl> = RuntimeControl.Default
