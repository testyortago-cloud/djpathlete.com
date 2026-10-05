// @vitest-environment node
// __tests__/scripts/rpi-landing-doc.test.ts
//
// The RPI landing page is written straight onto a funnel step by
// scripts/seed-funnel-pages.ts. It never passes through the AI page
// builder, so these tests are what checks it against the section grammar.
import { describe, it, expect } from "vitest"
import { buildRpiLandingDoc, RPI_QUIZ_STEP_SLUG } from "@/scripts/lib/rpi-landing-doc"
import { sectionDocSchema } from "@/lib/funnels/sections/registry"
import { reassemble } from "@/lib/funnels/sections/doc"

const doc = buildRpiLandingDoc({ businessName: "Trailhead Strength" })

/** Every `{label, target}` button anywhere in the document. */
function buttons(value: unknown): { label: string; target: { kind: string; stepSlug?: string; sectionId?: string } }[] {
  if (Array.isArray(value)) return value.flatMap(buttons)
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    const own = typeof record.label === "string" && record.target && typeof record.target === "object" ? [record as never] : []
    return [...own, ...Object.values(record).flatMap(buttons)]
  }
  return []
}

describe("buildRpiLandingDoc", () => {
  it("validates against the section grammar, with unique section ids", () => {
    expect(sectionDocSchema.safeParse(doc).success).toBe(true)
    const ids = doc.sections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("renders under a funnel base path with no problems", () => {
    const { problems, html } = reassemble(doc, { funnelBasePath: "/go/rotational-performance-index" })
    expect(problems).toEqual([])
    expect(html).toContain('href="/go/rotational-performance-index/quiz"')
  })

  it("sends every step button to the quiz step, and every anchor to a section on the page", () => {
    // MUTANT KILLED: a stepSlug that is not a page of this funnel blocks
    // publish; an anchor with no section is a button that goes nowhere.
    const all = buttons(doc.sections)
    expect(all.filter((b) => b.target.kind === "step").length).toBeGreaterThanOrEqual(2)
    const ids = new Set(doc.sections.map((s) => s.id))
    for (const b of all) {
      if (b.target.kind === "step") expect(b.target.stepSlug).toBe(RPI_QUIZ_STEP_SLUG)
      else if (b.target.kind === "anchor") expect(ids.has(b.target.sectionId!)).toBe(true)
      else throw new Error(`unexpected button target ${b.target.kind} on "${b.label}"`)
    }
  })

  it("names the business it was given in the footer, and no other", () => {
    const footer = doc.sections.find((s) => s.kind === "footer")
    expect((footer!.props as { businessName: string }).businessName).toBe("Trailhead Strength")
    expect(JSON.stringify(doc)).not.toMatch(/DJP Athlete/)
  })
})
