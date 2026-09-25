// __tests__/app/api/admin/funnels/patch-route-slug-conflict.test.ts
//
// WHOLE-BRANCH REVIEW ITEM 1 — the PATCH half. `updateFunnel` throws the same
// `SlugTakenError` on a rename that collides with the per-tenant unique index
// (migration 00278), and this route's catch block classified it the same
// broken way `route.ts`'s POST did: `error.message.includes("duplicate" |
// "unique")`, which does not match SlugTakenError's wording. A coach renaming
// a funnel into a slug their own tenant already uses got a bare 500 instead
// of the 409 field error `CreatePageDialog`/`CreateFunnelDialog` render.

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
import { SlugTakenError } from "@/lib/db/businesses"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const FUNNEL_ID = "ffffffff-1111-4222-8333-444444444444"
const ADMIN_ID = "aaaaaaaa-1111-4222-8333-444444444444"
const BUSINESS_ID = "bbbbbbbb-1111-4222-8333-444444444444"

const FUNNEL_ROW = { id: FUNNEL_ID, slug: "free-trial-week", name: "Free Trial Week", kind: "funnel", status: "draft" }

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
})

describe("PATCH /api/admin/funnels/[id] — duplicate slug on rename", () => {
  it("answers 409 with a field error, not a 500, when updateFunnel throws SlugTakenError", async () => {
    mock(updateFunnel).mockRejectedValue(new SlugTakenError("coaching"))

    const response = await PATCH(patch({ slug: "coaching" }) as never, ctx as never)

    // MUTANT: classifying by `error.message.includes("duplicate" | "unique")`
    // instead of `instanceof SlugTakenError`. SlugTakenError's message
    // ("The web address ... is already taken") matches neither substring.
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toBe("That slug is already in use.")
  })

  it("does not answer 500 for a plain SlugTakenError", async () => {
    mock(updateFunnel).mockRejectedValue(new SlugTakenError("coaching"))

    const response = await PATCH(patch({ slug: "coaching" }) as never, ctx as never)

    expect(response.status).not.toBe(500)
  })

  it("still answers 500 for an unrelated failure — the 409 is not a blanket catch", async () => {
    mock(updateFunnel).mockRejectedValue(new Error("connection reset"))

    const response = await PATCH(patch({ slug: "coaching" }) as never, ctx as never)

    expect(response.status).toBe(500)
  })
})
