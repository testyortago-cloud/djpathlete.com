// @vitest-environment node
//
// __tests__/proxy-admin-headers.test.ts — proxy.ts's /admin branch, header by
// header. Fix round 1 review: no test in the repo covered this file at all
// before now.
//
// TWO SEPARATE HEADERS, deliberately never merged:
//   - ADMIN_PATH_HEADER / ADMIN_METHOD_HEADER: an AUTHORISATION INPUT.
//     lib/permissions/guard.ts's canAccessAdminPath re-derives a staff server
//     action's permission tier from these. Stamped ONLY on a request this
//     gate actually GRANTED, always from a fresh Headers object so a client
//     cannot forge them.
//   - PAGE_PATH_HEADER: a UI HINT with no authorisation meaning at all.
//     app/(admin)/admin/layout.tsx reads it to tell whether it is already
//     rendering NO_ACCESS_PATH, so it can skip redirecting to itself. Stamped
//     on every /admin/* branch that renders, including one this gate DENIED
//     but still renders (the NO_ACCESS_PATH loop-guard) -- which is exactly
//     why it must not share a header with the authorisation input.
//
// `auth` (next-auth's middleware wrapper) is mocked to identity so the
// callback under test can be invoked directly with a plain NextRequest that
// carries its own `.auth`, the same shape next-auth attaches for real.

import { describe, it, expect, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth", () => ({ auth: (handler: unknown) => handler }))

import middleware from "@/proxy"
import { ADMIN_PATH_HEADER, ADMIN_METHOD_HEADER, PAGE_PATH_HEADER, NO_ACCESS_PATH } from "@/lib/permissions/registry"

type Handler = (req: NextRequest) => Response | Promise<Response>

function adminRequest(pathname: string, auth: unknown, method = "GET"): NextRequest {
  const req = new NextRequest(new URL(pathname, "http://localhost"), { method })
  Object.defineProperty(req, "auth", { value: auth, configurable: true })
  return req
}

/**
 * `NextResponse.next({ request: { headers } })` does not expose the modified
 * REQUEST headers on the returned response's own `.headers` under their own
 * names — Next.js encodes them as `x-middleware-request-<name>` response
 * headers instead (see node_modules/next/dist/.../response.js), which is what
 * its server runtime decodes back into the request the page/route actually
 * sees. This reads that encoding, so the assertions below are checking what a
 * Server Component would actually receive, not a header this test invented.
 */
function forwardedRequestHeader(res: Response, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`)
}

const ADMIN_SESSION = { user: { id: "u1", role: "admin", permissions: {} } }
const STAFF_SESSION = { user: { id: "u2", role: "staff", permissions: { funnels: "manage" } } }

describe("proxy.ts /admin branch — the two headers", () => {
  it("stamps BOTH ADMIN_PATH_HEADER and ADMIN_METHOD_HEADER on a granted admin request", async () => {
    // MINOR 3a: without ADMIN_METHOD_HEADER, a downstream canAccessAdminPath
    // (called with no `request`, e.g. from a server action) reads `undefined`
    // for the method, and tierForMethod(undefined) resolves to "view" even
    // for a POST — under-checking a mutating action as a read.
    const res = await (middleware as Handler)(adminRequest("/admin/dashboard", ADMIN_SESSION, "POST"))
    expect(forwardedRequestHeader(res, ADMIN_PATH_HEADER)).toBe("/admin/dashboard")
    expect(forwardedRequestHeader(res, ADMIN_METHOD_HEADER)).toBe("POST")
  })

  it("also stamps PAGE_PATH_HEADER on that same granted request", async () => {
    const res = await (middleware as Handler)(adminRequest("/admin/dashboard", ADMIN_SESSION))
    expect(forwardedRequestHeader(res, PAGE_PATH_HEADER)).toBe("/admin/dashboard")
  })

  it("a client-forged ADMIN_PATH_HEADER on the incoming request is overwritten, not forwarded", async () => {
    // The forgery vector the review credited this file's change with closing.
    const req = adminRequest("/admin/dashboard", ADMIN_SESSION)
    req.headers.set(ADMIN_PATH_HEADER, "/admin/audit-logs")
    const res = await (middleware as Handler)(req)
    expect(forwardedRequestHeader(res, ADMIN_PATH_HEADER)).toBe("/admin/dashboard")
  })

  it("stamps PAGE_PATH_HEADER on the staff home-page loop-guard render, but NOT the authorisation headers", async () => {
    // MINOR 3b: `canAccessPath` grants NO_ACCESS_PATH unconditionally
    // (pinned in __tests__/lib/permissions-registry.test.ts), so requesting
    // it directly always takes the GRANTED branch above, not this one --
    // the `pathname === NO_ACCESS_PATH` half of the loop-guard's condition
    // is defensive, not reachable today. The half that IS reachable:
    // `staffHomePath` picks a destination using VIEW tier only
    // (hasPermission(..., "view")), while `canAccessPath` requires MANAGE
    // tier for a non-GET method -- so a staff member with view-only
    // "payments" access (a TIERED permission, unlike the boolean "clients"),
    // POSTing to their own home page "/admin/payments", is denied by the
    // gate yet lands here via `pathname === home`. This branch renders that
    // page rather than redirecting them off their own home. ADMIN_PATH_HEADER
    // must stay absent -- present would read as "the gate granted this
    // path", which is false: it denied it.
    const viewOnlyStaff = { user: { id: "u3", role: "staff", permissions: { payments: "view" } } }
    const res = await (middleware as Handler)(adminRequest("/admin/payments", viewOnlyStaff, "POST"))
    expect(forwardedRequestHeader(res, PAGE_PATH_HEADER)).toBe("/admin/payments")
    expect(forwardedRequestHeader(res, ADMIN_PATH_HEADER)).toBeNull()
    expect(forwardedRequestHeader(res, ADMIN_METHOD_HEADER)).toBeNull()
  })

  it("is absent on a genuinely denied-and-redirected staff request", async () => {
    const res = await (middleware as Handler)(adminRequest("/admin/audit-logs", STAFF_SESSION))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain(NO_ACCESS_PATH)
  })
})
