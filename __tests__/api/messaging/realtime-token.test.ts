// @vitest-environment node
//
// jsdom's TextEncoder returns a Uint8Array from a different realm, which fails
// jose's `instanceof Uint8Array` check with "payload must be an instance of
// Uint8Array". The route declares runtime = "nodejs", so node is also the
// honest environment to test it in.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))

import { GET } from "@/app/api/messaging/realtime-token/route"

const SECRET = "test-secret-value-that-is-long-enough-for-hs256-signing"
const originalSecret = process.env.SUPABASE_JWT_SECRET

describe("GET /api/messaging/realtime-token", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUPABASE_JWT_SECRET = SECRET
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SUPABASE_JWT_SECRET
    else process.env.SUPABASE_JWT_SECRET = originalSecret
  })

  it("401 when not logged in", async () => {
    mocks.auth.mockResolvedValueOnce(null)
    expect((await GET()).status).toBe(401)
  })

  it("503 when the signing secret is not configured", async () => {
    delete process.env.SUPABASE_JWT_SECRET
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "client" } })
    const res = await GET()
    expect(res.status).toBe(503)
    // 503 not 500: the dock branches on this to degrade honestly.
    expect((await res.json()).error).toMatch(/not configured/i)
  })

  it("carries the session user as sub and the authenticated role", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "user-123", role: "client" } })
    const res = await GET()
    expect(res.status).toBe(200)

    const { token, expiresAt } = await res.json()
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
    expect(claims.sub).toBe("user-123")
    expect(claims.role).toBe("authenticated")
    expect(claims.aud).toBe("authenticated")
    expect(claims.exp * 1000).toBeGreaterThan(Date.now())
    expect(expiresAt).toBeGreaterThan(Date.now())
  })

  it("is actually signed with the configured secret, not merely shaped like a JWT", async () => {
    const { jwtVerify } = await import("jose")
    mocks.auth.mockResolvedValueOnce({ user: { id: "user-123", role: "client" } })
    const { token } = await (await GET()).json()

    await expect(
      jwtVerify(token, new TextEncoder().encode("a-completely-different-secret-value-here")),
    ).rejects.toThrow()

    const verified = await jwtVerify(token, new TextEncoder().encode(SECRET))
    expect(verified.payload.sub).toBe("user-123")
  })

  it("mints a token for an admin session too", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "admin-9", role: "admin" } })
    const { token } = await (await GET()).json()
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
    // The JWT role is the Postgres role, never the app role -- is_messaging_admin()
    // resolves admin-ness from the users table, not from a claim the token asserts.
    expect(claims.sub).toBe("admin-9")
    expect(claims.role).toBe("authenticated")
  })
})
