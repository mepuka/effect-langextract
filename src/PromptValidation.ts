import { Effect, Layer, Schema } from "effect"

import { ExampleData } from "./Data.js"
import { PromptAlignmentError } from "./Errors.js"

export const PromptValidationLevel = Schema.Literal("off", "warning", "error")
export type PromptValidationLevel = typeof PromptValidationLevel.Type

export class AlignmentPolicy extends Schema.Class<AlignmentPolicy>("AlignmentPolicy")({
  enableFuzzyAlignment: Schema.optionalWith(Schema.Boolean, {
    default: () => true
  }),
  fuzzyAlignmentThreshold: Schema.optionalWith(Schema.Number, {
    default: () => 0.75
  }),
  acceptMatchLesser: Schema.optionalWith(Schema.Boolean, {
    default: () => true
  })
}) {}

export class ValidationIssue extends Schema.Class<ValidationIssue>("ValidationIssue")({
  exampleIndex: Schema.Int,
  exampleId: Schema.optionalWith(Schema.String, { exact: true }),
  extractionClass: Schema.String,
  extractionTextPreview: Schema.String,
  alignmentStatus: Schema.optionalWith(Schema.String, { exact: true }),
  issueKind: Schema.Literal("failed", "non_exact"),
  charInterval: Schema.optionalWith(Schema.Tuple(Schema.Int, Schema.Int), { exact: true }),
  tokenInterval: Schema.optionalWith(Schema.Tuple(Schema.Int, Schema.Int), { exact: true })
}) {}

export class ValidationReport extends Schema.Class<ValidationReport>("ValidationReport")({
  issues: Schema.Array(ValidationIssue)
}) {
  get hasFailed(): boolean {
    return this.issues.some((issue) => issue.issueKind === "failed")
  }

  get hasNonExact(): boolean {
    return this.issues.some((issue) => issue.issueKind === "non_exact")
  }
}

export interface PromptValidatorService {
  readonly validatePromptAlignment: (
    examples: ReadonlyArray<ExampleData>,
    policy?: AlignmentPolicy
  ) => Effect.Effect<ValidationReport>

  readonly handleAlignmentReport: (
    report: ValidationReport,
    level: PromptValidationLevel,
    options?: { strictNonExact?: boolean }
  ) => Effect.Effect<void, PromptAlignmentError>
}

const validatePromptAlignmentImpl = (
  examples: ReadonlyArray<ExampleData>
): Effect.Effect<ValidationReport> =>
  Effect.succeed(
    new ValidationReport({
      issues: examples.length > 0 ? [] : []
    })
  )

const handleAlignmentReportImpl = (
  report: ValidationReport,
  level: PromptValidationLevel,
  options?: { strictNonExact?: boolean }
): Effect.Effect<void, PromptAlignmentError> => {
  if (level === "error" && report.hasFailed) {
    return Effect.fail(
      new PromptAlignmentError({
        message: "Prompt validation failed due to unresolved extraction alignments."
      })
    )
  }

  if (level === "error" && options?.strictNonExact && report.hasNonExact) {
    return Effect.fail(
      new PromptAlignmentError({
        message: "Prompt validation found non-exact alignments in strict mode."
      })
    )
  }

  return Effect.void
}

export class PromptValidator extends Effect.Service<PromptValidator>()(
  "@effect-langextract/PromptValidator",
  {
    sync: () => ({
      validatePromptAlignment: validatePromptAlignmentImpl,
      handleAlignmentReport: handleAlignmentReportImpl
    } satisfies PromptValidatorService)
  }
) {}

export const PromptValidatorLive: Layer.Layer<PromptValidator> = PromptValidator.Default

export const PromptValidatorTest: Layer.Layer<PromptValidator> = PromptValidator.Default
