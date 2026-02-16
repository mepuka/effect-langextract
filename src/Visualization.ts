import { Effect, Layer } from "effect"

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

const visualizeImpl = (
  doc: AnnotatedDocument,
  options?: {
    animationSpeed?: number
    showLegend?: boolean
  }
): Effect.Effect<string> =>
  Effect.succeed(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>effect-langextract visualization</title>
  </head>
  <body>
    <pre>${JSON.stringify({ doc, options }, null, 2)}</pre>
  </body>
</html>`)

export class Visualizer extends Effect.Service<Visualizer>()(
  "@effect-langextract/Visualizer",
  {
    sync: () => ({
      visualize: visualizeImpl
    } satisfies VisualizerService)
  }
) {}

export const VisualizerLive: Layer.Layer<Visualizer> = Visualizer.Default

export const VisualizerTest: Layer.Layer<Visualizer> = Visualizer.Default
