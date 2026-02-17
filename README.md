# effect-langextract

Effect-native structured extraction with source-grounded spans.

## Status

The core is runtime-neutral and provider-native:
- Core modules do not import `@effect/platform-bun`.
- Runtime wiring is isolated under `src/runtime/*`.
- OpenAI / Gemini / Anthropic use native `@effect/ai-*` language-model layers.
- Ollama uses a platform-neutral `HttpClient` adapter.

## Run

```bash
bun install
bun run typecheck
bun run test
bun run cli -- extract --text "Alice visited Paris" --examples-file ./examples.json --provider anthropic
```

## Runtime Layering

- Core command execution: `src/Cli.ts`
- Bun runtime composition: `src/runtime/BunRuntime.ts`
- Bun entrypoint: `src/runtime/BunMain.ts`
- Node-ready composition helper: `src/runtime/NodeRuntime.ts`

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

Live provider smoke tests are opt-in via:

```bash
LANGEXTRACT_LIVE_PROVIDER_SMOKE=true bun run test
```
