import * as BunContext from "@effect/platform-bun/BunContext"
import * as BunKeyValueStore from "@effect/platform-bun/BunKeyValueStore"
import * as FetchHttpClient from "@effect/platform/FetchHttpClient"
import * as HttpClient from "@effect/platform/HttpClient"
import * as FileSystem from "@effect/platform/FileSystem"
import * as KeyValueStore from "@effect/platform/KeyValueStore"
import { Layer } from "effect"

export const makeBunKeyValueStoreLayer = (
  cacheDir: string
): Layer.Layer<KeyValueStore.KeyValueStore> =>
  BunKeyValueStore.layerFileSystem(cacheDir).pipe(Layer.orDie)

export const makeBunRuntimeLayer = (
  cacheDir: string
): Layer.Layer<
  FileSystem.FileSystem | HttpClient.HttpClient | KeyValueStore.KeyValueStore
> =>
  Layer.mergeAll(
    BunContext.layer,
    FetchHttpClient.layer,
    makeBunKeyValueStoreLayer(cacheDir)
  )
