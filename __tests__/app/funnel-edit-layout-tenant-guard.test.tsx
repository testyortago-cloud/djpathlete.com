// __tests__/app/funnel-edit-layout-tenant-guard.test.tsx
//
// WHOLE-BRANCH REVIEW ITEM 4: `FunnelBuilderShell` called `resolveAdminTenant()`
// unguarded, so a caller with no accessible business hit an uncaught
// `NoAccessibleBusinessError` and rendered the framework's 500 page instead of
// the notFound() every other admin-gated funnel screen answers with. The two
// draft-preview routes already catch it; this pins the builder's own shell
// doing the same.
//
// `__tests__/app/funnel-edit-layout-draft-jobs.test.tsx` covers this same
// component's draftJobs composition and deliberately keeps tenancy fixed to
// one business — this file is the tenancy claim on its own.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("@/lib/db/funnels", () => ({ getFunnelById: vi.fn(), listSteps: vi.fn() }))
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

import { FunnelBuilderShell } from "@/app/(admin)/admin/funnels/[id]/edit/layout"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { getFunnelById } from "@/lib/db/funnels"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

describe("the funnel builder shell's tenant guard", () => {
  it("404s rather than 500ing when the caller has no accessible business", async () => {
    // MUTANT: letting resolveAdminTenant's NoAccessibleBusinessError escape
    // uncaught, reproducing the 500 page this task exists to close. Note this
    // is NOT the "funnel that cannot be read renders children alone" fallback
    // this component otherwise uses — there is no businessId to even attempt
    // that read with.
    mock(resolveAdminTenant).mockRejectedValue(new NoAccessibleBusinessErrorMock())

    await expect(FunnelBuilderShell({ id: "f1", children: null })).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mock(getFunnelById)).not.toHaveBeenCalled()
  })

  it("still lets any OTHER resolution failure through uncaught — the catch is narrow", async () => {
    // PRESENCE CONTROL: a catch-all here would swallow a real database error
    // as a 404, which is the wrong lie to tell about an infrastructure fault.
    mock(resolveAdminTenant).mockRejectedValue(new Error("db exploded"))

    await expect(FunnelBuilderShell({ id: "f1", children: null })).rejects.toThrow("db exploded")
  })
})
