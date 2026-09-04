// @vitest-environment node
//
// __tests__/app/admin/detail-page-tenancy.test.tsx
//
// The two [id] pages — the ONLY entry points where a UUID is typed by hand, and
// therefore the two the whole coach-reachability change is riskiest for.
//
// These had no direct coverage. Reverting
// app/(admin)/admin/chat/[id]/page.tsx to the unscoped `getConversation(id)`
// it shipped with — the exact pre-change shape — left 196/196 tests green
// across every suite the branch touches. __tests__/lib/db/coach-scoped-reads.test.ts
// proves getConversation HONOURS a businessId when handed one; nothing proved
// the page HANDS it one. Those are different claims, and only the second is
// what stops a coach reading another coach's records by guessing an id.
//
// Server components invoked directly, per __tests__/app/admin/chat-page-tenancy.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest"

class NotFoundError extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("NEXT_NOT_FOUND")
  },
}))
// currentActor too: the page asks canAccessPath whether THIS viewer may use
// the "add to a sequence" action, so an unmocked currentActor reaches the
// real auth() and throws "headers was called outside a request scope".
vi.mock("@/lib/permissions/guard", () => ({ requirePermission: vi.fn(), currentActor: vi.fn() }))
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenant: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/chat", () => ({ getConversation: vi.fn(), listMessages: vi.fn() }))
vi.mock("@/lib/db/contact-detail", () => ({ getContactById: vi.fn(), getContactDetail: vi.fn() }))
vi.mock("@/lib/db/sequences", () => ({ listSequences: vi.fn() }))

import { currentActor, requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { recordAudit } from "@/lib/audit/record"
import { getConversation, listMessages } from "@/lib/db/chat"
import { getContactById, getContactDetail } from "@/lib/db/contact-detail"
import { listSequences } from "@/lib/db/sequences"
import ChatTranscriptPage from "@/app/(admin)/admin/chat/[id]/page"
import ContactDetailPage from "@/app/(admin)/admin/contacts/[id]/page"

const SINGLETON = "00000000-0000-0000-0000-000000000001"
/**
 * The caller's tenant. Deliberately NOT the singleton: every one of these
 * reads DEFAULTS or previously fell to it, so a fixture equal to it would be
 * satisfied by the very bug being asserted against.
 */
const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"
const SUBJECT_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"

const params = (id: string = SUBJECT_ID) => Promise.resolve({ id })

beforeEach(() => {
  vi.resetAllMocks()
  ;(requirePermission as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "staff" } })
  ;(currentActor as ReturnType<typeof vi.fn>).mockResolvedValue({ role: "admin", permissions: {} })
  ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
    businessId: BUSINESS_ID,
    choices: [],
    isOperator: false,
  })
  ;(recordAudit as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
})

describe("the chat transcript page", () => {
  beforeEach(() => {
    // Every field the page's JSX reads. An incomplete fixture throws inside
    // render, which fails the test BEFORE its assertion runs and reads as a
    // scoping failure rather than as a fixture gap.
    ;(getConversation as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: SUBJECT_ID,
      created_at: "2026-09-01T00:00:00.000Z",
      escalated_at: null,
      captured_at: null,
      landing_path: "/services",
      tokens_used: 1240,
    })
    ;(listMessages as ReturnType<typeof vi.fn>).mockResolvedValue([])
  })

  it("guards on the `contacts` permission", async () => {
    await ChatTranscriptPage({ params: params() })
    expect(requirePermission).toHaveBeenCalledWith("contacts")
  })

  it("reads the conversation in the RESOLVED tenant, not unscoped", async () => {
    // MUTANT: `getConversation(id)` — the shape this page shipped with. `id`
    // comes straight from the URL bar, so unscoped it returns whichever
    // business's conversation carries that UUID. A transcript is visitor-typed
    // prose: people put their own name, their child's name, their injury and
    // their phone number in one without being asked.
    await ChatTranscriptPage({ params: params() })
    expect(getConversation).toHaveBeenCalledWith(SUBJECT_ID, BUSINESS_ID)
    const [, passed] = (getConversation as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(passed).not.toBeUndefined()
    expect(passed).not.toBe(SINGLETON)
  })

  it("404s a conversation in another tenant, and audits nothing", async () => {
    // The scoped read answers null for "no such row" and "another business's
    // row" alike. Auditing a 404 would put rows in audit_logs for transcripts
    // nobody ever saw — the page's own header states this rule.
    ;(getConversation as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await expect(ChatTranscriptPage({ params: params() })).rejects.toBeInstanceOf(NotFoundError)
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("records the sensitive read once the conversation IS found", async () => {
    // Presence control for the assertion above: without it, a page that never
    // audited anything would pass the "did not audit" test just as well.
    await ChatTranscriptPage({ params: params() })
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "chat.transcript_viewed", category: "admin_read_sensitive" }),
    )
  })
})

describe("the contact record page", () => {
  beforeEach(() => {
    ;(getContactById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: SUBJECT_ID,
      business_id: BUSINESS_ID,
      name: "Rosa Marchetti",
      email: "rosa@example.com",
      phone_e164: null,
    })
    ;(getContactDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      contact: { id: SUBJECT_ID },
      timeline: [],
      consents: [],
      suppressions: [],
      runs: [],
      tags: [],
    })
    ;(listSequences as ReturnType<typeof vi.fn>).mockResolvedValue([])
  })

  it("guards on the `contacts` permission", async () => {
    await ContactDetailPage({ params: params() })
    expect(requirePermission).toHaveBeenCalledWith("contacts")
  })

  it("reads the contact in the RESOLVED tenant", async () => {
    await ContactDetailPage({ params: params() })
    expect(getContactById).toHaveBeenCalledWith(SUBJECT_ID, BUSINESS_ID)
    const [, passed] = (getContactById as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(passed).not.toBe(SINGLETON)
  })

  it("offers the SAME tenant's sequences, not the platform's", async () => {
    // The header's "Add to a sequence" picker. Scoped with the same businessId
    // as the contact read directly above it — a coach offered the platform's
    // sequences would be picking from a list that is not theirs.
    await ContactDetailPage({ params: params() })
    expect(listSequences).toHaveBeenCalledWith(BUSINESS_ID)
  })

  it("hides the enrol action from a coach, and keeps it for the operator", async () => {
    // /api/admin/sequences/enrol is NOT in PATH_PERMISSIONS and its handler
    // still requires role === "admin", so for a coach that button 403s twice
    // over. Rendering it anyway is the "page is scoped, button is not" failure
    // — a control that always refuses reads as a broken app, not a boundary.
    //
    // Both directions asserted: an absence assertion with no presence control
    // passes just as well when nothing rendered at all.
    ;(currentActor as ReturnType<typeof vi.fn>).mockResolvedValue({
      role: "staff",
      permissions: { contacts: true },
    })
    const coachView = await ContactDetailPage({ params: params() })
    expect((coachView as { props: { canEnrol: boolean } }).props.canEnrol).toBe(false)

    ;(currentActor as ReturnType<typeof vi.fn>).mockResolvedValue({ role: "admin", permissions: {} })
    const operatorView = await ContactDetailPage({ params: params() })
    expect((operatorView as { props: { canEnrol: boolean } }).props.canEnrol).toBe(true)
  })

  it("404s a contact in another tenant, and audits nothing", async () => {
    ;(getContactById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await expect(ContactDetailPage({ params: params() })).rejects.toBeInstanceOf(NotFoundError)
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("records the sensitive read once the contact IS found", async () => {
    await ContactDetailPage({ params: params() })
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "contact.viewed", category: "admin_read_sensitive" }),
    )
  })
})
