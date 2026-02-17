import { Effect, Layer, Schema } from "effect"

import { AnnotatedDocument } from "./Data.js"

export interface VisualizerService {
  readonly visualize: (
    doc: AnnotatedDocument,
    options?: {
      animationSpeed?: number
      showLegend?: boolean
    }
  ) => Effect.Effect<string>
}

const JsonString = Schema.parseJson()

const encodeVisualizationPayload = (payload: unknown): Effect.Effect<string> =>
  Schema.encode(JsonString)(payload).pipe(Effect.orElseSucceed(() => "{}"))

const visualizeImpl = (
  doc: AnnotatedDocument,
  options?: {
    animationSpeed?: number
    showLegend?: boolean
  }
): Effect.Effect<string> =>
  encodeVisualizationPayload({ doc, options }).pipe(
    Effect.map(
      (payload) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>effect-langextract visualization</title>
  </head>
  <body>
    <pre>${payload}</pre>
  </body>
</html>`
    )
  )

export class Visualizer extends Effect.Service<Visualizer>()(
  "@effect-langextract/Visualizer",
  {
    sync: () => ({
      visualize: visualizeImpl
    } satisfies VisualizerService)
  }
) {
  static readonly Test: Layer.Layer<Visualizer> = Visualizer.Default
}

export const VisualizerLive: Layer.Layer<Visualizer> = Visualizer.Default

export const VisualizerTest: Layer.Layer<Visualizer> = Visualizer.Test
