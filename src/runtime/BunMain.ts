import * as BunContext from "@effect/platform-bun/BunContext"
import * as FetchHttpClient from "@effect/platform/FetchHttpClient"
import { Effect, Layer } from "effect"

import { runCli } from "../Cli.js"
import { makeBunKeyValueStoreLayer } from "./BunRuntime.js"

const resolveCacheDir = (
  argv: ReadonlyArray<string>,
  env: Readonly<Record<string, string | undefined>>
): string => {
  const index = argv.indexOf("--primed-cache-dir")
  if (index >= 0) {
    const value = argv[index + 1]
    if (value !== undefined && value.startsWith("--") === false) {
      return value
    }
  }
  return env.PRIMED_CACHE_DIR ?? ".cache/langextract/primed"
}

export const runCliMain = (argv: ReadonlyArray<string>): void => {
  const keyValueStoreLayer = makeBunKeyValueStoreLayer(
    resolveCacheDir(argv, process.env)
  )
  const runtimeLayer = Layer.mergeAll(
    BunContext.layer,
    FetchHttpClient.layer,
    keyValueStoreLayer
  )

  const program = runCli(argv, {
    env: process.env,
    primedCacheStoreLayer: keyValueStoreLayer
  }).pipe(Effect.provide(runtimeLayer))

  Effect.runPromise(program).catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : `CLI execution failed: ${String(error)}`
    )
    process.exitCode = 1
  })
}
