// @vitest-environment node
//
// G45: `lead_inquiries` gains `business_id` (migration 00280). The writer
// stamps the business the public inquiry route resolved, and the by-id read
// and the AI-fields update both carry the tenant, so the admin
// regenerate-analysis route cannot read (and hand back) another business's
// applicant by id.
//
// The fake APPLIES its filters, and one id exists under BOTH businesses: only
// the business_id predicate tells the two rows apart, so a reader that drops
// it answers with whichever row comes first.

import { describe, it, expect, vi, beforeEach } from "vitest"

const A = "aaaaaaaa-0000-4000-8000-00000000000a"
const B = "bbbbbbbb-0000-4000-8000-00000000000b"
const SHARED = "cccccccc-0000-4000-8000-00000000000c"

let rows: Record<string, unknown>[] = []
let filters: { op: string; col: string; val: unknown }[] = []
let inserted: Record<string, unknown>[] = []
let failNext: { code: string; message: string } | null = null

function makeQuery() {
  const own: { col: string; val: unknown }[] = []
  let patch: Record<string, unknown> | null = null
  const match = () => rows.find((r) => own.every((f) => r[f.col] === f.val))
  const resolve = () => {
    if (failNext) {
      const error = failNext
      failNext = null
      return { data: null, error }
    }
    const row = match()
    if (row && patch) Object.assign(row, patch)
    return { data: row ? { ...row } : null, error: null }
  }
  const q: Record<string, unknown> = {
    select: () => q,
    update: (p: Record<string, unknown>) => {
      patch = p
      return q
    },
    insert: (p: Record<string, unknown>) => {
      inserted.push(p)
      return { select: () => ({ single: async () => ({ data: { id: "new-1", ...p }, error: null }) }) }
    },
    eq: (col: string, val: unknown) => {
      own.push({ col, val })
      filters.push({ op: patch ? "update" : "select", col, val })
      return q
    },
    maybeSingle: async () => resolve(),
    single: async () => {
      const out = resolve()
      if (!out.error && !out.data) return { data: null, error: { code: "PGRST116", message: "0 rows" } }
      return out
    },
  }
  return q
}

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({ from: () => makeQuery() }) }))

import { createLeadInquiry, getLeadInquiryById, updateLeadInquiryAiFields } from "@/lib/db/lead-inquiries"

const AI = {
  ai_priority: "high" as const,
  ai_priority_reason: "r",
  ai_summary: "s",
  ai_draft_reply: "d",
  ai_generation_log_id: null,
  ai_generated_at: "2026-09-27T00:00:00.000Z",
}

beforeEach(() => {
  filters = []
  inserted = []
  failNext = null
  rows = [
    { id: SHARED, business_id: B, name: "B's applicant", ai_summary: null },
    { id: SHARED, business_id: A, name: "A's applicant", ai_summary: null },
  ]
})

describe("getLeadInquiryById(businessId, id)", () => {
  it("answers with the named business's row when another business has the same id", async () => {
    expect((await getLeadInquiryById(A, SHARED))?.name).toBe("A's applicant")
    expect((await getLeadInquiryById(B, SHARED))?.name).toBe("B's applicant")
  })

  it("filters on the business_id VALUE it was given", async () => {
    await getLeadInquiryById(A, SHARED)
    expect(filters).toContainEqual({ op: "select", col: "business_id", val: A })
  })

  it("returns null, not another business's row, for an id this business does not have", async () => {
    rows = [{ id: SHARED, business_id: B, name: "B's applicant" }]
    expect(await getLeadInquiryById(A, SHARED)).toBeNull()
  })

  it("THROWS on a read error, so a timeout is not reported as 'not found'", async () => {
    failNext = { code: "57014", message: "canceling statement" }
    await expect(getLeadInquiryById(A, SHARED)).rejects.toBeTruthy()
  })
})

describe("updateLeadInquiryAiFields(businessId, id, fields)", () => {
  it("updates only the named business's row", async () => {
    await updateLeadInquiryAiFields(A, SHARED, AI)
    expect(rows.find((r) => r.business_id === A)?.ai_summary).toBe("s")
    expect(rows.find((r) => r.business_id === B)?.ai_summary).toBeNull()
    expect(filters).toContainEqual({ op: "update", col: "business_id", val: A })
  })
})

describe("createLeadInquiry stamps the business it was given", () => {
  it("writes business_id with the exact value passed", async () => {
    await createLeadInquiry({
      business_id: B,
      lead_user_id: null,
      name: "x",
      email: "x@example.com",
      phone: null,
      service: "in_person",
      sport: null,
      experience: null,
      goals: "x",
      injuries: null,
      how_heard: null,
      gclid: null,
    })
    expect(inserted[0]).toMatchObject({ business_id: B })
  })
})
