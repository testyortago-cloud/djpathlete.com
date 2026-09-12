// @vitest-environment node
//
// __tests__/app/admin/sms-list-page-tenancy.test.tsx — app/(admin)/admin/sms/page.tsx
//
// THE PERMISSION KEY IS THE POINT OF THE FIRST TEST. `/admin/messages` already
// exists — the coach-to-client in-app chat, owned by the `messages` key — and
// `requirePermission("messages")` here would compile, would redirect somebody,
// and would gate this screen on an unrelated grant: a coach holding `contacts`
// but not `messages` would be bounced off the texts belonging to their own
// contacts, and anyone holding `messages` would be let in. Nothing else in the
// suite can see that, so this assertion is the whole coverage for it.
//
// NO RENDER. `AdminSmsPage` is an async server component; this calls it
// directly and inspects what its mocked dependencies were called with — the
// same shape as __tests__/app/admin/contacts-page-tenancy.test.tsx.
// `SmsThreadList` is mocked to a no-op so importing it does not pull its own
// dependency tree into a node-environment suite.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/permissions/guard", () => ({ requirePermission: vi.fn() }))
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenant: vi.fn() }))
vi.mock("@/lib/db/sms-messages", () => ({ listSmsThreads: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
vi.mock("@/components/admin/sms/SmsThreadList", () => ({ SmsThreadList: () => null }))

import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { listSmsThreads } from "@/lib/db/sms-messages"
import { getBusinessSettings } from "@/lib/db/businesses"
import AdminSmsPage from "@/app/(admin)/admin/sms/page"

const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"

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
  ;(listSmsThreads as ReturnType<typeof vi.fn>).mockResolvedValue({ threads: [], countsTruncated: false })
  ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
    timezone: "America/New_York",
  })
})

describe("AdminSmsPage", () => {
  it("guards on the `contacts` permission, not `messages`", async () => {
    // MUTANT: requirePermission("messages") — the in-app chat's key, which is
    // a different screen owned by a different grant.
    await AdminSmsPage()
    expect(requirePermission).toHaveBeenCalledWith("contacts")
  })

  it("scopes the thread read to the resolved tenant", async () => {
    // MUTANT: listSmsThreads() with no argument. A reader with no tenant
    // predicate is a leak with a fuse in it, and texts are the most private
    // thing in this product.
    await AdminSmsPage()
    expect(listSmsThreads).toHaveBeenCalledWith(BUSINESS_ID)
  })

  it("does not swallow a failed read into an empty list", async () => {
    // "The query broke" and "nobody has texted you" must not look the same.
    ;(listSmsThreads as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"))
    await expect(AdminSmsPage()).rejects.toThrow("boom")
  })
})
