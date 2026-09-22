// @vitest-environment node
//
// __tests__/app/api/admin/contacts/contacts-route.test.ts
//
// G29 Task 8, R14. GET /api/admin/contacts?search= — the typeahead behind the
// new-card dialog. The plan forgot this file entirely: the dialog is a CLIENT
// component and `listContacts` is server-only DAL, so without a route there is
// no way for a search box in a browser to reach the contact spine.
//
// NODE ENVIRONMENT, PINNED. The suites under __tests__/app/api/admin/ that do
// not pin it inherit jsdom from vitest.config.ts and die on ERR_REQUIRE_ESM,
// which vitest reports as "no tests" rather than as red — a skipped suite
// reads as a green suite.
//
// Driven THROUGH the handler, with only the layers below it replaced. Three
// things this file exists to hold:
//
//  1. THE TENANT IS RESOLVED, NEVER TAKEN FROM THE CALLER. A `?businessId=`
//     in the query string must change nothing.
//  2. THE LIMIT CAP BINDS. `listContacts` clamps to PAGE = 1000, which is a
//     list-PAGE size, not a dropdown size. The assertion is on the argument
//     this route hands the DAL, so it fails if the route's own cap is removed
//     even though the DAL's would still be there — a fake with no limit
//     cannot test a limit.
//  3. A BLANK TERM IS NOT "EVERYBODY". `contactSearchClause` returns null for
//     a blank term, which means no search predicate at all, i.e. the whole
//     contact spine. A typeahead nobody has typed in must not be a dump.

import { beforeEach, describe, expect, it, vi } from "vitest"

const authMock = vi.fn()
const canAccessMock = vi.fn()
const listContactsMock = vi.fn()
const resolveTenantMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({
  canAccessAdminPath: (...a: unknown[]) => canAccessMock(...a),
}))
vi.mock("@/lib/db/contacts-list", () => ({
  listContacts: (...a: unknown[]) => listContactsMock(...a),
}))
// Declared INSIDE the factory and imported back below — vi.mock is hoisted, so
// a top-level class referenced from the factory would still be in its temporal
// dead zone when the factory runs (and that failure reports as "no tests").
vi.mock("@/lib/tenancy/resolve", () => {
  class NoAccessibleBusinessError extends Error {}
  return {
    resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
    NoAccessibleBusinessError,
  }
})

import { GET } from "@/app/api/admin/contacts/route"
import { NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

const ADMIN_SESSION = { user: { id: "admin-1", role: "admin", permissions: {} } }
const STAFF_SESSION = { user: { id: "staff-1", role: "staff", permissions: {} } }

/** The coach's own tenant — deliberately NOT a singleton-looking id. */
const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"
/** Somebody else's. Only ever sent by a caller trying it on. */
const OTHER_BUSINESS_ID = "33333333-3333-3333-3333-333333333333"

const DANA = {
  id: "c-dana",
  name: "Dana Reyes",
  email: "dana@example.com",
  phone_e164: "+12025550123",
  created_at: "2026-09-01T00:00:00.000Z",
}

function req(query: string) {
  return new Request(`https://www.darrenjpaul.com/api/admin/contacts${query}`, { method: "GET" })
}

/** The single object `listContacts` was called with, on the most recent call. */
function lastFilters(): Record<string, unknown> {
  const calls = listContactsMock.mock.calls
  return calls[calls.length - 1][0] as Record<string, unknown>
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued `*Once` implementation left
  // behind by a previous test leaks across files otherwise.
  vi.resetAllMocks()
  authMock.mockResolvedValue(ADMIN_SESSION)
  canAccessMock.mockResolvedValue(true)
  resolveTenantMock.mockResolvedValue({ businessId: BUSINESS_ID, choices: [], isOperator: true })
  listContactsMock.mockResolvedValue([DANA])
})

describe("GET /api/admin/contacts", () => {
  it("401s with no session, without reading a single contact", async () => {
    authMock.mockResolvedValue(null)
    const res = await GET(req("?search=dana"))
    expect(res.status).toBe(401)
    expect(listContactsMock).not.toHaveBeenCalled()
  })

  it("403s a staff member without the contacts permission", async () => {
    authMock.mockResolvedValue(STAFF_SESSION)
    canAccessMock.mockResolvedValue(false)
    const res = await GET(req("?search=dana"))
    expect(res.status).toBe(403)
    expect(listContactsMock).not.toHaveBeenCalled()
  })

  it("403s when no business can be resolved for this user", async () => {
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())
    const res = await GET(req("?search=dana"))
    expect(res.status).toBe(403)
    expect(listContactsMock).not.toHaveBeenCalled()
  })

  it("returns the matching contacts for the RESOLVED tenant", async () => {
    const res = await GET(req("?search=dana"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { contacts: Array<Record<string, unknown>> }
    // The row, whole — not "a row came back". Asserting the pair (this id
    // carries this email and this phone) is what catches a projection that
    // quietly changed columns underneath.
    expect(body.contacts).toEqual([DANA])
    expect(lastFilters()).toMatchObject({ businessId: BUSINESS_ID, search: "dana" })
  })

  it("ignores a businessId in the query string and uses the resolved one", async () => {
    // The whole point of resolving server-side. If this ever regresses, a coach
    // can read another tenant's contact list by editing a URL.
    await GET(req(`?search=dana&businessId=${OTHER_BUSINESS_ID}`))
    expect(lastFilters().businessId).toBe(BUSINESS_ID)
    expect(JSON.stringify(lastFilters())).not.toContain(OTHER_BUSINESS_ID)
  })

  it("answers an empty list for a blank search WITHOUT reading the spine", async () => {
    const res = await GET(req("?search=%20%20"))
    expect(res.status).toBe(200)
    expect((await res.json()).contacts).toEqual([])
    // Not merely "returned nothing" — the read must never have happened. A
    // blank term makes contactSearchClause return null, which is "every
    // contact", and a typeahead nobody has typed in must not be a dump.
    expect(listContactsMock).not.toHaveBeenCalled()
  })

  it("answers an empty list when there is no search param at all", async () => {
    const res = await GET(req(""))
    expect(res.status).toBe(200)
    expect((await res.json()).contacts).toEqual([])
    expect(listContactsMock).not.toHaveBeenCalled()
  })

  it("caps the limit at 20 however large the caller asks for", async () => {
    // THE CAP MUST BIND. listContacts' own clamp is PAGE = 1000 — a list-page
    // size — so the DAL would happily answer a thousand rows into a dropdown.
    // Asserting the argument handed to the DAL is what makes this a test of
    // THIS route's cap.
    await GET(req("?search=dana&limit=100000"))
    expect(lastFilters().limit).toBe(20)
  })

  it("lets a caller ask for FEWER than the cap", async () => {
    // The presence control for the test above: without this, a route that
    // hard-coded 20 and ignored the parameter would pass the cap test.
    await GET(req("?search=dana&limit=5"))
    expect(lastFilters().limit).toBe(5)
  })

  it("falls back to the cap for a limit that is not a usable number", async () => {
    for (const bad of ["abc", "0", "-3", "1.5", ""]) {
      listContactsMock.mockClear()
      await GET(req(`?search=dana&limit=${encodeURIComponent(bad)}`))
      expect(lastFilters().limit, `limit=${bad}`).toBe(20)
    }
  })

  it("answers 500 without leaking the database's own words when the read fails", async () => {
    // Silenced, not merely tolerated: the route logs the real fault on purpose
    // (that is where the PostgREST message belongs), and letting it print here
    // puts a stack trace in an otherwise pristine run, where the next person
    // reads it as a failure. Asserted rather than just muted, so the log the
    // operator depends on cannot be deleted without this test noticing.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    listContactsMock.mockRejectedValue(new Error('listContacts: column "phone" does not exist'))
    const res = await GET(req("?search=dana"))
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("Could not search your contacts right now.")
    expect(body.error).not.toContain("does not exist")
    // The reason did not vanish — it went to the log, where an operator can
    // read it and a coach cannot.
    expect(logged).toHaveBeenCalledTimes(1)
    expect(String(logged.mock.calls[0][1])).toContain("does not exist")
    logged.mockRestore()
  })
})
