// __tests__/app/funnel-design-page-tenant-guard.test.tsx
//
// WHOLE-BRANCH REVIEW ITEM 4: this route called `resolveAdminTenant()`
// unguarded, so a caller with no accessible business (membership revoked
// mid-session, an operator-only account hitting a business-only screen, etc.)
// hit an uncaught `NoAccessibleBusinessError` and rendered the framework's 500
// page. The two draft-preview routes
// (app/(funnel)/funnel-preview/[stepId]/page.tsx,
// app/(funnel)/preview/[slug]/[[...step]]/page.tsx) already catch it and
// answer notFound() — this pins the designer route doing the same.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("@/lib/db/funnels", () => ({ getFunnelById: vi.fn(), getStep: vi.fn() }))
vi.mock("@/lib/db/funnel-page-tree", () => ({ getPageTree: vi.fn() }))
vi.mock("@/lib/db/funnel-builder", () => ({ getDraft: vi.fn() }))
// `vi.mock` factories are hoisted above every top-level statement, so a bare
// top-level `class` referenced inside one throws "Cannot access before
// initialization" — `vi.hoisted` is the escape hatch this repo standardises on.
const { NoAccessibleBusinessErrorMock } = vi.hoisted(() => ({
  NoAccessibleBusinessErrorMock: class NoAccessibleBusinessErrorMock extends Error {},
}))
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenant: vi.fn(),
  NoAccessibleBusinessError: NoAccessibleBusinessErrorMock,
}))

import DesignPage from "@/app/(admin)/admin/funnels/[id]/edit/[stepId]/design/page"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { getFunnelById } from "@/lib/db/funnels"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const params = Promise.resolve({ id: "f1", stepId: "s1" })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("the design route's tenant guard", () => {
  it("404s rather than 500ing when the caller has no accessible business", async () => {
    // MUTANT: letting resolveAdminTenant's NoAccessibleBusinessError escape
    // uncaught, reproducing the 500 page this task exists to close.
    mock(resolveAdminTenant).mockRejectedValue(new NoAccessibleBusinessErrorMock())

    await expect(DesignPage({ params })).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mock(getFunnelById)).not.toHaveBeenCalled()
  })

  it("still lets any OTHER resolution failure through uncaught — the catch is narrow", async () => {
    // PRESENCE CONTROL: a catch-all here would swallow a real database error
    // as a 404, which is the wrong lie to tell about an infrastructure fault.
    mock(resolveAdminTenant).mockRejectedValue(new Error("db exploded"))

    await expect(DesignPage({ params })).rejects.toThrow("db exploded")
  })
})
