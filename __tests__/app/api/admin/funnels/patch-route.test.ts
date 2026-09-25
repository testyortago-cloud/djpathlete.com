// __tests__/app/api/admin/funnels/patch-route.test.ts
//
// THE DEFECT THIS FILE EXISTS FOR: `funnel-publish-route.test.ts` documents
// that taking a funnel live used to be `PATCH /api/admin/funnels/[id]` with
// `{status:"published"}`, which validated the body and wrote — never looking
// at the funnel's steps. `POST .../publish` replaced that for the UI, but the
// UI switching doorways is not a guard: a direct PATCH to this route skipped
// every gate the UI now runs, same shape as the defect documented in
// `steps/[stepId]/publish/route.ts`'s header. This route must refuse
// `status:"published"` for a funnel itself, while still letting a landing
// page publish through the same body, and still letting unpublish/archive
// through for both kinds.
//
// EVERY TEST NAMES THE MUTANT IT KILLS.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({
  getFunnelById: vi.fn(),
  updateFunnel: vi.fn(),
  deleteFunnel: vi.fn(),
  listSteps: vi.fn(),
}))
const { NoAccessibleBusinessError } = vi.hoisted(() => ({
  NoAccessibleBusinessError: class NoAccessibleBusinessError extends Error {},
}))
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: vi.fn(),
  NoAccessibleBusinessError,
}))

import { PATCH } from "@/app/api/admin/funnels/[id]/route"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { getFunnelById, updateFunnel } from "@/lib/db/funnels"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { recordAudit } from "@/lib/audit/record"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const FUNNEL_ID = "ffffffff-1111-4222-8333-444444444444"
const ADMIN_ID = "aaaaaaaa-1111-4222-8333-444444444444"
const BUSINESS_ID = "bbbbbbbb-1111-4222-8333-444444444444"

const FUNNEL_ROW = { id: FUNNEL_ID, slug: "free-trial-week", name: "Free Trial Week", kind: "funnel", status: "draft" }
const PAGE_ROW = { id: FUNNEL_ID, slug: "coaching", name: "Coaching", kind: "page", status: "draft" }

function patch(body: unknown): Request {
  return new Request(`http://localhost/api/admin/funnels/${FUNNEL_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: FUNNEL_ID }) }

beforeEach(() => {
  vi.clearAllMocks()
  mock(auth).mockResolvedValue({ user: { id: ADMIN_ID, role: "admin" } })
  mock(canAccessAdminPath).mockResolvedValue(true)
  mock(resolveAdminTenantForRequest).mockResolvedValue({
    businessId: BUSINESS_ID,
    choices: [{ id: BUSINESS_ID, name: "Test Co", slug: "test-co" }],
    isOperator: true,
  })
  mock(getFunnelById).mockResolvedValue(FUNNEL_ROW)
  mock(updateFunnel).mockImplementation(async (_businessId: string, id: string, data: Record<string, unknown>) => ({
    ...FUNNEL_ROW,
    ...data,
  }))
})

describe("PATCH /api/admin/funnels/[id]", () => {
  it("refuses to publish a funnel directly, and writes NOTHING", async () => {
    const response = await PATCH(patch({ status: "published" }) as never, ctx as never)

    // MUTANT: checking `kind` but not returning early, falling through to the
    // write anyway. The status code alone cannot see that — only the absence
    // of the call can.
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain("publish")
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("still publishes a landing page through this route", async () => {
    mock(getFunnelById).mockResolvedValue(PAGE_ROW)

    const response = await PATCH(patch({ status: "published" }) as never, ctx as never)

    // MUTANT: refusing every `status:"published"` regardless of `kind`, which
    // would break the landing-page path this route still legitimately serves.
    expect(response.status).toBe(200)
    expect(mock(updateFunnel)).toHaveBeenCalledWith(BUSINESS_ID, FUNNEL_ID,{ status: "published" })
  })

  it("still unpublishes (drafts) a funnel through this route", async () => {
    mock(getFunnelById).mockResolvedValue({ ...FUNNEL_ROW, status: "published" })

    const response = await PATCH(patch({ status: "draft" }) as never, ctx as never)

    // MUTANT: refusing every status change on a funnel-kind row, not just
    // `"published"`. Taking something off the air has nothing to gate.
    expect(response.status).toBe(200)
    expect(mock(updateFunnel)).toHaveBeenCalledWith(BUSINESS_ID, FUNNEL_ID,{ status: "draft" })
  })

  it("still archives a funnel through this route", async () => {
    const response = await PATCH(patch({ status: "archived" }) as never, ctx as never)

    expect(response.status).toBe(200)
    expect(mock(updateFunnel)).toHaveBeenCalledWith(BUSINESS_ID, FUNNEL_ID,{ status: "archived" })
  })

  it("still renames a funnel with no status field, without reading the row", async () => {
    const response = await PATCH(patch({ name: "New name" }) as never, ctx as never)

    expect(response.status).toBe(200)
    // MUTANT: reading `getFunnelById` unconditionally instead of only when
    // `status === "published"` is present. A rename has no status to gate, so
    // a route that fetches anyway would 404 a funnel someone renamed in the
    // same request a lookup failed for no reason tied to the write it made.
    expect(mock(getFunnelById)).not.toHaveBeenCalled()
    expect(mock(updateFunnel)).toHaveBeenCalledWith(BUSINESS_ID, FUNNEL_ID,{ name: "New name" })
  })

  it("404s publishing a funnel id that no longer exists, and writes nothing", async () => {
    mock(getFunnelById).mockResolvedValue(null)

    const response = await PATCH(patch({ status: "published" }) as never, ctx as never)

    expect(response.status).toBe(404)
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("refuses a non-admin", async () => {
    mock(canAccessAdminPath).mockResolvedValue(false)
    const response = await PATCH(patch({ status: "published" }) as never, ctx as never)
    expect(response.status).toBe(403)
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // `kind` NEVER CHANGES THROUGH THIS ROUTE. Until 2026-08-31 it accepted
  // `{kind:"funnel"}` for the Convert-to-funnel dialog, which made `kind` a
  // door in the publish guard (demote to "page", then publish ungated).
  //
  // Conversion came BACK on 2026-09-08 — `POST /api/admin/funnels/[id]/convert`
  // moves a row between the two boards from either card — so the reason this
  // refusal stays is no longer "the concepts never cross". It is that the
  // convert route runs guards this one cannot (exactly one step for
  // funnel → page), and letting `kind` ride in on a PATCH would put the
  // conversion and the publish in one handler again.
  // -------------------------------------------------------------------------

  it("refuses a kind change in either direction, and writes NOTHING", async () => {
    // MUTANT: deleting the raw-body `"kind" in body` check. The schema no
    // longer parses `kind`, so without the check Zod STRIPS the field and the
    // route answers 200 for a conversion that silently did not happen — the
    // worst possible answer for a caller that still believes in convert.
    for (const kind of ["funnel", "page"]) {
      const response = await PATCH(patch({ kind }) as never, ctx as never)
      expect(response.status).toBe(400)
      const body = await response.json()
      // Pins the REASON, not just a 400: the refusal must send the caller to
      // the convert action, because that action exists. MUTANT: restoring the
      // old "Neither converts into the other." message, which has been false
      // since 2026-09-08 and tells an owner a supported operation is
      // impossible.
      expect(body.error).toMatch(/convert/i)
      expect(body.error).not.toMatch(/neither converts/i)
    }
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
    // The refusal needs no row: it is about the request, not the funnel.
    expect(mock(getFunnelById)).not.toHaveBeenCalled()
  })

  it("refuses kind even when it rides along with a publish, before any write", async () => {
    // The old two-step bypass compressed to one request. The kind refusal
    // fires first — the row is never read, nothing is written, and the
    // stored kind stays the only kind there is.
    const response = await PATCH(patch({ kind: "page", status: "published" }) as never, ctx as never)

    expect(response.status).toBe(400)
    expect(mock(updateFunnel)).not.toHaveBeenCalled()
  })

  it("still applies a kindless update untouched — the refusal is not a blanket 400", async () => {
    // PRESENCE CONTROL for the two refusals above: a body that never names
    // kind sails through, proving the check inspects the key rather than
    // refusing this route's writes wholesale.
    const response = await PATCH(patch({ description: "Updated" }) as never, ctx as never)

    expect(response.status).toBe(200)
    expect(mock(updateFunnel)).toHaveBeenCalledWith(BUSINESS_ID, FUNNEL_ID,{ description: "Updated" })
  })

  // -------------------------------------------------------------------------
  // AUDIT §4 #12: this route's audit rows carried `target_id null` and
  // `metadata {}` — the exact reason the 2026-09-11 19:50 UTC unpublish of
  // Athlete Quiz could not be tied to a row. `withAudit`'s target/metadata
  // resolvers now read the funnel row off the RESPONSE `updateFunnel`
  // returns, since that is the only place a name lives — `ctx.params` alone
  // only ever had the id.
  // -------------------------------------------------------------------------

  it("records the funnel as the audit target, and the fields/status/slug/kind as metadata", async () => {
    const response = await PATCH(patch({ status: "draft" }) as never, ctx as never)
    expect(response.status).toBe(200)

    // MUTANT: options without `target` (or without `metadata`). Either drop
    // reproduces the exact defect this task exists to close — a row with no
    // way back to the funnel it changed.
    expect(mock(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { type: "funnel", id: FUNNEL_ID, label: "Free Trial Week" },
        metadata: { fields: ["status"], status: "draft", slug: "free-trial-week", kind: "funnel" },
      }),
    )
  })

  it("still lets the real caller read the updated funnel back — the resolvers only see a clone", async () => {
    const response = await PATCH(patch({ status: "draft" }) as never, ctx as never)
    const body = await response.json()
    expect(body.funnel.status).toBe("draft")
  })

  it("falls back to an id-only target with no label when the write is refused", async () => {
    // The funnel-publish refusal answers 400 with `{error: "..."}` — no
    // `funnel` key for the resolver to read a name from.
    const response = await PATCH(patch({ status: "published" }) as never, ctx as never)
    expect(response.status).toBe(400)

    expect(mock(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ target: { type: "funnel", id: FUNNEL_ID } }),
    )
  })
})
