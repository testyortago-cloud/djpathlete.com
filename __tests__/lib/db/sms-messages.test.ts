import { describe, it, expect, vi, beforeEach } from "vitest"

const eq = vi.fn()
const mockFrom = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: mockFrom }),
}))

import {
  insertSmsMessage,
  getSmsThread,
  listSmsThreads,
  updateSmsStatusBySid,
  recentOutboundExists,
} from "@/lib/db/sms-messages"

const BIZ = "11111111-1111-1111-1111-111111111111"

beforeEach(() => {
  vi.resetAllMocks()
})

describe("insertSmsMessage", () => {
  it("writes the row and returns its id", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "m1" }, error: null })
    const insert = vi.fn().mockReturnValue({ select: () => ({ single }) })
    mockFrom.mockReturnValue({ insert })

    const res = await insertSmsMessage({
      businessId: BIZ, phone: "+15551230000", direction: "inbound", body: "hi",
    })

    expect(res).toEqual({ id: "m1" })
    expect(mockFrom).toHaveBeenCalledWith("sms_messages")
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: BIZ, phone: "+15551230000", direction: "inbound", body: "hi",
        contact_id: null,
      }),
    )
  })

  it("throws rather than returning a success shape when the write fails", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "boom", code: "42P01" } })
    mockFrom.mockReturnValue({ insert: () => ({ select: () => ({ single }) }) })

    await expect(
      insertSmsMessage({ businessId: BIZ, phone: "+1555", direction: "outbound", body: "x" }),
    ).rejects.toThrow(/boom/)
  })
})

describe("getSmsThread", () => {
  it("scopes the read to the tenant AND the phone, oldest first", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null })
    const eqPhone = vi.fn().mockReturnValue({ order })
    const eqBiz = vi.fn().mockReturnValue({ eq: eqPhone })
    mockFrom.mockReturnValue({ select: () => ({ eq: eqBiz }) })

    await getSmsThread("+15551230000", BIZ)

    // Mutating either VALUE must fail this test — an argument-blind mock
    // tolerates a wrong-tenant predicate.
    expect(eqBiz).toHaveBeenCalledWith("business_id", BIZ)
    expect(eqPhone).toHaveBeenCalledWith("phone", "+15551230000")
    expect(order).toHaveBeenCalledWith("occurred_at", { ascending: true })
  })
})

describe("updateSmsStatusBySid", () => {
  it("reports unknown_message when no row carries that sid", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const eqSid = vi.fn().mockReturnValue({ maybeSingle })
    mockFrom.mockReturnValue({ select: () => ({ eq: eqSid }) })

    const out = await updateSmsStatusBySid("SMnope", "delivered")

    expect(out).toBe("unknown_message")
    expect(eqSid).toHaveBeenCalledWith("twilio_sid", "SMnope")
  })

  it("an ordinary forward transition (sent -> delivered) writes the raw status verbatim", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "m1", status: "sent" }, error: null })
    const select = vi.fn().mockResolvedValue({ data: [{ id: "m1" }], error: null })
    const update = vi.fn().mockReturnValue({ eq: () => ({ neq: () => ({ select }) }) })
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }), update })

    expect(await updateSmsStatusBySid("SM1", "delivered")).toBe("updated")
    expect(update).toHaveBeenCalledWith({ status: "delivered" })
  })

  // Monotonic, mirroring applyDeliveryStatus (lib/db/sequences.ts): a
  // failed/undelivered callback landing after delivered is a stale,
  // superseded report and must not regress the row.
  it("a failed callback arriving AFTER delivered leaves the row delivered", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "m1", status: "delivered" }, error: null })
    const update = vi.fn()
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }), update })

    const out = await updateSmsStatusBySid("SM1", "failed", "30006")

    expect(out).toBe("ignored")
    expect(update).not.toHaveBeenCalled()
  })

  // A late delivery beats an earlier pessimistic report — the one direction
  // a "delivered" callback IS allowed to overwrite.
  it("a delivered callback arriving after failed DOES set it to delivered", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "m1", status: "failed" }, error: null })
    const select = vi.fn().mockResolvedValue({ data: [{ id: "m1" }], error: null })
    const update = vi.fn().mockReturnValue({ eq: () => ({ neq: () => ({ select }) }) })
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }), update })

    expect(await updateSmsStatusBySid("SM1", "delivered")).toBe("updated")
    expect(update).toHaveBeenCalledWith({ status: "delivered" })
  })

  // A stale, ignored callback carries no new information at all — that
  // includes the code explaining why it (supposedly) failed. `update` must
  // never be reached for it, so neither field can sneak through.
  it("a stale failed callback does not write its error_code onto a delivered row", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "m1", status: "delivered" }, error: null })
    const update = vi.fn()
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }), update })

    const out = await updateSmsStatusBySid("SM1", "failed", "30006")

    expect(out).toBe("ignored")
    expect(update).not.toHaveBeenCalled()
  })

  it("reports ignored (not a lying 'updated') when the write race loses to a concurrent delivery", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "m1", status: "sent" }, error: null })
    // The neq("status", "delivered") guard blocks the write at the DB, so it
    // matches zero rows even though the read above thought the row was
    // still "sent" — the row was delivered by a concurrent callback in
    // between.
    const select = vi.fn().mockResolvedValue({ data: [], error: null })
    const update = vi.fn().mockReturnValue({ eq: () => ({ neq: () => ({ select }) }) })
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }), update })

    expect(await updateSmsStatusBySid("SM1", "failed")).toBe("ignored")
  })
})

describe("listSmsThreads", () => {
  it("collapses many messages into one row per phone, newest first", async () => {
    const rows = [
      { phone: "+1999", contact_id: null, body: "newest", direction: "inbound",
        occurred_at: "2026-09-10T10:00:00Z", status: "received", contacts: null },
      { phone: "+1888", contact_id: "c1", body: "older", direction: "outbound",
        occurred_at: "2026-09-09T10:00:00Z", status: "delivered",
        contacts: { name: "Jane" } },
      { phone: "+1999", contact_id: null, body: "oldest", direction: "outbound",
        occurred_at: "2026-09-08T10:00:00Z", status: "delivered", contacts: null },
    ]
    const order = vi.fn().mockResolvedValue({ data: rows, error: null })
    const eqBiz = vi.fn().mockReturnValue({ order })
    mockFrom.mockReturnValue({ select: () => ({ eq: eqBiz }) })

    const threads = await listSmsThreads(BIZ)

    expect(eqBiz).toHaveBeenCalledWith("business_id", BIZ)
    expect(threads).toHaveLength(2)
    expect(threads[0]).toMatchObject({
      phone: "+1999", lastBody: "newest", messageCount: 2, inboundCount: 1,
    })
    expect(threads[1]).toMatchObject({ phone: "+1888", contactName: "Jane", messageCount: 1 })
  })
})

describe("recentOutboundExists", () => {
  it("scopes the check to tenant, phone, direction and the lookback window", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ id: "m1" }], error: null })
    const gte = vi.fn().mockReturnValue({ limit })
    const eqDirection = vi.fn().mockReturnValue({ gte })
    const eqPhone = vi.fn().mockReturnValue({ eq: eqDirection })
    const eqBiz = vi.fn().mockReturnValue({ eq: eqPhone })
    mockFrom.mockReturnValue({ select: () => ({ eq: eqBiz }) })

    const out = await recentOutboundExists("+15551230000", BIZ, 30)

    expect(out).toBe(true)
    expect(mockFrom).toHaveBeenCalledWith("sms_messages")
    // Mutating any one of these VALUES must fail this test.
    expect(eqBiz).toHaveBeenCalledWith("business_id", BIZ)
    expect(eqPhone).toHaveBeenCalledWith("phone", "+15551230000")
    expect(eqDirection).toHaveBeenCalledWith("direction", "outbound")
    expect(gte).toHaveBeenCalledTimes(1)
    expect(gte.mock.calls[0][0]).toBe("occurred_at")
    expect(limit).toHaveBeenCalledWith(1)
  })

  it("returns false when no recent outbound row is found", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null })
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ limit }) }) }) }) }),
    })

    expect(await recentOutboundExists("+1555", BIZ)).toBe(false)
  })

  it("throws rather than returning false when the query errors", async () => {
    const limit = vi.fn().mockResolvedValue({ data: null, error: { message: "boom", code: "500" } })
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ limit }) }) }) }) }),
    })

    // "the read broke" and "we have not texted them" must never look the
    // same — a false answer here would silently mis-append (or omit) the
    // legal opt-out sentence.
    await expect(recentOutboundExists("+1555", BIZ)).rejects.toThrow(/boom/)
  })
})
