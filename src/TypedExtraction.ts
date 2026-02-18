import { Effect, Schema } from "effect"

import type { AlignmentStatus, AnnotatedDocument, CharInterval, Extraction } from "./Data.js"
import type {
  AnyExtractionTarget,
  ExtractionClassSchema
} from "./ExtractionTarget.js"

export const SCHEMA_DATA_ATTRIBUTE_KEY = "__schemaDataJson" as const

const JsonString = Schema.parseJson()

type ClassMap = Record<string, ExtractionClassSchema>

type BaseTypedExtraction = {
  readonly extractionText: string
  readonly charInterval?: CharInterval | undefined
  readonly alignmentStatus?: AlignmentStatus | undefined
  readonly extractionIndex?: number | undefined
  readonly groupIndex?: number | undefined
  readonly description?: string | undefined
}

export type TypedExtraction<Classes extends ClassMap> = {
  readonly [K in keyof Classes & string]: BaseTypedExtraction & {
    readonly extractionClass: K
    readonly data: Classes[K]["Type"]
  }
}[keyof Classes & string]

export interface TypedAnnotatedDocument<Classes extends ClassMap> {
  readonly text: string
  readonly documentId?: string | undefined
  readonly extractions: ReadonlyArray<TypedExtraction<Classes>>
}

export const encodeSchemaDataMarker = (
  data: unknown
): Effect.Effect<string, never> =>
  Effect.sync(() => {
    try {
      return Schema.encodeSync(JsonString)(data)
    } catch {
      return "{}"
    }
  })

export const decodeSchemaDataMarker = (
  encoded: string
): Effect.Effect<unknown> =>
  Schema.decodeUnknown(JsonString)(encoded).pipe(
    Effect.catchAll(() => Effect.succeed({} as const))
  )

const getSchemaDataMarker = (extraction: Extraction): string | undefined => {
  const value = extraction.attributes?.[SCHEMA_DATA_ATTRIBUTE_KEY]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export const toTypedAnnotatedDocument = <Classes extends ClassMap>(
  document: AnnotatedDocument,
  target: AnyExtractionTarget
): Effect.Effect<TypedAnnotatedDocument<Classes>> =>
  Effect.gen(function* () {
    const typed: Array<TypedExtraction<Classes>> = []

    for (const extraction of document.extractions) {
      const marker = getSchemaDataMarker(extraction)
      if (marker === undefined) {
        continue
      }

      const schema = target.classSchemasByIdentifier[extraction.extractionClass]
      if (schema === undefined) {
        continue
      }

      const decodedMarker = yield* decodeSchemaDataMarker(marker)
      const decoded = Schema.decodeUnknownEither(schema)(decodedMarker)
      if (decoded._tag === "Left") {
        continue
      }

      typed.push({
        extractionClass: extraction.extractionClass,
        extractionText: extraction.extractionText,
        data: decoded.right,
        ...(extraction.charInterval !== undefined
          ? { charInterval: extraction.charInterval }
          : {}),
        ...(extraction.alignmentStatus !== undefined
          ? { alignmentStatus: extraction.alignmentStatus }
          : {}),
        ...(extraction.extractionIndex !== undefined
          ? { extractionIndex: extraction.extractionIndex }
          : {}),
        ...(extraction.groupIndex !== undefined
          ? { groupIndex: extraction.groupIndex }
          : {}),
        ...(extraction.description !== undefined
          ? { description: extraction.description }
          : {})
      } as TypedExtraction<Classes>)
    }

    return {
      text: document.text,
      ...(document.documentId !== undefined ? { documentId: document.documentId } : {}),
      extractions: typed
    }
  })
