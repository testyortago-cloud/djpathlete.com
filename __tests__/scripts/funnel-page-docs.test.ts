// @vitest-environment node
// __tests__/scripts/funnel-page-docs.test.ts
//
// The Gap Map landing page and the pre-visit onboarding form are written
// straight onto funnel steps by scripts/seed-funnel-pages.ts. They never pass
// through the AI page builder, so these tests are what checks them against the
// section grammar. The RPI page has its own file, rpi-landing-doc.test.ts.
import { describe, it, expect } from "vitest"
import { buildGapMapLandingDoc, GAP_MAP_QUIZ_STEP_SLUG } from "@/scripts/lib/gap-map-landing-doc"
import { buildOnboardingDoc } from "@/scripts/lib/onboarding-doc"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import { reassemble } from "@/lib/funnels/sections/doc"
import type { FunnelFormField } from "@/lib/funnels/islands"

function valid(doc: SectionDoc) {
  expect(sectionDocSchema.safeParse(doc).success).toBe(true)
  const ids = doc.sections.map((s) => s.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(reassemble(doc, { funnelBasePath: "/go/x" }).problems).toEqual([])
}

describe("buildGapMapLandingDoc", () => {
  const doc = buildGapMapLandingDoc({ businessName: "Trailhead Strength" })

  it("is a valid page", () => valid(doc))

  it("sends its buttons to the quiz step and its anchor to a section on the page", () => {
    const json = JSON.stringify(doc)
    const stepSlugs = [...json.matchAll(/"stepSlug":"([^"]+)"/g)].map((m) => m[1])
    expect(stepSlugs.length).toBeGreaterThanOrEqual(2)
    expect(new Set(stepSlugs)).toEqual(new Set([GAP_MAP_QUIZ_STEP_SLUG]))
    const ids = new Set(doc.sections.map((s) => s.id))
    for (const [, sectionId] of json.matchAll(/"sectionId":"([^"]+)"/g)) expect(ids.has(sectionId)).toBe(true)
  })
})

describe("buildOnboardingDoc", () => {
  const doc = buildOnboardingDoc({ businessName: "Trailhead Strength" })
  const form = doc.sections.find((s) => s.kind === "form")!
  const fields = (form.props as { fields: FunnelFormField[] }).fields

  it("is a valid page", () => valid(doc))

  it("asks the GHL form's fourteen questions and ends on a waiver tick that files evidence", () => {
    expect(fields).toHaveLength(15)
    const waiver = fields.at(-1)!
    // The role is what shows the live waiver and files which document was
    // accepted (00288); a plain checkbox would do neither.
    expect(waiver).toMatchObject({ type: "checkbox", required: true, role: "waiver_accepted" })
    expect(fields.filter((f) => f.role === "waiver_accepted")).toHaveLength(1)
  })

  it("names its contact fields so the submission becomes a contact with a name", () => {
    // The submit route finds email and phone by TYPE and the name by
    // first_name/last_name; anything else files a lead nobody can call.
    expect(fields.find((f) => f.type === "email")?.required).toBe(true)
    expect(fields.find((f) => f.type === "tel")?.required).toBe(true)
    expect(fields.map((f) => f.name)).toEqual(expect.arrayContaining(["first_name", "last_name"]))
  })

  it("starts no new-lead follow-up: the people filling it in are already booked clients", () => {
    expect((form.props as { skipFollowUp?: boolean }).skipFollowUp).toBe(true)
  })

  it("keeps GHL's dropdown choices", () => {
    expect(fields.find((f) => f.name === "training_history")?.options).toEqual([
      "New / just starting",
      "Less than 6 months",
      "6–12 months",
      "1–3 years",
      "3+ years",
    ])
  })
})
