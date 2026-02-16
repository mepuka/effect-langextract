import { Effect, Layer, Schema } from "effect"

import { ExampleData } from "./Data.js"

export class PromptTemplateStructured extends Schema.Class<PromptTemplateStructured>(
  "PromptTemplateStructured"
)({
  description: Schema.String,
  examples: Schema.optionalWith(Schema.Array(ExampleData), {
    default: () => [] as const
  })
}) {}

export interface PromptBuilderService {
  readonly buildPrompt: (
    chunkText: string,
    documentId: string,
    additionalContext?: string | undefined
  ) => string
  readonly template: PromptTemplateStructured
}

const buildPromptText = (
  template: PromptTemplateStructured,
  chunkText: string,
  documentId: string,
  additionalContext?: string | undefined
): string => {
  const examplesBlock = template.examples
    .map((example: ExampleData, index: number) => {
      const extractionJson = JSON.stringify(example.extractions)
      return [
        `Example ${index + 1}:`,
        example.text,
        extractionJson
      ].join("\n")
    })
    .join("\n\n")

  const contextLine = additionalContext ? `Context: ${additionalContext}\n` : ""

  return [
    template.description,
    examplesBlock,
    `Document: ${documentId}`,
    contextLine,
    `Text:\n${chunkText}`
  ]
    .filter((part) => part.length > 0)
    .join("\n\n")
}

const makePromptBuilderService = (
  template: PromptTemplateStructured
): PromptBuilderService => ({
  template,
  buildPrompt: (chunkText, documentId, additionalContext) =>
    buildPromptText(template, chunkText, documentId, additionalContext)
})

export class PromptBuilder extends Effect.Service<PromptBuilder>()(
  "@effect-langextract/PromptBuilder",
  {
    sync: () =>
      makePromptBuilderService(
        new PromptTemplateStructured({
          description: "Extract structured entities.",
          examples: []
        })
      )
  }
) {}

export const makePromptBuilderLayer = (
  template: PromptTemplateStructured
): Layer.Layer<PromptBuilder> =>
  Layer.succeed(PromptBuilder, PromptBuilder.make(makePromptBuilderService(template)))

export const PromptBuilderLive: Layer.Layer<PromptBuilder> = PromptBuilder.Default

export const PromptBuilderTest: Layer.Layer<PromptBuilder> = PromptBuilder.Default

export const buildPrompt = (
  chunkText: string,
  documentId: string,
  additionalContext?: string | undefined
): Effect.Effect<string, never, PromptBuilder> =>
  Effect.gen(function* () {
    const promptBuilder = yield* PromptBuilder
    return promptBuilder.buildPrompt(chunkText, documentId, additionalContext)
  })
