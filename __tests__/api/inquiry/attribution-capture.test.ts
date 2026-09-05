// @vitest-environment node
//
// Pinned to node: the default jsdom environment crashes on worker start
// in this repo (ERR_REQUIRE_ESM in html-encoding-sniffer), and reports as
// "Test Files no tests" rather than a failure. Without this line the suite
// silently runs nothing.
import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Regression cover for the break that made Google Ads unmeasurable: the ad
 * landing pages (/online, /in-person) submit through /api/inquiry, which read
 * gclid from a browser cookie and never claimed the attribution row. In
 * production that produced 337 Google-Ads sessions and 0 attributed signups.
 */

const createLeadInquiryMock = vi.fn()
const getAttributionBySessionMock = vi.fn()
const claimAttributionMock = vi.fn()
const usersInsertSingleMock = vi.fn()

vi.mock("@/lib/db/lead-inquiries", () => ({
  createLeadInquiry: (...a: unknown[]) => createLeadInquiryMock(...a),
  updateLeadInquiryAiFields: vi.fn(),
}))
vi.mock("@/lib/db/marketing-attribution", () => ({
  getAttributionBySession: (...a: unknown[]) => getAttributionBySessionMock(...a),
  claimAttribution: (...a: unknown[]) => claimAttributionMock(...a),
}))
vi.mock("@/lib/ghl", () => ({
  ghlCreateContact: vi.fn().mockResolvedValue({ id: "ghl-1" }),
  ghlTriggerWorkflow: vi.fn(),
}))
vi.mock("@/lib/email", () => ({
  sendInquiryEmail: vi.fn(),
  sendInquiryAutoReply: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/audit/with-audit", () => ({
  withAudit: (_cfg: unknown, handler: unknown) => handler,
}))
// AI enrichment is opt-in downstream of the inquiry row; keep it inert.
vi.mock("@/lib/ai/lead-analysis", () => ({ generateLeadAnalysis: vi.fn() }))
vi.mock("@/lib/db/ai-generation-log", () => ({
  createGenerationLog: vi.fn(),
  updateGenerationLog: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null }) }),
            // admin lookup for notifications
            then: undefined,
          }),
          insert: () => ({ select: () => ({ single: usersInsertSingleMock }) }),
          update: () => ({ eq: async () => ({}) }),
        }
      }
      return {
        insert: async () => ({ error: null }),
        select: () => ({ eq: async () => ({ data: [] }) }),
      }
    },
  }),
}))
// The route resolves its tenant from the request's Host through the ONE Host
// boundary (lib/tenancy/public.ts). Mocked to a sentinel that is not the
// platform's, so a route that hard-codes platformBusinessId() cannot pass.
// Without this mock the real boundary calls headers() from next/headers,
// which throws outside a request scope.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))

import { POST } from "@/app/api/inquiry/route"

const VALID_BODY = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  service: "in_person",
  goals: "Return to sprinting after a hamstring strain this season.",
  how_heard: "Google",
}

function req(body: Record<string, unknown>, cookie?: string) {
  return new Request("http://test/api/inquiry", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

// The route's `admins` lookup uses `.select().eq()` which our stub resolves to
// `{ data: [] }`; no admin notifications are asserted here.
async function post(body: Record<string, unknown>, cookie?: string) {
  return POST(req(body, cookie) as never, { params: Promise.resolve({}) } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  usersInsertSingleMock.mockResolvedValue({ data: { id: "lead-user-1" }, error: null })
  createLeadInquiryMock.mockResolvedValue({ id: "inquiry-1" })
  claimAttributionMock.mockResolvedValue(undefined)
  getAttributionBySessionMock.mockResolvedValue(null)
})

describe("POST /api/inquiry — Google Ads attribution", () => {
  it("stores the gbraid from the attribution row even though the form can only send gclid", async () => {
    // iOS/privacy traffic: Google issues gbraid and no gclid at all, so the
    // cookie the form reads is necessarily empty.
    getAttributionBySessionMock.mockResolvedValue({
      id: "attr-1",
      gclid: null,
      gbraid: "0AAAABDjdNeW6l7bSPnysgnL6bXi6V1fM3",
      wbraid: null,
      fbclid: null,
      claimed_at: null,
    })

    const res = await post(VALID_BODY, "djp_attr=sess-abc")
    expect(res.status).toBe(200)

    expect(getAttributionBySessionMock).toHaveBeenCalledWith("sess-abc")
    expect(createLeadInquiryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gclid: null,
        gbraid: "0AAAABDjdNeW6l7bSPnysgnL6bXi6V1fM3",
      }),
    )
  })

  it("claims the attribution row for the lead user it created", async () => {
    getAttributionBySessionMock.mockResolvedValue({
      id: "attr-1",
      gclid: "CjwKCAjw-gclid",
      gbraid: null,
      wbraid: null,
      fbclid: null,
      claimed_at: null,
    })

    const res = await post(VALID_BODY, "djp_attr=sess-abc")
    expect(res.status).toBe(200)
    expect(claimAttributionMock).toHaveBeenCalledWith("attr-1", "lead-user-1")
  })

  it("prefers the server-side gclid over the one the client submitted", async () => {
    // A stale 90-day cookie can outlive the campaign that set it; the
    // attribution row is the record we actually wrote at click time.
    getAttributionBySessionMock.mockResolvedValue({
      id: "attr-1",
      gclid: "server-side-truth",
      gbraid: null,
      wbraid: null,
      fbclid: null,
      claimed_at: null,
    })

    await post({ ...VALID_BODY, gclid: "stale-cookie-value" }, "djp_attr=sess-abc")

    expect(createLeadInquiryMock).toHaveBeenCalledWith(
      expect.objectContaining({ gclid: "server-side-truth" }),
    )
  })

  it("falls back to the submitted gclid when the attribution row is gone", async () => {
    getAttributionBySessionMock.mockResolvedValue(null)

    await post({ ...VALID_BODY, gclid: "cookie-only" }, "djp_attr=sess-abc")

    expect(createLeadInquiryMock).toHaveBeenCalledWith(
      expect.objectContaining({ gclid: "cookie-only", gbraid: null }),
    )
    expect(claimAttributionMock).not.toHaveBeenCalled()
  })

  it("does not re-claim an already-claimed attribution row", async () => {
    getAttributionBySessionMock.mockResolvedValue({
      id: "attr-1",
      gclid: "g",
      gbraid: null,
      wbraid: null,
      fbclid: null,
      claimed_at: "2026-08-01T00:00:00Z",
    })

    await post(VALID_BODY, "djp_attr=sess-abc")
    expect(claimAttributionMock).not.toHaveBeenCalled()
  })

  it("submits fine with no attribution cookie at all", async () => {
    const res = await post(VALID_BODY)
    expect(res.status).toBe(200)
    expect(getAttributionBySessionMock).not.toHaveBeenCalled()
    expect(createLeadInquiryMock).toHaveBeenCalledWith(
      expect.objectContaining({ gclid: null, gbraid: null, wbraid: null, fbclid: null }),
    )
  })

  it("still records the inquiry when the attribution read throws", async () => {
    getAttributionBySessionMock.mockRejectedValue(new Error("db down"))

    const res = await post(VALID_BODY, "djp_attr=sess-abc")
    expect(res.status).toBe(200)
    expect(createLeadInquiryMock).toHaveBeenCalled()
  })
})
