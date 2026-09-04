// @vitest-environment node
//
// __tests__/app/admin/chat-page-tenancy.test.tsx
//
// Server component invoked directly, per __tests__/app/admin/campaign-revenue-page.test.tsx.
//
// This is Task 9's admin surface: /admin/chat reads listChatConversations and
// countChatConversations, both of which now take a required businessId. The
// page must resolve it from resolveAdminTenant() -- the layout above it
// already catches NoAccessibleBusinessError and redirects, so this page needs
// no try/catch of its own, matching app/(admin)/admin/funnels/quizzes/[id]/page.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth-helpers", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/chat", () => ({
  listChatConversations: vi.fn(),
  countChatConversations: vi.fn(),
  parseChatFilters: vi.fn(),
}))
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenant: vi.fn() }))

import { requireAdmin } from "@/lib/auth-helpers"
import { listChatConversations, countChatConversations, parseChatFilters } from "@/lib/db/chat"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import Page from "@/app/(admin)/admin/chat/page"

const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"

function searchParams(params: Record<string, string> = {}) {
  return Promise.resolve(params)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "admin" } })
  ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
    businessId: BUSINESS_ID,
    choices: [{ id: BUSINESS_ID, name: "Acme Coaching", slug: "acme" }],
    isOperator: true,
  })
  ;(parseChatFilters as ReturnType<typeof vi.fn>).mockReturnValue({ show: "all", page: 1 })
  ;(listChatConversations as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(countChatConversations as ReturnType<typeof vi.fn>).mockResolvedValue(0)
})

describe("admin chat list page", () => {
  // Asserts the VALUE passed to both reads, with a presence control — an
  // argument-blind mock would tolerate a missing or wrong businessId just as
  // happily as the right one.
  it("passes the resolved businessId through to both listChatConversations and countChatConversations", async () => {
    await Page({ searchParams: searchParams() })

    expect(listChatConversations).toHaveBeenCalledTimes(1)
    expect(countChatConversations).toHaveBeenCalledTimes(1)
    expect(listChatConversations).toHaveBeenCalledWith(expect.objectContaining({ businessId: BUSINESS_ID }))
    expect(countChatConversations).toHaveBeenCalledWith(expect.objectContaining({ businessId: BUSINESS_ID }))
  })

  it("re-scopes both reads when the resolved tenant changes", async () => {
    const OTHER_BUSINESS = "33333333-3333-3333-3333-333333333333"
    ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
      businessId: OTHER_BUSINESS,
      choices: [{ id: OTHER_BUSINESS, name: "Other Co", slug: "other" }],
      isOperator: false,
    })

    await Page({ searchParams: searchParams() })

    expect(listChatConversations).toHaveBeenCalledWith(expect.objectContaining({ businessId: OTHER_BUSINESS }))
    expect(countChatConversations).toHaveBeenCalledWith(expect.objectContaining({ businessId: OTHER_BUSINESS }))
    expect(listChatConversations).not.toHaveBeenCalledWith(expect.objectContaining({ businessId: BUSINESS_ID }))
  })

  it("propagates NoAccessibleBusinessError rather than swallowing it — the layout is what catches it", async () => {
    class NoAccessibleBusinessError extends Error {}
    ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockRejectedValue(new NoAccessibleBusinessError())

    await expect(Page({ searchParams: searchParams() })).rejects.toThrow(NoAccessibleBusinessError)
  })
})
