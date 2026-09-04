// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock factories are hoisted above the whole module, including class
// declarations below -- a bare `class SlugTakenError` referenced directly by
// name inside a factory object literal throws "Cannot access before
// initialization" (the factory is invoked while resolving the route's own
// imports, before this file's own top-level statements have run). vi.hoisted
// makes the class exist by the time the factories that name it are invoked.
const { SlugTakenError, NoAccessibleBusinessError } = vi.hoisted(() => {
  class SlugTakenError extends Error {
    constructor(s: string) {
      super(s)
      this.name = "SlugTakenError"
    }
  }
  // The allowed set can come back empty -- e.g. a coach whose only
  // membership points at a business that was since paused.
  // resolveAdminTenantForRequest throws rather than inventing an id; the
  // route must not 500 on that.
  class NoAccessibleBusinessError extends Error {
    constructor() {
      super("This account has no business it can access")
      this.name = "NoAccessibleBusinessError"
    }
  }
  return { SlugTakenError, NoAccessibleBusinessError }
})

const created: unknown[] = []
let createImpl: (i: unknown) => Promise<unknown> = () => Promise.resolve({ id: "new" })

vi.mock("@/lib/db/businesses", () => ({
  createBusiness: (i: unknown) => {
    created.push(i)
    return createImpl(i)
  },
  listBusinesses: () => Promise.resolve([]),
  SlugTakenError,
}))

let tenant: unknown = { businessId: "aaa", choices: [], isOperator: true }
let resolveImpl: () => Promise<unknown> = () => Promise.resolve(tenant)
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: () => resolveImpl(),
  NoAccessibleBusinessError,
}))

let session: unknown = { user: { id: "op", role: "admin" } }
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(session) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: () => Promise.resolve() }))

import { POST } from "@/app/api/admin/businesses/route"

function req(body: unknown) {
  return new Request("http://localhost/api/admin/businesses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const GOOD = {
  name: "Coach Two",
  slug: "coach-two",
  timezone: "America/Chicago",
  hostDisplayName: "Coach Two",
  hostEmail: "two@example.com",
}

beforeEach(() => {
  created.length = 0
  createImpl = () => Promise.resolve({ id: "new", ...GOOD })
  session = { user: { id: "op", role: "admin" } }
  tenant = { businessId: "aaa", choices: [], isOperator: true }
  resolveImpl = () => Promise.resolve(tenant)
})

describe("POST /api/admin/businesses", () => {
  it("creates the business and stamps the creator from the SESSION, not the body", async () => {
    const res = await POST(req({ ...GOOD, createdBy: "someone-else" }), { params: Promise.resolve({}) })
    expect(res.status).toBe(201)
    expect((created[0] as { createdBy: string }).createdBy).toBe("op")
  })

  it("refuses a non-operator with 403", async () => {
    tenant = { businessId: "bbb", choices: [], isOperator: false }
    session = { user: { id: "coach", role: "staff" } }
    const res = await POST(req(GOOD), { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
    expect(created).toHaveLength(0)
  })

  it("answers 409 with the slug field named when the slug is taken", async () => {
    createImpl = () => Promise.reject(new SlugTakenError("coach-two"))
    const res = await POST(req(GOOD), { params: Promise.resolve({}) })
    expect(res.status).toBe(409)
    expect((await res.json()).field).toBe("slug")
  })

  it("answers 400 on a reserved slug and never reaches the DAL", async () => {
    const res = await POST(req({ ...GOOD, slug: "admin" }), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it("answers 400 on an invalid timezone and never reaches the DAL", async () => {
    const res = await POST(req({ ...GOOD, timezone: "Not/AZone" }), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it("answers 403, not 500, when the caller has no accessible business", async () => {
    resolveImpl = () => Promise.reject(new NoAccessibleBusinessError())
    const res = await POST(req(GOOD), { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
    expect(created).toHaveLength(0)
  })
})
