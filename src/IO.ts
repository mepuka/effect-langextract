import * as FileSystem from "@effect/platform/FileSystem"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientResponse from "@effect/platform/HttpClientResponse"
import { Effect, Schema } from "effect"

import { IoError } from "./Errors.js"

const JsonString = Schema.parseJson()

const toIoError = (message: string) => (error: unknown): IoError =>
  error instanceof IoError
    ? error
    : new IoError({
        message: `${message}: ${String(error)}`
      })

const encodeJson = (value: unknown): Effect.Effect<string, IoError> =>
  Schema.encode(JsonString)(value).pipe(
    Effect.mapError(toIoError("Failed to encode JSON value"))
  )

export const isUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export const downloadText = (url: string): Effect.Effect<string, IoError, HttpClient.HttpClient> =>
  HttpClient.get(url).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.text),
    Effect.mapError(toIoError(`Failed to fetch URL: ${url}`))
  )

export const readTextFile = (
  path: string
): Effect.Effect<string, IoError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    return yield* fileSystem.readFileString(path)
  }).pipe(Effect.mapError(toIoError(`Failed to read file: ${path}`)))

export const writeTextFile = (
  path: string,
  content: string
): Effect.Effect<void, IoError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    yield* fileSystem.writeFileString(path, content)
  }).pipe(Effect.mapError(toIoError(`Failed to write file: ${path}`)))

export const writeJsonl = (
  path: string,
  rows: ReadonlyArray<unknown>
): Effect.Effect<void, IoError, FileSystem.FileSystem> =>
  Effect.forEach(rows, (row) => encodeJson(row)).pipe(
    Effect.flatMap((encodedRows) =>
      writeTextFile(path, `${encodedRows.join("\n")}\n`)
    )
  )
