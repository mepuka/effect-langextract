# effect-langextract

Effect-native structured extraction with source-grounded spans.

## Status

The core is runtime-neutral and provider-native:
- Core modules do not import `@effect/platform-bun`.
- Runtime wiring is isolated under `src/runtime/*`.
- OpenAI / Gemini / Anthropic use native `@effect/ai-*` language-model layers.
- Ollama uses a platform-neutral `HttpClient` adapter.
- CLI is typed with `@effect/cli` subcommands: `extract` and `visualize`.

## Run

```bash
bun install
bun run typecheck
bun run test
bun run perf:annotator
bun run cli -- extract --text "Alice visited Paris" --examples-file ./examples.json --provider anthropic
bun run cli -- visualize --input ./annotated-document.json --output-path ./output.html
```

Node-ready runtime composition is also available:

```bash
bun run cli:node -- extract --text "Alice visited Paris" --examples-file ./examples.json --provider anthropic
```

## Performance Harness

Deterministic benchmark reports are written under `.cache/perf`:

```bash
bun run perf:annotator
bun run perf:annotator:report
```

Artifacts:
- `.cache/perf/annotator-throughput.latest.json`
- `.cache/perf/annotator-throughput-<timestamp>.json`

## Runtime Layering

- Core command execution: `src/Cli.ts`
- Bun runtime composition: `src/runtime/BunRuntime.ts`
- Bun entrypoint: `src/runtime/BunMain.ts`
- Bun worker alignment runtime: `src/runtime/BunAlignmentWorker.ts`
- Bun worker protocol/entry: `src/runtime/workers/*`
- Node-ready composition helper: `src/runtime/NodeRuntime.ts`
- Node entrypoint: `src/runtime/NodeMain.ts`

## Config Precedence

Configuration resolution is:

`CLI flags > environment variables > defaults`

Key env vars include:
- Provider: `LANGEXTRACT_PROVIDER`
- Model: `MODEL_ID`
- Cache: `PRIMED_CACHE_*`
- Provider credentials/base URLs: `OPENAI_*`, `GEMINI_*`, `ANTHROPIC_*`, `OLLAMA_BASE_URL`

## Testing Convention

Services expose canonical `Effect.Service` test APIs:
- Stateless/simple services: `static readonly Test`
- Configurable/stateful services: `static testLayer(...)`

Use the service-owned test layer APIs in tests instead of ad-hoc stubs.

Live provider smoke tests are opt-in:

```bash
LANGEXTRACT_LIVE_PROVIDER_SMOKE=true bun run test
```

Focused provider smoke matrix (safe no-op when provider env is missing):

```bash
bun run test:smoke:providers
```

Provider prerequisites:
- OpenAI: `OPENAI_API_KEY` (optional: `OPENAI_MODEL_ID`, `OPENAI_BASE_URL`)
- Gemini: `GEMINI_API_KEY` (optional: `GEMINI_MODEL_ID`, `GEMINI_BASE_URL`)
- Anthropic: `ANTHROPIC_API_KEY` (optional: `ANTHROPIC_MODEL_ID`, `ANTHROPIC_BASE_URL`)
- Ollama: running local server plus `LANGEXTRACT_OLLAMA_SMOKE=true` (optional: `OLLAMA_MODEL_ID`, `OLLAMA_BASE_URL`)

Example:

```bash
LANGEXTRACT_LIVE_PROVIDER_SMOKE=true OPENAI_API_KEY=... GEMINI_API_KEY=... ANTHROPIC_API_KEY=... bun run test:smoke:providers
```

Enable Bun worker alignment runtime (runtime-only layer wiring):

```bash
LANGEXTRACT_ENABLE_BUN_WORKERS=true bun run cli -- extract ...
```

Worker pool sizing (optional):
- `LANGEXTRACT_BUN_WORKER_POOL_SIZE`
- Default: resolved `batch-concurrency`
- Clamp: `1..16`
