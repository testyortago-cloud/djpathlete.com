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

// The seam is MOCKED to a sentinel, not left real: a route that hard-coded the
// constant instead of calling platformBusinessId() would pass a test that
// asserted the real id, and the whole point of the seam is that phase 4
// changes ONE function.
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))

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
    expect(mocks.recordContactEvent.mock.calls[0][0]).toMatchObject({ businessId: "platform-biz" })
  })
})
