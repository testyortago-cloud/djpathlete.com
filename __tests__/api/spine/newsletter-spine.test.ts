// @vitest-environment node
//
// POST /api/newsletter joining the contact spine. Unlike the shop-leads and
// contact-form spine suites, this file never mocks @/lib/db/contacts: the
// enrolment check (last describe block) requires the REAL recordContactEvent
// and enrollIfTriggered running against an active newsletter_welcome-shaped
// sequence, so every test here shares one in-memory @/lib/supabase store
// instead of swapping mocking strategies mid-file. The store mirrors the
// pattern in __tests__/db/contacts-record-event.test.ts and
// __tests__/lib/lead-engine/enroll.test.ts: a `.eq()` filter is tracked and
// applied for real, and inserts are appended to a real backing array, so
// assertions exercise actual filtering/matching logic instead of a stub that
// always "matches everything".
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

type Row = Record<string, any>

const state: {
  contacts: Row[]
  timelineEvents: Row[]
  consents: Row[]
  sequences: Row[]
  sequenceRuns: Row[]
  errors: { contactsSelect?: any }
} = { contacts: [], timelineEvents: [], consents: [], sequences: [], sequenceRuns: [], errors: {} }

function collectionFor(table: string): Row[] | null {
  switch (table) {
    case "contacts":
      return state.contacts
    case "contact_timeline_events":
      return state.timelineEvents
    case "contact_consents":
      return state.consents
    case "sequences":
      return state.sequences
    case "sequence_runs":
      return state.sequenceRuns
    default:
      // Unlisted tables (audit_logs, from the route's withAudit fire-and-forget
      // recordAudit call) are inert here — that write is not under test.
      return null
  }
}

function makeTable(table: string) {
  const filters: Record<string, any> = {}

  function filterRows() {
    const backing = collectionFor(table)
    if (!backing) return []
    return backing.filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v))
  }

  const api: any = {
    select() {
      return api
    },
    eq(field: string, value: any) {
      filters[field] = value
      return api
    },
    order() {
      return api
    },
    limit() {
      return api
    },
    async maybeSingle() {
      const rows = filterRows()
      return { data: rows[0] ?? null, error: null }
    },
    then(resolve: any) {
      if (table === "contacts" && state.errors.contactsSelect) {
        return resolve({ data: null, error: state.errors.contactsSelect })
      }
      return resolve({ data: filterRows(), error: null })
    },
    insert(payload: Row) {
      const backing = collectionFor(table)
      if (!backing) return { data: null, error: null }

      if (table === "sequence_runs") {
        const conflict = backing.find(
          (r) =>
            r.business_id === payload.business_id &&
            r.sequence_id === payload.sequence_id &&
            r.contact_id === payload.contact_id &&
            r.status === "active",
        )
        if (conflict) {
          const err: any = new Error(
            'duplicate key value violates unique constraint "sequence_runs_one_active_per_sequence"',
          )
          err.code = "23505"
          return { data: null, error: err }
        }
      }

      const row: Row = {
        id: `${table}-${backing.length + 1}`,
        status: payload.status ?? "active",
        created_at: "2026-08-22T00:00:00Z",
        ...payload,
      }
      backing.push(row)
      return {
        data: row,
        error: null,
        select: () => ({ single: async () => ({ data: row, error: null }) }),
      }
    },
    update(patch: Row) {
      return {
        eq: async (field: string, value: any) => {
          const backing = collectionFor(table)
          if (!backing) return { data: null, error: null }
          for (let i = 0; i < backing.length; i++) {
            if (backing[i][field] === value) backing[i] = { ...backing[i], ...patch }
          }
          return { data: null, error: null }
        },
      }
    },
  }
  return api
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: (table: string) => makeTable(table) }),
}))

const mocks = vi.hoisted(() => ({
  addSubscriberWithAttribution: vi.fn(),
  ghlCreateContact: vi.fn(),
}))
vi.mock("@/lib/db/newsletter", () => ({
  addSubscriberWithAttribution: mocks.addSubscriberWithAttribution,
  addSubscriber: vi.fn(),
}))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: mocks.ghlCreateContact }))

import { POST } from "@/app/api/newsletter/route"
import { NEWSLETTER_CONSENT_WORDING } from "@/lib/lead-engine/capture"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

function jsonRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/newsletter", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(jsonRequest(body, headers), { params: Promise.resolve({}) })
}

beforeEach(() => {
  state.contacts = []
  state.timelineEvents = []
  state.consents = []
  state.sequences = []
  state.sequenceRuns = []
  state.errors = {}
  vi.clearAllMocks()
  mocks.addSubscriberWithAttribution.mockResolvedValue({ subscriber_id: "sub-1" })
  mocks.ghlCreateContact.mockResolvedValue(undefined)
})

describe("POST /api/newsletter — joins the contact spine", () => {
  it("records a contact_timeline_events row with source newsletter and the submitted email", async () => {
    const res = await post({ email: "Spine@Example.com", consent_marketing: true })
    expect(res.status).toBe(200)

    expect(state.contacts).toHaveLength(1)
    expect(state.contacts[0].email).toBe("spine@example.com")

    expect(state.timelineEvents).toHaveLength(1)
    expect(state.timelineEvents[0]).toMatchObject({
      contact_id: state.contacts[0].id,
      kind: "entry_point",
      source: "newsletter",
    })
  })

  it("writes a consent row with the exact wording, channel, and ip/user-agent", async () => {
    const res = await post(
      { email: "consent@example.com", consent_marketing: true },
      { "x-forwarded-for": "203.0.113.9", "user-agent": "test-agent/1.0" },
    )
    expect(res.status).toBe(200)

    expect(state.consents).toHaveLength(1)
    expect(state.consents[0]).toMatchObject({
      business_id: SINGLETON_BUSINESS_ID,
      contact_id: state.contacts[0].id,
      channel: "email",
      granted: true,
      source: "newsletter",
      wording_shown: NEWSLETTER_CONSENT_WORDING,
      ip_address: "203.0.113.9",
      user_agent: "test-agent/1.0",
    })
  })

  it("never changes the route's response or writes when recordContactEvent throws", async () => {
    state.errors.contactsSelect = { code: "42501", message: "permission denied for table contacts" }

    const res = await post({ email: "resilient@example.com", consent_marketing: true })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mocks.addSubscriberWithAttribution).toHaveBeenCalledTimes(1)
    expect(mocks.ghlCreateContact).toHaveBeenCalledTimes(1)

    // The spine write failed, so there is no contact to hang a consent row
    // off of — captureLead returned null and recordConsent was never called.
    expect(state.contacts).toHaveLength(0)
    expect(state.consents).toHaveLength(0)
  })

  it("writes no consent row when the subscriber write itself fails", async () => {
    mocks.addSubscriberWithAttribution.mockRejectedValueOnce(new Error("db unavailable"))

    const res = await post({ email: "failed-subscribe@example.com", consent_marketing: true })
    expect(res.status).toBe(500)

    expect(state.contacts).toHaveLength(0)
    expect(state.consents).toHaveLength(0)
  })
})

describe("POST /api/newsletter — enrolment (real recordContactEvent, real enrollIfTriggered)", () => {
  it("enrols the new contact into an ACTIVE newsletter-sourced sequence", async () => {
    state.sequences.push({
      id: "seq-newsletter-welcome",
      business_id: SINGLETON_BUSINESS_ID,
      key: "newsletter_welcome",
      name: "Newsletter Welcome",
      trigger_source: "newsletter",
      trigger_filter: {},
      status: "active",
    })

    const res = await post({ email: "enrol-me@example.com", consent_marketing: true })
    expect(res.status).toBe(200)

    expect(state.contacts).toHaveLength(1)
    expect(state.sequenceRuns).toHaveLength(1)
    expect(state.sequenceRuns[0]).toMatchObject({
      business_id: SINGLETON_BUSINESS_ID,
      sequence_id: "seq-newsletter-welcome",
      contact_id: state.contacts[0].id,
      current_position: 0,
    })
  })

  it("does not enrol into a DRAFT newsletter-sourced sequence", async () => {
    state.sequences.push({
      id: "seq-draft",
      business_id: SINGLETON_BUSINESS_ID,
      key: "newsletter_welcome",
      trigger_source: "newsletter",
      trigger_filter: {},
      status: "draft",
    })

    const res = await post({ email: "no-enrol@example.com", consent_marketing: true })
    expect(res.status).toBe(200)
    expect(state.sequenceRuns).toHaveLength(0)
  })
})
