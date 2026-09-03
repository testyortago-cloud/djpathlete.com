// @vitest-environment node
//
// __tests__/app/admin/contacts-page-tenancy.test.tsx — app/(admin)/admin/contacts/page.tsx
//
// Fix round 1 review: `listSequences()` and `tagsForContacts(ids)` were both
// called with NO businessId, so both silently defaulted to
// SINGLETON_BUSINESS_ID (lib/db/sequences.ts:568, lib/db/contact-tags.ts:173).
// `tagsForContacts` merely renders empty tags for a non-singleton business,
// but `listSequences` is worse than a display bug: the dropdown would offer
// the OPERATOR's sequences to another business's coach, who could then enrol
// THIS business's contacts into one of them through the existing enrol route
// — a cross-tenant WRITE reachable from a read that forgot its scope.
//
// NO RENDER. `AdminContactsPage` is an async server component; this calls it
// directly and inspects the arguments its mocked dependencies were called
// with — the same "NO RENDER" shape as
// __tests__/app/funnel-edit-layout-draft-jobs.test.tsx. `ContactsTable` is
// mocked to a no-op so importing it does not pull in its own dependency tree.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth-helpers", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenant: vi.fn() }))
vi.mock("@/lib/db/contacts-list", () => ({
  listContacts: vi.fn(),
  countContacts: vi.fn(),
  parseContactFilters: vi.fn(() => ({ page: 1 })),
}))
vi.mock("@/lib/db/sequences", () => ({ listSequences: vi.fn() }))
vi.mock("@/lib/db/contact-tags", () => ({ tagsForContacts: vi.fn() }))
vi.mock("@/components/admin/contacts/ContactsTable", () => ({ ContactsTable: () => null }))

import { requireAdmin } from "@/lib/auth-helpers"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { listContacts, countContacts } from "@/lib/db/contacts-list"
import { listSequences } from "@/lib/db/sequences"
import { tagsForContacts } from "@/lib/db/contact-tags"
import AdminContactsPage from "@/app/(admin)/admin/contacts/page"

const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"

async function renderPage() {
  return AdminContactsPage({ searchParams: Promise.resolve({}) })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "admin" } })
  ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
    businessId: BUSINESS_ID,
    choices: [{ id: BUSINESS_ID, name: "Acme Coaching", slug: "acme" }],
    isOperator: false,
  })
  ;(listContacts as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "c1" }, { id: "c2" }])
  ;(countContacts as ReturnType<typeof vi.fn>).mockResolvedValue(2)
  ;(listSequences as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(tagsForContacts as ReturnType<typeof vi.fn>).mockResolvedValue(new Map())
})

describe("AdminContactsPage — tenancy scoping", () => {
  it("passes the resolved businessId to listSequences, not the SINGLETON default", async () => {
    // MUTANT: `listSequences()` with no argument. This is the cross-tenant
    // WRITE gap — the sequences dropdown would silently offer the operator's
    // own sequences to this business's coach.
    await renderPage()
    expect(listSequences).toHaveBeenCalledWith(BUSINESS_ID)
  })

  it("passes the resolved businessId to tagsForContacts, not the SINGLETON default", async () => {
    // MUTANT: `tagsForContacts(ids)` with only one argument. Tags render
    // silently empty for any non-singleton business.
    await renderPage()
    expect(tagsForContacts).toHaveBeenCalledWith(["c1", "c2"], BUSINESS_ID)
  })

  it("still scopes listContacts and countContacts to the resolved businessId", async () => {
    await renderPage()
    expect(listContacts).toHaveBeenCalledWith(expect.objectContaining({ businessId: BUSINESS_ID }))
    expect(countContacts).toHaveBeenCalledWith(expect.objectContaining({ businessId: BUSINESS_ID }))
  })
})
