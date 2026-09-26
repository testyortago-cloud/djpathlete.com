// @vitest-environment node
//
// POST /api/contact joining the contact spine. recordContactEvent is mocked
// directly (same lighter-weight approach as shop-leads-spine.test.ts) — no
// enrolment proof is required for this route.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

type Row = Record<string, any>

const state: { users: Row[]; notifications: Row[] } = { users: [], notifications: [] }

function makeTable(table: string) {
  const filters: Record<string, any> = {}
  const api: any = {
    select() {
      return api
    },
    eq(field: string, value: any) {
      filters[field] = value
      return api
    },
    async maybeSingle() {
      if (table !== "users") return { data: null, error: null }
      const found = state.users.find((u) => Object.entries(filters).every(([k, v]) => u[k] === v))
      return { data: found ?? null, error: null }
    },
    insert(payload: Row) {
      if (table === "users") {
        const row: Row = { id: `user-${state.users.length + 1}`, ...payload }
        state.users.push(row)
        return {
          data: row,
          error: null,
          select: () => ({ single: async () => ({ data: row, error: null }) }),
        }
      }
      if (table === "notifications") {
        const rows = Array.isArray(payload) ? payload : [payload]
        state.notifications.push(...rows)
        return { data: null, error: null }
      }
      return { data: null, error: null }
    },
    then(resolve: any) {
      if (table === "users") {
        const rows = state.users.filter((u) => Object.entries(filters).every(([k, v]) => u[k] === v))
        return resolve({ data: rows, error: null })
      }
      return resolve({ data: [], error: null })
    },
  }
  return api
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: (table: string) => makeTable(table) }),
}))

const mocks = vi.hoisted(() => ({
  recordContactEvent: vi.fn(),
  ghlCreateContact: vi.fn(),
  ghlTriggerWorkflow: vi.fn(),
  sendContactFormEmail: vi.fn(),
  sendContactAutoReply: vi.fn(),
  listBusinessMemberUserIds: vi.fn(),
}))

vi.mock("@/lib/db/contacts", () => ({
  recordContactEvent: mocks.recordContactEvent,
}))
vi.mock("@/lib/ghl", () => ({
  ghlCreateContact: mocks.ghlCreateContact,
  ghlTriggerWorkflow: mocks.ghlTriggerWorkflow,
}))
vi.mock("@/lib/email", () => ({
  sendContactFormEmail: mocks.sendContactFormEmail,
  sendContactAutoReply: mocks.sendContactAutoReply,
}))
// The bell's recipients (G35). Only the reader is replaced: LEAD_ALERT_ROLES
// stays the real constant, so the call assertions below check what the route
// actually passes.
vi.mock("@/lib/db/business-members", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/business-members")>()),
  listBusinessMemberUserIds: mocks.listBusinessMemberUserIds,
}))

// The route resolves its tenant from the request's Host through the ONE Host
// boundary (lib/tenancy/public.ts). Mocked to a sentinel that is not the
// platform's, so a route that hard-codes platformBusinessId() cannot pass.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))

import { POST } from "@/app/api/contact/route"

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function post(body: unknown) {
  return POST(jsonRequest(body), { params: Promise.resolve({}) })
}

const VALID_BODY = {
  name: "Jamie Rivera",
  email: "jamie@example.com",
  subject: "Coaching inquiry",
  message: "I would like to learn more about the programs you offer.",
}

beforeEach(() => {
  state.users = []
  state.notifications = []
  vi.clearAllMocks()
  mocks.recordContactEvent.mockResolvedValue({ contactId: "contact-1", created: true, merged: false })
  mocks.ghlCreateContact.mockResolvedValue(null)
  mocks.ghlTriggerWorkflow.mockResolvedValue(true)
  mocks.sendContactFormEmail.mockResolvedValue(undefined)
  mocks.sendContactAutoReply.mockResolvedValue(undefined)
  // Nobody to bell unless a test says otherwise: the state every older test
  // here was written against (no admin in `state.users`).
  mocks.listBusinessMemberUserIds.mockResolvedValue([])
})

describe("POST /api/contact — joins the contact spine", () => {
  it("calls recordContactEvent with source contact_form, the email, and name", async () => {
    const res = await post(VALID_BODY)
    expect(res.status).toBe(200)

    expect(mocks.recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "jamie@example.com",
        name: "Jamie Rivera",
        source: "contact_form",
      }),
    )
  })

  it("never changes the route's response or existing writes when recordContactEvent throws", async () => {
    mocks.recordContactEvent.mockRejectedValueOnce(new Error("PGRST204 column missing"))

    const res = await post(VALID_BODY)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(state.users).toHaveLength(1)
    expect(state.users[0].email).toBe("jamie@example.com")
    expect(mocks.sendContactFormEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendContactAutoReply).toHaveBeenCalledTimes(1)
  })
})

describe("POST /api/contact — tenant", () => {
  it("files the contact under the business the seam names, resolved once and threaded", async () => {
    const res = await post(VALID_BODY)
    expect(res.status).toBe(200)
    expect(mocks.recordContactEvent).toHaveBeenCalledTimes(1)
    expect(mocks.recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: "host-biz" })
  })
})

// G35. The bell used to go to `users where role = 'admin'` — every platform
// operator, whichever business's site the message came from. It now goes to
// the site business's owners and coaches, read through business_members.
// PLATFORM_ADMIN is what the old read would have found; every test seeds it,
// so a route that still made that read would bell it.
describe("POST /api/contact — who gets the bell (G35)", () => {
  const PLATFORM_ADMIN = { id: "platform-admin", email: "ops@example.com", role: "admin" }

  it("bells the site business's owners and coaches, not every platform admin", async () => {
    // MUTANT: the old `users where role = 'admin'` read — it bells
    // platform-admin and neither owner-1 nor coach-1. MUTANT: the platform's
    // id, or `staff` among the roles — the call assertion fails.
    state.users = [PLATFORM_ADMIN]
    mocks.listBusinessMemberUserIds.mockResolvedValue(["owner-1", "coach-1"])

    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(mocks.listBusinessMemberUserIds).toHaveBeenCalledWith("host-biz", ["owner", "coach"])
    expect(state.notifications.map((n) => n.user_id)).toEqual(["owner-1", "coach-1"])
  })

  it("files no bell when the business has no owner or coach — it never falls back to the platform's admins", async () => {
    // MUTANT: an empty recipient list falling back to the `users` admin read.
    state.users = [PLATFORM_ADMIN]
    mocks.listBusinessMemberUserIds.mockResolvedValue([])

    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(state.notifications).toEqual([])
    // Presence control: the rest of the route ran, so the absence above is
    // not the route having stopped early.
    expect(mocks.sendContactFormEmail).toHaveBeenCalledTimes(1)
  })

  it("logs a failed recipients read and still sends the email, the auto-reply and the CRM sync", async () => {
    // MUTANT: the old early `return` on a failed read, which also skipped both
    // emails and the CRM sync. MUTANT: a catch that swallows without logging,
    // so the lost alert leaves no trace.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    state.users = [PLATFORM_ADMIN]
    mocks.listBusinessMemberUserIds.mockRejectedValue(
      new Error("listBusinessMemberUserIds failed (42P01): no such table"),
    )

    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(state.notifications).toEqual([])
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("no bell alert"),
      expect.objectContaining({ message: expect.stringContaining("42P01") }),
    )
    expect(mocks.sendContactFormEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendContactAutoReply).toHaveBeenCalledTimes(1)
    expect(mocks.ghlCreateContact).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})
