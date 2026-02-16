import { Effect } from "effect"

import { ScoredOutput } from "../FormatType.js"

export const runGeminiBatch = (
  prompts: ReadonlyArray<string>
): Effect.Effect<ReadonlyArray<ReadonlyArray<ScoredOutput>>> =>
  Effect.succeed(
    prompts.map((prompt) => [
      new ScoredOutput({
        output: prompt,
        score: 1,
        provider: "gemini"
      })
    ])
  )
