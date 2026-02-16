import { Effect } from "effect"

import { IoError } from "./Errors.js"

const toIoError = (message: string) => (error: unknown): IoError =>
  error instanceof IoError
    ? error
    : new IoError({
        message: `${message}: ${String(error)}`
      })

export const isUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export const downloadText = (url: string): Effect.Effect<string, IoError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url)
      if (!response.ok) {
        throw new IoError({
          message: `Failed to fetch URL (${response.status}): ${url}`
        })
      }
      return response.text()
    },
    catch: toIoError(`Failed to fetch URL: ${url}`)
  })

export const readTextFile = (path: string): Effect.Effect<string, IoError> =>
  Effect.tryPromise({
    try: () => Bun.file(path).text(),
    catch: toIoError(`Failed to read file: ${path}`)
  })

export const writeTextFile = (
  path: string,
  content: string
): Effect.Effect<void, IoError> =>
  Effect.tryPromise({
    try: async () => {
      await Bun.write(path, content)
    },
    catch: toIoError(`Failed to write file: ${path}`)
  })

export const writeJsonl = (
  path: string,
  rows: ReadonlyArray<unknown>
): Effect.Effect<void, IoError> =>
  writeTextFile(
    path,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n"
  )
