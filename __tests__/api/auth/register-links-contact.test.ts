// @vitest-environment node
//
// G04 (ledger 2026-09-19), the register route's half: a person who is
// already a contact — took the quiz, filled a form, bought something — and
// then makes an account must end up LINKED (`contacts.user_id`), or
// `has_user` in every quiz sequence keeps saying they are a stranger.
// `linkContactsToUser` itself (fill-only, unscoped by design) is proven in
// __tests__/db/contacts-record-event.test.ts; this file pins only that the
// route calls it, with the new user's id and email, on the paths where an
// account actually came into being, and never lets it fail a registration.
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  linkContactsToUser: vi.fn(),
  existingUser: null as null | { id: string; status: string; password_hash: string | null },
  createdUser: null as null | Record<string, unknown>,
}))

vi.mock("bcryptjs", () => ({ hash: vi.fn(async () => "hashed") }))
vi.mock("@/lib/db/contacts", () => ({
  linkContactsToUser: (...a: unknown[]) => mocks.linkContactsToUser(...a),
}))
vi.mock("@/lib/db/email-verification-tokens", () => ({ createEmailVerificationToken: vi.fn(async () => "tok") }))
vi.mock("@/lib/email", () => ({
  sendVerificationEmail: vi.fn(async () => undefined),
  sendNewRegistrationEmail: vi.fn(async () => undefined),
}))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: vi.fn(async () => null), ghlTriggerWorkflow: vi.fn() }))
vi.mock("@/lib/db/legal-documents", () => ({ getActiveDocument: vi.fn(async () => null) }))
vi.mock("@/lib/db/consents", () => ({ createConsent: vi.fn(async () => undefined) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn(async () => undefined) }))
vi.mock("@/lib/marketing/cookies", () => ({ parseAttrCookie: vi.fn(() => null) }))
vi.mock("@/lib/db/marketing-attribution", () => ({
  getAttributionBySession: vi.fn(async () => null),
  claimAttribution: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: (col: string) => {
              // `.select("id").eq("role", "admin")` is awaited directly (the
              // admin fan-out); `.eq("email", …).maybeSingle()` is the
              // duplicate check. One object serves both shapes.
              const thenable = Promise.resolve({ data: col === "role" ? [] : null, error: null })
              return Object.assign(thenable, {
                maybeSingle: async () => ({ data: mocks.existingUser, error: null }),
              })
            },
          }),
          insert: () => ({
            select: () => ({ single: async () => ({ data: mocks.createdUser, error: null }) }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({ single: async () => ({ data: mocks.createdUser, error: null }) }),
            }),
          }),
        }
      }
      // client_profiles and notifications inserts.
      return { insert: async () => ({ data: null, error: null }) }
    },
  }),
}))

function makeReq(over: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      firstName: "Jordan",
      lastName: "Blake",
      dateOfBirth: "1995-04-12",
      email: "Jordan@Example.com",
      password: "correct-horse-battery",
      confirmPassword: "correct-horse-battery",
      termsAccepted: true,
      ...over,
    }),
  })
}

const newUser = {
  id: "user-new",
  email: "Jordan@Example.com",
  first_name: "Jordan",
  last_name: "Blake",
  role: "client",
  status: "active",
  password_hash: "hashed",
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.linkContactsToUser.mockResolvedValue(1)
  mocks.existingUser = null
  mocks.createdUser = newUser
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("POST /api/auth/register — links existing contacts to the new account (G04)", () => {
  it("links by the new user's id and email after a successful registration", async () => {
    const { POST } = await import("@/app/api/auth/register/route")
    const res = await POST(makeReq())

    expect(res.status).toBe(201)
    expect(mocks.linkContactsToUser).toHaveBeenCalledTimes(1)
    // The address exactly as the users row holds it — normalisation is the
    // DAL's job, and the users table stores what the person typed.
    expect(mocks.linkContactsToUser).toHaveBeenCalledWith({ email: "Jordan@Example.com", userId: "user-new" })
  })

  it("links when a lead-status placeholder is upgraded to a real account", async () => {
    // The contact form / inquiry / funnel checkout mint a `status: "lead"`
    // users row with no password. The DAL refuses to link a contact to that
    // placeholder; THIS is the moment it becomes an account, and the same
    // row id is what the contact must now point at.
    mocks.existingUser = { id: "user-was-lead", status: "lead", password_hash: null }
    mocks.createdUser = { ...newUser, id: "user-was-lead" }

    const { POST } = await import("@/app/api/auth/register/route")
    const res = await POST(makeReq())

    expect(res.status).toBe(201)
    expect(mocks.linkContactsToUser).toHaveBeenCalledWith({ email: "Jordan@Example.com", userId: "user-was-lead" })
  })

  it("does not link when the email is already registered (409 — no account came into being)", async () => {
    mocks.existingUser = { id: "user-taken", status: "active", password_hash: "hashed" }

    const { POST } = await import("@/app/api/auth/register/route")
    const res = await POST(makeReq())

    expect(res.status).toBe(409)
    expect(mocks.linkContactsToUser).not.toHaveBeenCalled()
  })

  it("does not link when the form is invalid", async () => {
    const { POST } = await import("@/app/api/auth/register/route")
    const res = await POST(makeReq({ confirmPassword: "different" }))

    expect(res.status).toBe(400)
    expect(mocks.linkContactsToUser).not.toHaveBeenCalled()
  })

  it("never fails the registration when the link throws", async () => {
    mocks.linkContactsToUser.mockRejectedValueOnce(new Error("contacts table unavailable"))

    const { POST } = await import("@/app/api/auth/register/route")
    const res = await POST(makeReq())

    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ id: "user-new", email: "Jordan@Example.com" })
  })
})
