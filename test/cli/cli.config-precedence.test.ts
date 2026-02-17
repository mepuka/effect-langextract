import { describe, expect, it } from "@effect/vitest"

import { resolveExtractCommandConfig } from "../../src/Cli.js"

describe("CLI config precedence", () => {
  it("applies CLI flags over environment values", () => {
    const config = resolveExtractCommandConfig(
      {
        provider: "gemini",
        modelId: "gemini-2.5-flash",
        prompt: "CLI prompt"
      },
      {
        LANGEXTRACT_PROVIDER: "openai",
        MODEL_ID: "gpt-4o-mini",
        PROMPT_DESCRIPTION: "ENV prompt"
      }
    )

    expect(config.provider).toBe("gemini")
    expect(config.modelId).toBe("gemini-2.5-flash")
    expect(config.prompt).toBe("CLI prompt")
  })

  it("applies env values when CLI options are absent", () => {
    const config = resolveExtractCommandConfig(
      {},
      {
        LANGEXTRACT_PROVIDER: "ollama",
        MODEL_ID: "llama3.2:latest",
        OLLAMA_BASE_URL: "http://localhost:11435"
      }
    )

    expect(config.provider).toBe("ollama")
    expect(config.modelId).toBe("llama3.2:latest")
    expect(config.ollamaBaseUrl).toBe("http://localhost:11435")
  })

  it("falls back to defaults when CLI and env are absent", () => {
    const config = resolveExtractCommandConfig({}, {})

    expect(config.provider).toBe("gemini")
    expect(config.modelId).toBe("gemini-2.5-flash")
    expect(config.output).toBe("json")
  })
})
