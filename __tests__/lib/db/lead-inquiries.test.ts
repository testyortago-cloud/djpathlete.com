import { describe, it, expect, vi, beforeEach } from "vitest"

const state: { result: { data: unknown; error: unknown }; lastInsert?: unknown; lastUpdate?: unknown } = {
  result: { data: null, error: null },
}

function makeBuilder() {
  const single = vi.fn(() => Promise.resolve(state.result))
  const maybeSingle = vi.fn(() => Promise.resolve(state.result))
  const limit = vi.fn(() => ({ maybeSingle }))
  const order = vi.fn(() => ({ limit }))
  const eqAfterSelect = vi.fn(() => ({ order, single }))
  return {
    insert: vi.fn((payload: unknown) => {
      state.lastInsert = payload
      return { select: vi.fn(() => ({ single })) }
    }),
    update: vi.fn((payload: unknown) => {
      state.lastUpdate = payload
      return { eq: vi.fn(() => ({ select: vi.fn(() => ({ single })) })) }
    }),
    select: vi.fn(() => ({ eq: eqAfterSelect })),
  }
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: vi.fn(() => makeBuilder()) }),
}))

import {
  createLeadInquiry,
  updateLeadInquiryAiFields,
  getLeadInquiryByUserId,
  getLeadInquiryById,
} from "@/lib/db/lead-inquiries"

beforeEach(() => {
  state.result = { data: { id: "li-1" }, error: null }
  state.lastInsert = undefined
  state.lastUpdate = undefined
})

describe("createLeadInquiry", () => {
  it("inserts the raw submission fields", async () => {
    await createLeadInquiry({
      lead_user_id: "user-1",
      name: "Logan Scalzo",
      email: "logan@example.com",
      phone: "7868311665",
      service: "in_person",
      sport: "Baseball",
      experience: null,
      goals: "Get faster",
      injuries: null,
      how_heard: null,
      gclid: null,
    })
    expect(state.lastInsert).toMatchObject({ name: "Logan Scalzo", service: "in_person" })
  })

  it("throws on error", async () => {
    state.result = { data: null, error: { message: "boom" } }
    await expect(
      createLeadInquiry({
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
      }),
    ).rejects.toBeTruthy()
  })
})

describe("updateLeadInquiryAiFields", () => {
  it("updates the AI-generated fields", async () => {
    await updateLeadInquiryAiFields("li-1", {
      ai_priority: "high",
      ai_priority_reason: "Clear goals",
      ai_summary: "Summary",
      ai_draft_reply: "Draft",
      ai_generation_log_id: "log-1",
      ai_generated_at: "2026-07-15T00:00:00.000Z",
    })
    expect(state.lastUpdate).toMatchObject({ ai_priority: "high", ai_generation_log_id: "log-1" })
  })
})

describe("getLeadInquiryByUserId", () => {
  it("returns the most recent row for the user", async () => {
    state.result = { data: { id: "li-1", lead_user_id: "user-1" }, error: null }
    const row = await getLeadInquiryByUserId("user-1")
    expect(row?.id).toBe("li-1")
  })
})

describe("getLeadInquiryById", () => {
  it("returns the row", async () => {
    state.result = { data: { id: "li-1" }, error: null }
    const row = await getLeadInquiryById("li-1")
    expect(row.id).toBe("li-1")
  })
})
