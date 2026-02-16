import { Schema } from "effect"

export const EXTRACTIONS_KEY = "extractions" as const
export const ATTRIBUTE_SUFFIX = "_attributes" as const

export const AlignmentStatus = Schema.Literal(
  "match_exact",
  "match_greater",
  "match_lesser",
  "match_fuzzy"
)
export type AlignmentStatus = typeof AlignmentStatus.Type

export class CharInterval extends Schema.Class<CharInterval>("CharInterval")({
  startPos: Schema.optionalWith(Schema.Int, { exact: true }),
  endPos: Schema.optionalWith(Schema.Int, { exact: true })
}) {}

export const TokenIntervalSchema = Schema.Struct({
  startIndex: Schema.Int,
  endIndex: Schema.Int
})
export type TokenIntervalSchema = typeof TokenIntervalSchema.Type

const ExtractionAttributes = Schema.Record({
  key: Schema.String,
  value: Schema.Union(Schema.String, Schema.Array(Schema.String))
})

export class Extraction extends Schema.Class<Extraction>("Extraction")({
  extractionClass: Schema.String,
  extractionText: Schema.String,
  charInterval: Schema.optionalWith(CharInterval, { exact: true }),
  alignmentStatus: Schema.optionalWith(AlignmentStatus, { exact: true }),
  extractionIndex: Schema.optionalWith(Schema.Int, { exact: true }),
  groupIndex: Schema.optionalWith(Schema.Int, { exact: true }),
  description: Schema.optionalWith(Schema.String, { exact: true }),
  attributes: Schema.optionalWith(ExtractionAttributes, { exact: true }),
  tokenInterval: Schema.optionalWith(TokenIntervalSchema, { exact: true })
}) {}

export class Document extends Schema.Class<Document>("Document")({
  text: Schema.String,
  documentId: Schema.optionalWith(Schema.String, { exact: true }),
  additionalContext: Schema.optionalWith(Schema.String, { exact: true })
}) {}

export const makeDocument = (args: {
  readonly text: string
  readonly documentId?: string | undefined
  readonly additionalContext?: string | undefined
}): Document =>
  new Document({
    text: args.text,
    documentId: args.documentId ?? `doc_${crypto.randomUUID().slice(0, 8)}`,
    ...(args.additionalContext !== undefined
      ? { additionalContext: args.additionalContext }
      : {})
  })

export class AnnotatedDocument extends Schema.Class<AnnotatedDocument>("AnnotatedDocument")({
  documentId: Schema.optionalWith(Schema.String, { exact: true }),
  text: Schema.String,
  extractions: Schema.optionalWith(Schema.Array(Extraction), {
    default: () => [] as const
  })
}) {}

export class ExampleData extends Schema.Class<ExampleData>("ExampleData")({
  text: Schema.String,
  extractions: Schema.optionalWith(Schema.Array(Extraction), {
    default: () => [] as const
  }),
  input: Schema.optionalWith(Schema.String, { exact: true }),
  output: Schema.optionalWith(Schema.String, { exact: true })
}) {}
