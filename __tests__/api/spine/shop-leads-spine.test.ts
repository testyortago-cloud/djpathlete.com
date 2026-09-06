// @vitest-environment node
//
// POST /api/shop/leads joining the contact spine. recordContactEvent is
// mocked directly (unlike newsletter-spine.test.ts) — this route has no
// enrolment proof requirement, so the lighter-weight mock keeps the
// assertions focused on the wiring itself.
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  recordContactEvent: vi.fn(),
  getProductById: vi.fn(),
  listFilesForProduct: vi.fn(),
  upsertLead: vi.fn(),
  markLeadSynced: vi.fn(),
  markLeadFailed: vi.fn(),
  addContactToAudience: vi.fn(),
  sendFreeDownloadEmail: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock("@/lib/db/contacts", () => ({
  recordContactEvent: mocks.recordContactEvent,
}))
vi.mock("@/lib/db/shop-products", () => ({
  getProductById: mocks.getProductById,
}))
vi.mock("@/lib/db/shop-product-files", () => ({
  listFilesForProduct: mocks.listFilesForProduct,
}))
vi.mock("@/lib/db/shop-leads", () => ({
  upsertLead: mocks.upsertLead,
  markLeadSynced: mocks.markLeadSynced,
  markLeadFailed: mocks.markLeadFailed,
}))
vi.mock("@/lib/shop/resend-audience", () => ({
  addContactToAudience: mocks.addContactToAudience,
}))
vi.mock("@/lib/shop/emails", () => ({
  sendFreeDownloadEmail: mocks.sendFreeDownloadEmail,
}))
vi.mock("@/lib/audit/record", () => ({
  recordAudit: mocks.recordAudit,
}))
// The route resolves its tenant from the request's Host through the ONE Host
// boundary (lib/tenancy/public.ts). Mocked to a sentinel that is not the
// platform's, so a route that hard-codes platformBusinessId() cannot pass.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))

import { POST } from "@/app/api/shop/leads/route"

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111"

function req(body: unknown, ip = "198.51.100.1") {
  return new Request("http://localhost/api/shop/leads", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SHOP_DIGITAL_ENABLED = "true"
  mocks.getProductById.mockResolvedValue({
    id: PRODUCT_ID,
    slug: "free-guide",
    name: "Free Guide",
    product_type: "digital",
    digital_is_free: true,
    digital_signed_url_ttl_seconds: 900,
  })
  mocks.listFilesForProduct.mockResolvedValue([{ id: "file-1", display_name: "Guide.pdf" }])
  mocks.upsertLead.mockResolvedValue({ id: "lead-1" })
  mocks.sendFreeDownloadEmail.mockResolvedValue(undefined)
  mocks.addContactToAudience.mockResolvedValue("resend-contact-1")
  mocks.markLeadSynced.mockResolvedValue(undefined)
  mocks.markLeadFailed.mockResolvedValue(undefined)
  mocks.recordAudit.mockResolvedValue(undefined)
  mocks.recordContactEvent.mockResolvedValue({ contactId: "contact-1", created: true, merged: false })
})

describe("POST /api/shop/leads — joins the contact spine", () => {
  it("calls recordContactEvent with source lead_magnet, the email, and product_id metadata", async () => {
    const res = await POST(req({ email: "buyer@example.com", product_id: PRODUCT_ID, website: "" }, "198.51.100.10"))
    expect(res.status).toBe(200)

    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "buyer@example.com",
        source: "lead_magnet",
        metadata: { product_id: PRODUCT_ID },
      }),
    )
  })

  it("never changes the route's response or existing writes when recordContactEvent throws", async () => {
    mocks.recordContactEvent.mockRejectedValueOnce(new Error("PGRST204 column missing"))

    const res = await POST(
      req({ email: "resilient@example.com", product_id: PRODUCT_ID, website: "" }, "198.51.100.11"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(mocks.upsertLead).toHaveBeenCalledTimes(1)
    expect(mocks.sendFreeDownloadEmail).toHaveBeenCalledTimes(1)
    expect(mocks.addContactToAudience).toHaveBeenCalledTimes(1)
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1)
  })
})

describe("POST /api/shop/leads — tenant", () => {
  it("files the contact under the business the seam names", async () => {
    const res = await POST(req({ email: "buyer@example.com", product_id: PRODUCT_ID, website: "" }, "198.51.100.77"))
    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: "host-biz" })
  })
})
