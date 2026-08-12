// The create dialog renders its goal options from FUNNEL_GOALS and validates
// slugs with RESERVED_FUNNEL_SLUGS. Both are exported precisely so the client
// cannot drift from the schema — these tests fail the moment they do.

import { describe, it, expect } from "vitest"
import {
  createFunnelSchema,
  updateFunnelSchema,
  FUNNEL_GOALS,
  RESERVED_FUNNEL_SLUGS,
} from "@/lib/validators/funnel"

const base = { slug: "free-trial", name: "Free Trial" }

describe("createFunnelSchema", () => {
  it("defaults kind to page when omitted", () => {
    // MUTANT KILLED: making kind required, which would 400 every request from
    // the existing create path that does not send it.
    const parsed = createFunnelSchema.parse(base)
    expect(parsed.kind).toBe("page")
  })

  it("accepts every goal offered by the UI", () => {
    // MUTANT KILLED: a FUNNEL_GOALS list containing a value the schema rejects
    // — the dialog would offer an option that 400s on submit.
    for (const goal of FUNNEL_GOALS) {
      expect(createFunnelSchema.safeParse({ ...base, goal: goal.value }).success).toBe(true)
    }
  })

  it("rejects a goal outside the registry-backed set", () => {
    // MUTANT KILLED: typing goal as a bare string, which would let a typo reach
    // the CHECK constraint and 500 instead of 400.
    expect(createFunnelSchema.safeParse({ ...base, goal: "newsletter" }).success).toBe(false)
  })

  it("rejects a kind outside page and funnel", () => {
    expect(createFunnelSchema.safeParse({ ...base, kind: "sequence" }).success).toBe(false)
  })

  it("rejects a reserved slug", () => {
    expect(createFunnelSchema.safeParse({ ...base, slug: "admin" }).success).toBe(false)
  })

  it("exports the reserved set the dialog checks against", () => {
    // MUTANT KILLED: the dialog hard-coding its own reserved list, which would
    // silently diverge the moment a route is added here.
    expect(RESERVED_FUNNEL_SLUGS.has("admin")).toBe(true)
    expect(RESERVED_FUNNEL_SLUGS.has("go")).toBe(true)
  })
})

describe("updateFunnelSchema", () => {
  it("accepts kind so Convert to funnel can PATCH it", () => {
    // MUTANT KILLED: forgetting kind here — Convert would 400 with a generic
    // "Invalid request" and no clue which field was refused.
    expect(updateFunnelSchema.safeParse({ kind: "funnel" }).success).toBe(true)
  })

  it("accepts goal so a page's purpose can be changed later", () => {
    expect(updateFunnelSchema.safeParse({ goal: "event" }).success).toBe(true)
  })
})
