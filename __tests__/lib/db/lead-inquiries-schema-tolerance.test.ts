import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Migrations and Vercel deploys race on merge to main, so for one deploy
 * production can be running this code against the pre-00211 schema where
 * lead_inquiries has `gclid` but no gbraid/wbraid/fbclid. This is a
 * lead-capture form: dropping a click id is acceptable, dropping the lead is
 * not.
 */

const insertMock = vi.fn()
const singleMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: (payload: unknown) => {
        insertMock(payload)
        return { select: () => ({ single: singleMock }) }
      },
    }),
  }),
}))

import { createLeadInquiry } from "@/lib/db/lead-inquiries"

const INPUT = {
  lead_user_id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: null,
  service: "in_person",
  sport: null,
  experience: null,
  goals: "Return to sprinting.",
  injuries: null,
  how_heard: "Google",
  gclid: "the-gclid",
  gbraid: "the-gbraid",
  wbraid: null,
  fbclid: null,
} as never

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks does NOT drain a queued mockResolvedValueOnce. Without this
  // reset, a test that queues two responses but consumes one leaks the spare
  // into the next test — which is exactly how the "unrelated error" case below
  // silently stopped rejecting.
  singleMock.mockReset()
  insertMock.mockReset()
})

describe("createLeadInquiry — pre-00211 schema tolerance", () => {
  it("inserts every click id when the columns exist", async () => {
    singleMock.mockResolvedValue({ data: { id: "inq-1" }, error: null })

    const row = await createLeadInquiry(INPUT)

    expect(row).toEqual({ id: "inq-1" })
    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ gclid: "the-gclid", gbraid: "the-gbraid" }),
    )
  })

  it("retries without the new columns when PostgREST reports an unknown column", async () => {
    singleMock
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST204", message: "Could not find the 'gbraid' column of 'lead_inquiries' in the schema cache" },
      })
      .mockResolvedValueOnce({ data: { id: "inq-1" }, error: null })

    const row = await createLeadInquiry(INPUT)

    expect(row).toEqual({ id: "inq-1" })
    expect(insertMock).toHaveBeenCalledTimes(2)

    // The lead survives, and keeps the one click id the old schema can hold.
    const retried = insertMock.mock.calls[1][0] as Record<string, unknown>
    expect(retried).not.toHaveProperty("gbraid")
    expect(retried).not.toHaveProperty("wbraid")
    expect(retried).not.toHaveProperty("fbclid")
    expect(retried.gclid).toBe("the-gclid")
    expect(retried.email).toBe("ada@example.com")
  })

  it("does not retry — and surfaces — an error unrelated to the new columns", async () => {
    singleMock.mockResolvedValue({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint' },
    })

    await expect(createLeadInquiry(INPUT)).rejects.toMatchObject({ code: "23505" })
    expect(insertMock).toHaveBeenCalledTimes(1)
  })
})
