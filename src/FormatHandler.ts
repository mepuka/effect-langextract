import { Effect, Layer, Schema } from "effect"

import { EXTRACTIONS_KEY } from "./Data.js"
import { Extraction } from "./Data.js"
import { FormatParseError } from "./Errors.js"
import { FormatType } from "./FormatType.js"

export class FormatHandlerConfig extends Schema.Class<FormatHandlerConfig>("FormatHandlerConfig")({
  formatType: Schema.optionalWith(FormatType, {
    default: () => "json" as const
  }),
  useWrapper: Schema.optionalWith(Schema.Boolean, { default: () => true }),
  wrapperKey: Schema.optionalWith(Schema.String, { exact: true }),
  useFences: Schema.optionalWith(Schema.Boolean, { default: () => true }),
  attributeSuffix: Schema.optionalWith(Schema.String, {
    default: () => "_attributes"
  }),
  strictFences: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  allowTopLevelList: Schema.optionalWith(Schema.Boolean, {
    default: () => true
  })
}) {}

export interface FormatHandlerService {
  readonly formatExtractionExample: (extractions: ReadonlyArray<Extraction>) => string
  readonly parseOutput: (
    text: string,
    options?: { strict?: boolean }
  ) => Effect.Effect<ReadonlyArray<Record<string, unknown>>, FormatParseError>
  readonly config: FormatHandlerConfig
}

const JsonString = Schema.parseJson()

const stripCodeFences = (text: string): string =>
  text
    .replace(/^```(?:json|yaml)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()

const extractJsonCandidate = (text: string): string => {
  const trimmed = stripCodeFences(text)
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed
  }

  const arrayStart = trimmed.indexOf("[")
  const arrayEnd = trimmed.lastIndexOf("]")
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return trimmed.slice(arrayStart, arrayEnd + 1)
  }

  const objectStart = trimmed.indexOf("{")
  const objectEnd = trimmed.lastIndexOf("}")
  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1)
  }

  return trimmed
}

const normalizeRecords = (
  parsed: unknown,
  config: FormatHandlerConfig
): ReadonlyArray<Record<string, unknown>> => {
  if (Array.isArray(parsed)) {
    return parsed.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null
    )
  }

  if (typeof parsed === "object" && parsed !== null) {
    const asRecord = parsed as Record<string, unknown>
    const wrapperKey = config.wrapperKey ?? EXTRACTIONS_KEY
    if (config.useWrapper && Array.isArray(asRecord[wrapperKey])) {
      return asRecord[wrapperKey].filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null
      )
    }
    return [asRecord]
  }

  return []
}

const parseJsonOutput = (
  text: string,
  config: FormatHandlerConfig
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, FormatParseError> => {
  const normalized = config.useFences ? extractJsonCandidate(text) : text.trim()

  return Schema.decodeUnknown(JsonString)(normalized).pipe(
    Effect.map((parsed) => normalizeRecords(parsed, config)),
    Effect.mapError(
      (error) =>
        new FormatParseError({
          message: `Failed to parse model output (${config.formatType}): ${String(error)}`
        })
    )
  )
}

const parseOutputImpl = (
  text: string,
  config: FormatHandlerConfig,
  options?: { strict?: boolean }
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, FormatParseError> =>
  parseJsonOutput(text, config).pipe(
    Effect.catchAll((error) =>
      options?.strict ?? config.strictFences
        ? Effect.fail(error)
        : Effect.succeed([] as const)
    )
  )

const encodeExtractionExample = (extractions: ReadonlyArray<Extraction>): string => {
  try {
    return Schema.encodeSync(JsonString)(extractions)
  } catch {
    return "[]"
  }
}

export const makeFormatHandler = (config: FormatHandlerConfig): FormatHandlerService => ({
  config,
  formatExtractionExample: encodeExtractionExample,
  parseOutput: (text, options) => parseOutputImpl(text, config, options)
})

export class FormatHandler extends Effect.Service<FormatHandler>()(
  "@effect-langextract/FormatHandler",
  {
    sync: () => makeFormatHandler(new FormatHandlerConfig({}))
  }
) {
  static readonly Test: Layer.Layer<FormatHandler> = FormatHandler.Default
}

export const makeFormatHandlerLayer = (
  config: FormatHandlerConfig
): Layer.Layer<FormatHandler> =>
  Layer.succeed(FormatHandler, FormatHandler.make(makeFormatHandler(config)))

export const FormatHandlerLive: Layer.Layer<FormatHandler> = FormatHandler.Default

export const FormatHandlerTest: Layer.Layer<FormatHandler> = FormatHandler.Test
