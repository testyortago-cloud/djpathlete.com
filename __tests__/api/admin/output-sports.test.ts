// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const canAccess = vi.fn()
const tenant = vi.fn()
const db = vi.hoisted(() => ({
  saveConnection: vi.fn(),
  getConnection: vi.fn(),
  disconnect: vi.fn(),
  getLink: vi.fn(),
  linkAthlete: vi.fn(),
  linkedAthletes: vi.fn(),
  unlinkAthlete: vi.fn(),
}))
const signIn = vi.fn()
const listAthletes = vi.fn()
const sync = vi.hoisted(() => ({ outputAccessToken: vi.fn(), syncClient: vi.fn() }))

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: (...a: unknown[]) => canAccess(...a) }))
vi.mock("@/lib/audit/with-audit", () => ({ withAudit: (_o: unknown, h: unknown) => h }))
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenantForRequest: (...a: unknown[]) => tenant(...a) }))
vi.mock("@/lib/db/output-sports", () => db)
vi.mock("@/lib/db/users", () => ({
  getUserById: vi.fn(async (id: string) => ({ id, first_name: "Chris", last_name: "Hall", role: "client" })),
}))
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: vi.fn(async () => ({ date_of_birth: null })) }))
vi.mock("@/lib/output-sports/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/output-sports/api")>()),
  signIn: (...a: unknown[]) => signIn(...a),
  listAthletes: (...a: unknown[]) => listAthletes(...a),
}))
vi.mock("@/lib/output-sports/sync", async (orig) => ({
  ...(await orig<typeof import("@/lib/output-sports/sync")>()),
  ...sync,
}))

import { POST as connect } from "@/app/api/admin/output-sports/connection/route"
import { GET as athletes, POST as link } from "@/app/api/admin/clients/[id]/output/route"
import { POST as syncRoute } from "@/app/api/admin/clients/[id]/output/sync/route"
import { OutputAuthError } from "@/lib/output-sports/api"

const json = (url: string, body: unknown) => new Request(url, { method: "POST", body: JSON.stringify(body) })
const clientCtx = { params: Promise.resolve({ id: "client-1" }) }
const outputAthletes = [
  { id: "a1", firstName: "Sam", lastName: "Lee", fullName: "Sam Lee", dateOfBirth: null, externalId: null },
  { id: "a2", firstName: "Chris", lastName: "Hall", fullName: "Chris Hall", dateOfBirth: null, externalId: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  canAccess.mockResolvedValue(true)
  tenant.mockResolvedValue({ businessId: "biz-A" })
  signIn.mockResolvedValue({ accessToken: "access", refreshToken: "refresh-xyz" })
  db.getConnection.mockResolvedValue({ business_id: "biz-A", account_email: "coach@example.com" })
  sync.outputAccessToken.mockResolvedValue("access")
  listAthletes.mockResolvedValue(outputAthletes)
  db.linkedAthletes.mockResolvedValue(new Map())
  db.linkAthlete.mockImplementation(async (_b: string, c: string, a: { id: string; name: string }) => ({
    client_user_id: c,
    output_athlete_id: a.id,
    output_athlete_name: a.name,
  }))
  sync.syncClient.mockResolvedValue({ imported: 2, added: 2, updated: 0, skipped: {} })
})

describe("POST /api/admin/output-sports/connection", () => {
  const url = "http://localhost/api/admin/output-sports/connection"

  it("stores Output's refresh token for the caller's business, never the password", async () => {
    const res = await connect(json(url, { email: "coach@example.com", password: "hunter2", business_id: "biz-B" }), {
      params: Promise.resolve({}),
    })
    expect(res.status).toBe(200)
    expect(db.saveConnection).toHaveBeenCalledWith("biz-A", "refresh-xyz", "coach@example.com", "admin-1")
    expect(JSON.stringify(db.saveConnection.mock.calls)).not.toContain("hunter2")
  })

  it("answers 400 with Output's reason when Output refuses the login, and saves nothing", async () => {
    signIn.mockRejectedValue(new OutputAuthError("OAuth error. Invalid credentials!"))
    const res = await connect(json(url, { email: "coach@example.com", password: "wrong" }), {
      params: Promise.resolve({}),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("Invalid credentials")
    expect(db.saveConnection).not.toHaveBeenCalled()
  })

  it("403s without admin access and never calls Output", async () => {
    canAccess.mockResolvedValue(false)
    const res = await connect(json(url, { email: "coach@example.com", password: "x" }), { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
    expect(signIn).not.toHaveBeenCalled()
  })
})

describe("/api/admin/clients/[id]/output", () => {
  const url = "http://localhost/api/admin/clients/client-1/output"

  it("lists Output's athletes with the likely match first and others' athletes marked", async () => {
    db.linkedAthletes.mockResolvedValue(new Map([["a1", "someone-else"]]))
    const res = await athletes(new Request(url), clientCtx)
    const body = await res.json()
    expect(body.athletes.map((a: { id: string }) => a.id)).toEqual(["a2", "a1"])
    expect(body.athletes[0]).toMatchObject({ suggested: true, linkedToOther: false })
    expect(body.athletes[1]).toMatchObject({ suggested: false, linkedToOther: true })
  })

  it("links using the name Output gives, then pulls the results in", async () => {
    const res = await link(json(url, { athleteId: "a2" }), clientCtx)
    expect(res.status).toBe(200)
    expect(db.linkAthlete).toHaveBeenCalledWith("biz-A", "client-1", { id: "a2", name: "Chris Hall" }, "admin-1")
    expect(sync.syncClient).toHaveBeenCalledWith("biz-A", "client-1", "admin-1")
  })

  it("refuses an athlete id that is not in the business's Output account", async () => {
    const res = await link(json(url, { athleteId: "made-up" }), clientCtx)
    expect(res.status).toBe(404)
    expect(db.linkAthlete).not.toHaveBeenCalled()
  })

  it("answers 409 when that athlete is already another client's", async () => {
    db.linkAthlete.mockResolvedValue("taken")
    const res = await link(json(url, { athleteId: "a2" }), clientCtx)
    expect(res.status).toBe(409)
    expect(sync.syncClient).not.toHaveBeenCalled()
  })

  it("keeps the link and reports the problem when the first sync fails", async () => {
    sync.syncClient.mockRejectedValue(new OutputAuthError("OAuth error. Invalid refresh token!"))
    const res = await link(json(url, { athleteId: "a2" }), clientCtx)
    expect(res.status).toBe(200)
    expect((await res.json()).syncError).toMatch(/Reconnect it in Settings/)
  })

  it("never answers 401/403 for an Output refusal, so the audit log does not call it access denied", async () => {
    sync.syncClient.mockRejectedValue(new OutputAuthError("OAuth error. Invalid refresh token!"))
    const res = await syncRoute(new Request(`${url}/sync`, { method: "POST" }), clientCtx)
    expect(res.status).toBe(409)
  })
})
