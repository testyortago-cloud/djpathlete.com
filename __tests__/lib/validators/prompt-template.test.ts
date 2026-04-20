import { describe, it, expect } from "vitest"
import {
  promptTemplateCreateSchema,
  promptTemplateUpdateSchema,
  enhanceRequestSchema,
} from "@/lib/validators/prompt-template"

describe("prompt-template validators", () => {
  const valid = {
    name: "My Template",
    category: "structure" as const,
    scope: "week" as const,
    description: "A description",
    prompt: "Do this and that",
  }

  it("accepts a valid create payload", () => {
    expect(promptTemplateCreateSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects unknown category", () => {
    const r = promptTemplateCreateSchema.safeParse({ ...valid, category: "nonsense" })
    expect(r.success).toBe(false)
  })

  it("rejects unknown scope", () => {
    const r = promptTemplateCreateSchema.safeParse({ ...valid, scope: "monthly" })
    expect(r.success).toBe(false)
  })

  it("rejects empty name/prompt/description", () => {
    expect(promptTemplateCreateSchema.safeParse({ ...valid, name: "" }).success).toBe(false)
    expect(promptTemplateCreateSchema.safeParse({ ...valid, prompt: "" }).success).toBe(false)
    expect(promptTemplateCreateSchema.safeParse({ ...valid, description: "" }).success).toBe(false)
  })

  it("update schema accepts partial payloads", () => {
    expect(promptTemplateUpdateSchema.safeParse({ name: "New name" }).success).toBe(true)
    expect(promptTemplateUpdateSchema.safeParse({}).success).toBe(true)
  })

  it("enhanceRequestSchema accepts polish and generate modes", () => {
    expect(enhanceRequestSchema.safeParse({ mode: "polish", input: "rough draft" }).success).toBe(true)
    expect(enhanceRequestSchema.safeParse({ mode: "generate", input: "lat width day" }).success).toBe(true)
  })

  it("enhanceRequestSchema rejects unknown mode", () => {
    expect(enhanceRequestSchema.safeParse({ mode: "evil", input: "x" }).success).toBe(false)
  })

  it("enhanceRequestSchema rejects empty input", () => {
    expect(enhanceRequestSchema.safeParse({ mode: "polish", input: "" }).success).toBe(false)
  })
})
