// @vitest-environment node
//
// __tests__/app/admin/layout-tenant-redirect.test.tsx — app/(admin)/admin/layout.tsx
// wraps EVERY admin page, and Task 6 removed resolveAdminTenant's old
// "zero membership rows -> singleton" fallback: an empty allowed set now
// THROWS NoAccessibleBusinessError instead. An uncaught throw here would be a
// 500 on every admin screen at once, so the layout must catch it and redirect
// to NO_ACCESS_PATH.
//
// NO RENDER. `AdminRootLayout` is an async server component; this calls it
// directly and inspects what it returns/throws, the same way
// __tests__/app/funnel-edit-layout-draft-jobs.test.tsx does — this repo's
// jsdom environment cannot start a worker at all right now (confirmed
// pre-existing, unrelated to this change), so no test in this file may use
// @testing-library/react's `render()`.
//
// The PRESENCE CONTROL matters as much as the redirect itself: a caller with
// an accessible business must still get a layout back, or a version that
// redirects unconditionally (never actually reading `choices`) would pass the
// redirect test just as well.

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ReactElement } from "react"

vi.mock("@/lib/permissions/guard", () => ({ requireAdminPanelAccess: vi.fn() }))
vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn() }))
vi.mock("@/lib/content-studio/feature-flag", () => ({ isContentStudioEnabled: vi.fn(() => false) }))

// vi.mock factories are hoisted above the file's own top-level bindings, so
// the mocks these factories close over must be created with vi.hoisted
// rather than as plain `const`s above them.
const { redirectMock, headersGetMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
  headersGetMock: vi.fn((): string | null => null),
}))
vi.mock("next/navigation", () => ({ redirect: redirectMock }))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => ({ get: headersGetMock })) }))

// Real NoAccessibleBusinessError class preserved via importActual, so the
// layout's `instanceof` check (importing the SAME mocked module) is checking
// against the genuine class, not a stand-in with a different identity.
vi.mock("@/lib/tenancy/resolve", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenancy/resolve")>("@/lib/tenancy/resolve")
  return { ...actual, resolveAdminTenant: vi.fn() }
})

import { requireAdminPanelAccess } from "@/lib/permissions/guard"
import { getUserById } from "@/lib/db/users"
import { resolveAdminTenant, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { NO_ACCESS_PATH, PAGE_PATH_HEADER } from "@/lib/permissions/registry"
import AdminRootLayout from "@/app/(admin)/admin/layout"
import { AdminLayout } from "@/components/admin/AdminLayout"

const SESSION = { user: { id: "u1", role: "admin", permissions: {} } }

function findAdminLayoutElement(root: ReactElement): ReactElement<React.ComponentProps<typeof AdminLayout>> {
  const kids = (root.props as { children: unknown }).children
  const list = Array.isArray(kids) ? kids : [kids]
  const found = list.find((el) => (el as ReactElement | null)?.type === AdminLayout)
  if (!found) throw new Error("AdminLayout element not found in AdminRootLayout's output")
  return found as ReactElement<React.ComponentProps<typeof AdminLayout>>
}

beforeEach(() => {
  vi.clearAllMocks()
  redirectMock.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT")
  })
  headersGetMock.mockReturnValue(null)
  ;(requireAdminPanelAccess as ReturnType<typeof vi.fn>).mockResolvedValue(SESSION)
  ;(getUserById as ReturnType<typeof vi.fn>).mockResolvedValue({
    avatar_url: null,
    first_name: "Ada",
    last_name: "Coach",
  })
})

describe("admin layout — tenant resolution", () => {
  it("redirects to NO_ACCESS_PATH rather than letting NoAccessibleBusinessError escape", async () => {
    // MUTANT: deleting the try/catch (or the instanceof check) around
    // resolveAdminTenant() re-throws this as an uncaught error instead of a
    // redirect — a 500 on every admin page at once.
    ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockRejectedValue(new NoAccessibleBusinessError())

    await expect(AdminRootLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT")
    expect(redirectMock).toHaveBeenCalledWith(NO_ACCESS_PATH)
  })

  it("does NOT redirect again when the request is already headed to NO_ACCESS_PATH itself", async () => {
    // Without this branch, visiting /admin/no-access directly (or landing
    // there from the redirect above) would resolve the SAME empty tenant and
    // redirect from NO_ACCESS_PATH to NO_ACCESS_PATH forever. proxy.ts stamps
    // PAGE_PATH_HEADER this reads -- a UI hint with no authorisation meaning,
    // deliberately NOT the same header lib/permissions/guard.ts trusts for
    // access decisions (ADMIN_PATH_HEADER).
    ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockRejectedValue(new NoAccessibleBusinessError())
    headersGetMock.mockReturnValue(NO_ACCESS_PATH)

    const element = (await AdminRootLayout({ children: null })) as ReactElement
    expect(redirectMock).not.toHaveBeenCalled()
    // MUTANT: reading ADMIN_PATH_HEADER instead of PAGE_PATH_HEADER here
    // would still happen to work today (nothing else in this test sets
    // either), but would be reading the wrong header's meaning.
    expect(headersGetMock).toHaveBeenCalledWith(PAGE_PATH_HEADER)
    // Rendered with no tenant at all -- the switcher must not appear.
    expect(findAdminLayoutElement(element).props.businessSwitcher).toBeNull()
  })

  // The presence control: a caller WITH an accessible business must still get
  // a real layout back, not just "did not throw". Without this, a version
  // that redirected unconditionally (ignoring `choices` entirely) would pass
  // the test above just as well.
  it("renders the layout normally for a caller with an accessible business", async () => {
    ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
      businessId: "b1",
      choices: [{ id: "b1", name: "Acme Coaching", slug: "acme" }],
      isOperator: false,
    })

    const element = (await AdminRootLayout({ children: null })) as ReactElement
    expect(redirectMock).not.toHaveBeenCalled()
    const adminLayout = findAdminLayoutElement(element)
    expect(adminLayout.props.actor).toEqual({ role: "admin", permissions: {} })
    // Exactly one business: the switcher slot must be empty.
    expect(adminLayout.props.businessSwitcher).toBeNull()
  })

  it("passes a real switcher element only once the caller has more than one business", async () => {
    ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
      businessId: "b1",
      choices: [
        { id: "b1", name: "Acme Coaching", slug: "acme" },
        { id: "b2", name: "Second Gym", slug: "second-gym" },
      ],
      isOperator: true,
    })

    const element = (await AdminRootLayout({ children: null })) as ReactElement
    const switcher = findAdminLayoutElement(element).props.businessSwitcher as ReactElement
    expect(switcher).not.toBeNull()
    expect((switcher.props as { currentId: string }).currentId).toBe("b1")
    expect((switcher.props as { choices: unknown[] }).choices).toHaveLength(2)
  })
})
