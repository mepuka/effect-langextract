import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"

import { ExtractionTarget } from "../../src/ExtractionTarget.js"

describe("ExtractionTarget", () => {
  it("builds prompt/json schema metadata from schema classes", () => {
    const Person = Schema.Struct({
      name: Schema.String.annotations({ description: "Person name" }),
      age: Schema.Number.annotations({ description: "Person age" })
    }).annotations({
      identifier: "person",
      description: "A person mentioned in text",
      examples: [{ name: "Alice", age: 30 }]
    })

    const target = ExtractionTarget.make({
      classes: { person: Person },
      description: "Extract people"
    })

    expect(target.description).toBe("Extract people")
    expect(target.classDefinitions.person?.fields.length).toBe(2)
    expect(target.promptDescription).toContain("extractionClass")
    expect(target.promptDescription).toContain("person")
    expect(target.jsonSchema).toHaveProperty("$defs.ExtractionTargetOutput.properties.extractions")
    expect(target.jsonSchema).toHaveProperty(
      "$defs.ExtractionTargetOutput.properties.extractions.items.discriminator.propertyName",
      "extractionClass"
    )
    expect(target.jsonSchema).toHaveProperty(
      "$defs.ExtractionTargetOutput.properties.extractions.items.discriminator.mapping.person",
      "#/$defs/personExtractionRow"
    )
  })

  it("rejects mismatched identifier annotations", () => {
    const Person = Schema.Struct({
      name: Schema.String
    }).annotations({
      identifier: "player"
    })

    expect(() =>
      ExtractionTarget.make({
        classes: { person: Person },
        description: "Extract entities"
      })
    ).toThrowError(/must match identifier annotation/)
  })

  it("rejects invalid annotated examples", () => {
    const Person = Schema.Struct({
      name: Schema.String
    }).annotations({
      identifier: "person",
      examples: [{ name: 123 }]
    })

    expect(() =>
      ExtractionTarget.make({
        classes: { person: Person },
        description: "Extract entities"
      })
    ).toThrowError(/invalid annotated examples/)
  })
})
