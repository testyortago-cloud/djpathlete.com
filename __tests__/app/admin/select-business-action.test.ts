// @vitest-environment node
//
// __tests__/app/admin/select-business-action.test.ts — app/(admin)/admin/actions.ts
//
// `selectBusiness` writes the tenant cookie a client picks from
// components/admin/BusinessSwitcher.tsx. Nothing in the repo tested its
// allowed-set check before this (`grep -rn selectBusiness __tests__` returned
// nothing) -- exposure was bounded because resolveAdminTenant re-validates the
// cookie on every read and ignores a value outside the caller's own choices,
// but the guard itself was unpinned: deleting it broke no test.
//
// The refusal assertion checks that the cookie recorder is EMPTY, not just
// that the call didn't throw -- a version that always wrote the cookie
// (defeating the whole point) would still "not throw".

import { describe, it, expect, vi, beforeEach } from "vitest"

const { cookieSetCalls, cookiesSetMock, revalidatePathMock } = vi.hoisted(() => {
  const cookieSetCalls: unknown[][] = []
  return {
    cookieSetCalls,
    cookiesSetMock: vi.fn((...args: unknown[]) => cookieSetCalls.push(args)),
    revalidatePathMock: vi.fn(),
  }
})

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: cookiesSetMock })),
}))
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }))
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenant: vi.fn() }))

import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { BUSINESS_COOKIE } from "@/lib/tenancy/cookie"
import { selectBusiness } from "@/app/(admin)/admin/actions"

beforeEach(() => {
  vi.clearAllMocks()
  cookieSetCalls.length = 0
})

describe("selectBusiness", () => {
  it("does NOT write the cookie when the requested business is not in the caller's own choices", async () => {
    // MUTANT: deleting the `if (!isOperator && ...) return` guard. The cookie
    // is only a preference (resolveAdminTenant re-validates it on read), but
    // this test exists so the guard itself stays pinned rather than relying
    // on that second layer alone.
    ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
      businessId: "b1",
      choices: [{ id: "b1", name: "My Gym", slug: "my-gym" }],
      isOperator: false,
    })

    await selectBusiness("unreachable-business")

    expect(cookieSetCalls).toEqual([])
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  // The presence control: without it, the test above would pass just as well
  // against a version that refuses to write the cookie under ANY input.
  it("writes the cookie when the requested business IS in the caller's own choices", async () => {
    ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
      businessId: "b1",
      choices: [
        { id: "b1", name: "My Gym", slug: "my-gym" },
        { id: "b2", name: "Second Gym", slug: "second-gym" },
      ],
      isOperator: false,
    })

    await selectBusiness("b2")

    expect(cookieSetCalls).toHaveLength(1)
    expect(cookieSetCalls[0][0]).toBe(BUSINESS_COOKIE)
    expect(cookieSetCalls[0][1]).toBe("b2")
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin")
  })

  it("lets the operator write an id outside their own (already-everything) choices list", async () => {
    ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
      businessId: "b1",
      choices: [{ id: "b1", name: "My Gym", slug: "my-gym" }],
      isOperator: true,
    })

    await selectBusiness("b-not-in-choices")

    expect(cookieSetCalls).toHaveLength(1)
    expect(cookieSetCalls[0][1]).toBe("b-not-in-choices")
  })
})
