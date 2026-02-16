import { Effect, Layer, Schema } from "effect"

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

const stripCodeFences = (text: string): string =>
  text
    .replace(/^```(?:json|yaml)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()

const parseJsonOutput = (
  text: string,
  config: FormatHandlerConfig
): ReadonlyArray<Record<string, unknown>> => {
  const normalized = config.useFences ? stripCodeFences(text) : text.trim()
  const parsed = JSON.parse(normalized) as unknown

  if (Array.isArray(parsed)) {
    return parsed as ReadonlyArray<Record<string, unknown>>
  }

  if (typeof parsed === "object" && parsed !== null) {
    const asRecord = parsed as Record<string, unknown>
    if (config.useWrapper && config.wrapperKey && Array.isArray(asRecord[config.wrapperKey])) {
      return asRecord[config.wrapperKey] as ReadonlyArray<Record<string, unknown>>
    }
    return [asRecord]
  }

  return []
}

const parseOutputImpl = (
  text: string,
  config: FormatHandlerConfig
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, FormatParseError> =>
  Effect.try({
    try: () => parseJsonOutput(text, config),
    catch: (error) =>
      new FormatParseError({
        message: `Failed to parse model output (${config.formatType}): ${String(error)}`
      })
  })

export const makeFormatHandler = (config: FormatHandlerConfig): FormatHandlerService => ({
  config,
  formatExtractionExample: (extractions) => JSON.stringify(extractions, null, 2),
  parseOutput: (text) => parseOutputImpl(text, config)
})

export class FormatHandler extends Effect.Service<FormatHandler>()(
  "@effect-langextract/FormatHandler",
  {
    sync: () => makeFormatHandler(new FormatHandlerConfig({}))
  }
) {}

export const makeFormatHandlerLayer = (
  config: FormatHandlerConfig
): Layer.Layer<FormatHandler> =>
  Layer.succeed(FormatHandler, FormatHandler.make(makeFormatHandler(config)))

export const FormatHandlerLive: Layer.Layer<FormatHandler> = FormatHandler.Default

export const FormatHandlerTest: Layer.Layer<FormatHandler> = FormatHandler.Default
