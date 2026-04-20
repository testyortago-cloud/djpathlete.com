import { describe, it, expect, beforeEach, afterAll } from "vitest"
import {
  listPromptTemplates,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
  getPromptTemplateById,
} from "@/lib/db/prompt-templates"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_TAG = "__TEST_PROMPT_TPL__"

describe("prompt-templates DAL", () => {
  const supabase = createServiceRoleClient()

  async function cleanup() {
    await supabase.from("prompt_templates").delete().like("name", `${TEST_TAG}%`)
  }

  beforeEach(cleanup)
  afterAll(cleanup)

  it("creates, reads, updates, and deletes a template", async () => {
    const created = await createPromptTemplate({
      name: `${TEST_TAG}A`,
      category: "structure",
      scope: "week",
      description: "d",
      prompt: "p",
      created_by: null,
    })
    expect(created.id).toBeTruthy()

    const fetched = await getPromptTemplateById(created.id)
    expect(fetched?.name).toBe(`${TEST_TAG}A`)

    const updated = await updatePromptTemplate(created.id, { name: `${TEST_TAG}B` })
    expect(updated.name).toBe(`${TEST_TAG}B`)

    await deletePromptTemplate(created.id)
    const gone = await getPromptTemplateById(created.id)
    expect(gone).toBeNull()
  })

  it("lists with optional scope filter", async () => {
    await createPromptTemplate({
      name: `${TEST_TAG}week-only`,
      category: "structure",
      scope: "week",
      description: "d",
      prompt: "p",
      created_by: null,
    })
    await createPromptTemplate({
      name: `${TEST_TAG}day-only`,
      category: "session",
      scope: "day",
      description: "d",
      prompt: "p",
      created_by: null,
    })
    await createPromptTemplate({
      name: `${TEST_TAG}both`,
      category: "specialty",
      scope: "both",
      description: "d",
      prompt: "p",
      created_by: null,
    })

    const weekScoped = await listPromptTemplates({ scope: "week" })
    const names = weekScoped.map((t) => t.name).filter((n) => n.startsWith(TEST_TAG))
    expect(names).toContain(`${TEST_TAG}week-only`)
    expect(names).toContain(`${TEST_TAG}both`)
    expect(names).not.toContain(`${TEST_TAG}day-only`)
  })

  it("list without scope returns all", async () => {
    await createPromptTemplate({
      name: `${TEST_TAG}A`,
      category: "structure",
      scope: "week",
      description: "d",
      prompt: "p",
      created_by: null,
    })
    const all = await listPromptTemplates()
    const names = all.map((t) => t.name).filter((n) => n.startsWith(TEST_TAG))
    expect(names.length).toBeGreaterThanOrEqual(1)
  })
})
