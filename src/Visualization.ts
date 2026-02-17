import { Effect, Layer } from "effect"

import { AnnotatedDocument } from "./Data.js"
import { VisualizationError } from "./Errors.js"

export interface VisualizerService {
  readonly visualize: (
    doc: AnnotatedDocument,
    options?: {
      animationSpeed?: number
      showLegend?: boolean
    }
  ) => Effect.Effect<string, VisualizationError>
}

const Palette = [
  "#f9c80e",
  "#f86624",
  "#ea3546",
  "#43bccd",
  "#662e9b",
  "#2a9d8f",
  "#e76f51",
  "#264653"
] as const

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;")

type Highlight = {
  readonly extractionClass: string
  readonly extractionText: string
  readonly status?: string | undefined
  readonly start: number
  readonly end: number
}

const hasOverlap = (left: Highlight, right: Highlight): boolean =>
  left.start < right.end && right.start < left.end

const collectHighlights = (doc: AnnotatedDocument): ReadonlyArray<Highlight> => {
  const sourceLength = doc.text.length
  const accepted: Array<Highlight> = []

  for (const extraction of doc.extractions) {
    const start = extraction.charInterval?.startPos
    const end = extraction.charInterval?.endPos
    if (
      start === undefined ||
      end === undefined ||
      start < 0 ||
      end <= start ||
      start >= sourceLength
    ) {
      continue
    }

    const normalized: Highlight = {
      extractionClass: extraction.extractionClass,
      extractionText: extraction.extractionText,
      status: extraction.alignmentStatus,
      start,
      end: Math.min(sourceLength, end)
    }

    const blocked = accepted.some((current) => hasOverlap(current, normalized))
    if (!blocked) {
      accepted.push(normalized)
    }
  }

  return accepted.sort((left, right) => left.start - right.start)
}

const buildLegend = (highlights: ReadonlyArray<Highlight>): string => {
  const counts = new Map<string, number>()
  for (const item of highlights) {
    const current = counts.get(item.extractionClass) ?? 0
    counts.set(item.extractionClass, current + 1)
  }

  const keys = [...counts.keys()]
  if (keys.length === 0) {
    return `<div class="lx-empty">No aligned extractions found.</div>`
  }

  return `<ul class="lx-legend">${keys
    .map((key, index) => {
      const count = counts.get(key) ?? 0
      const color = Palette[index % Palette.length] ?? Palette[0]
      return `<li><span class="lx-dot" style="background:${color}"></span>${escapeHtml(key)} (${count})</li>`
    })
    .join("")}</ul>`
}

const buildHighlightedText = (
  doc: AnnotatedDocument,
  highlights: ReadonlyArray<Highlight>
): string => {
  const classColors = new Map<string, string>()
  const nextColor = (extractionClass: string): string => {
    const existing = classColors.get(extractionClass)
    if (existing !== undefined) {
      return existing
    }
    const color = Palette[classColors.size % Palette.length]
      ?? Palette[0]
    classColors.set(extractionClass, color)
    return color
  }

  let cursor = 0
  const parts: Array<string> = []

  for (const [index, highlight] of highlights.entries()) {
    if (cursor < highlight.start) {
      parts.push(escapeHtml(doc.text.slice(cursor, highlight.start)))
    }

    const color = nextColor(highlight.extractionClass)
    const content = escapeHtml(doc.text.slice(highlight.start, highlight.end))
    const status = highlight.status ?? "unknown"
    parts.push(
      `<mark class="lx-highlight" style="--lx-color:${color};--lx-order:${index}" data-class="${escapeHtml(highlight.extractionClass)}" data-status="${escapeHtml(status)}"><span class="lx-tag">${escapeHtml(highlight.extractionClass)}</span>${content}</mark>`
    )

    cursor = highlight.end
  }

  if (cursor < doc.text.length) {
    parts.push(escapeHtml(doc.text.slice(cursor)))
  }

  return parts.join("")
}

const renderHtml = (
  doc: AnnotatedDocument,
  options?: {
    animationSpeed?: number
    showLegend?: boolean
  }
): string => {
  const highlights = collectHighlights(doc)
  const animationSpeed = options?.animationSpeed ?? 1
  const showLegend = options?.showLegend ?? true
  const legend = showLegend ? buildLegend(highlights) : ""
  const highlightedText = buildHighlightedText(doc, highlights)

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>effect-langextract visualization</title>
    <style>
      :root { --lx-speed: ${animationSpeed}s; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #f7f7f3; color: #1f2937; }
      .lx-shell { max-width: 960px; margin: 0 auto; padding: 20px; }
      .lx-title { margin: 0 0 12px; font-size: 1.2rem; }
      .lx-card { background: #ffffff; border: 1px solid #e6e6de; border-radius: 12px; padding: 16px; }
      .lx-text { white-space: pre-wrap; line-height: 1.65; font-size: 0.98rem; }
      .lx-highlight { background: color-mix(in srgb, var(--lx-color) 30%, white); border-bottom: 2px solid var(--lx-color); border-radius: 4px; padding: 0 2px; animation: lxFade calc(var(--lx-speed) * 0.8) ease both; animation-delay: calc(var(--lx-order) * (var(--lx-speed) * 0.1)); }
      .lx-tag { display: inline-block; margin-right: 0.35rem; padding: 0 0.3rem; border-radius: 999px; background: color-mix(in srgb, var(--lx-color) 40%, white); font-size: 0.72rem; vertical-align: middle; }
      .lx-legend { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 12px; }
      .lx-legend li { font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px; }
      .lx-dot { width: 10px; height: 10px; border-radius: 999px; display: inline-block; }
      .lx-empty { margin: 0 0 12px; color: #6b7280; font-size: 0.9rem; }
      @keyframes lxFade { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
      @media (max-width: 640px) { .lx-shell { padding: 14px; } .lx-card { padding: 12px; } }
    </style>
  </head>
  <body>
    <main class="lx-shell">
      <h1 class="lx-title">effect-langextract visualization</h1>
      ${legend}
      <section class="lx-card">
        <div class="lx-text">${highlightedText}</div>
      </section>
    </main>
  </body>
</html>`
}

const visualizeImpl = (
  doc: AnnotatedDocument,
  options?: {
    animationSpeed?: number
    showLegend?: boolean
  }
): Effect.Effect<string, VisualizationError> =>
  Effect.try({
    try: () => renderHtml(doc, options),
    catch: (error) =>
      new VisualizationError({
        message: `Failed to render visualization HTML: ${String(error)}`
      })
  })

export class Visualizer extends Effect.Service<Visualizer>()(
  "@effect-langextract/Visualizer",
  {
    sync: () => ({
      visualize: visualizeImpl
    } satisfies VisualizerService)
  }
) {
  static readonly Test: Layer.Layer<Visualizer> = Visualizer.Default

  static testLayer = (
    service?: VisualizerService
  ): Layer.Layer<Visualizer> =>
    Layer.succeed(
      Visualizer,
      Visualizer.make(
        service ?? {
          visualize: visualizeImpl
        }
      )
    )
}

export const VisualizerLive: Layer.Layer<Visualizer> = Visualizer.Default

export const VisualizerTest: Layer.Layer<Visualizer> = Visualizer.Test
