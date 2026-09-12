// @vitest-environment node
//
// __tests__/app/admin/sms-thread-page-tenancy.test.tsx — app/(admin)/admin/sms/[phone]/page.tsx
//
// FOUR PROPERTIES, none of which any other suite can see:
//
//   1. THE PERMISSION KEY IS `contacts`, NOT `messages`. `/admin/messages` is
//      the in-app chat and owns `messages`; guarding this screen on that key
//      would compile, would redirect somebody, and would gate texts on an
//      unrelated grant.
//   2. THE PHONE IS RE-NORMALISED. It arrives URL-encoded, and `+` in a path
//      segment decodes to a SPACE. A page that queried the raw segment would
//      match zero rows for the linked form and split the thread for the typed
//      one. `%2B12025550123` and `2025550123` must reach the same query.
//   3. EVERY READ CARRIES THE TENANT. Texts are the most private thing in
//      this product; a reader with no tenant predicate is a leak with a fuse.
//   4. A FAILED READ IS NOT AN EMPTY CONVERSATION.
//
// NO RENDER — the page is an async server component, called directly, with
// its dependencies mocked. Same shape as contacts-page-tenancy.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/permissions/guard", () => ({ requirePermission: vi.fn() }))
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenant: vi.fn() }))
vi.mock("@/lib/db/sms-messages", () => ({ getSmsThread: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
vi.mock("@/lib/db/contact-detail", () => ({ getContactById: vi.fn() }))
vi.mock("@/lib/db/contact-consents", () => ({ isSuppressed: vi.fn() }))
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("@/components/admin/sms/SmsThread", () => ({ SmsThread: () => null }))
vi.mock("@/components/admin/sms/SmsComposer", () => ({ SmsComposer: () => null }))

import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { getSmsThread } from "@/lib/db/sms-messages"
import { getBusinessSettings } from "@/lib/db/businesses"
import { getContactById } from "@/lib/db/contact-detail"
import { isSuppressed } from "@/lib/db/contact-consents"
import AdminSmsThreadPage from "@/app/(admin)/admin/sms/[phone]/page"

const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"
const PHONE = "+12025550123"

function renderPage(phone: string) {
  return AdminSmsThreadPage({ params: Promise.resolve({ phone }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requirePermission as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: "u1", role: "admin" },
  })
  ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
    businessId: BUSINESS_ID,
    choices: [],
    isOperator: false,
  })
  ;(getSmsThread as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
    timezone: "America/New_York",
    quiet_hours_start: 8,
    quiet_hours_end: 21,
    sms_messaging_service_sid: "MGtest",
    sms_sender_phone: "",
  })
  ;(getContactById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(isSuppressed as ReturnType<typeof vi.fn>).mockResolvedValue(false)
})

describe("AdminSmsThreadPage", () => {
  it("guards on the `contacts` permission, not `messages`", async () => {
    await renderPage(encodeURIComponent(PHONE))
    expect(requirePermission).toHaveBeenCalledWith("contacts")
  })

  it("decodes %2B back into a + before querying", async () => {
    // MUTANT: query `rawPhone` directly. `%2B12025550123` would be looked up
    // as the literal string "%2B12025550123" and match nothing.
    await renderPage(encodeURIComponent(PHONE))
    expect(getSmsThread).toHaveBeenCalledWith(PHONE, BUSINESS_ID)
  })

  it("re-normalises a hand-typed national number onto the same thread", async () => {
    // MUTANT: skip normalisePhone. "(202) 555-0123" is the same conversation
    // as "+12025550123"; two spellings reaching two threads is the bug this
    // exists to prevent.
    await renderPage(encodeURIComponent("(202) 555-0123"))
    expect(getSmsThread).toHaveBeenCalledWith(PHONE, BUSINESS_ID)
  })

  it("scopes the suppression check to the tenant too", async () => {
    await renderPage(encodeURIComponent(PHONE))
    expect(isSuppressed).toHaveBeenCalledWith(PHONE, BUSINESS_ID)
  })

  it("scopes the contact lookup to the tenant", async () => {
    ;(getSmsThread as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "m1", contact_id: "c1", direction: "inbound", body: "hi", occurred_at: "2026-09-11T10:00:00Z" },
    ])
    await renderPage(encodeURIComponent(PHONE))
    expect(getContactById).toHaveBeenCalledWith("c1", BUSINESS_ID)
  })

  it("404s an unparseable number rather than showing an empty conversation", async () => {
    await expect(renderPage("banana")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(getSmsThread).not.toHaveBeenCalled()
  })

  it("does not swallow a failed read into an empty conversation", async () => {
    ;(getSmsThread as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"))
    await expect(renderPage(encodeURIComponent(PHONE))).rejects.toThrow("boom")
  })
})
