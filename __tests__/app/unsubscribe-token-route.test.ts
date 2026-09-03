// @vitest-environment node
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"

// The audit recorder is mocked rather than run: recordAudit resolves an actor
// through NextAuth and writes via lib/db/audit-logs, neither of which this
// route's behaviour depends on. What matters here is that the flow records the
// event at all, with the right slug, category and actor.
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))

type Row = Record<string, any>

const store: {
  contacts: Row[]
  consents: Row[]
  suppressions: Row[]
  timeline: Row[]
  sequenceRuns: Row[]
} = { contacts: [], consents: [], suppressions: [], timeline: [], sequenceRuns: [] }

function collectionFor(table: string): Row[] {
  switch (table) {
    case "contacts":
      return store.contacts
    case "contact_consents":
      return store.consents
    case "contact_suppressions":
      return store.suppressions
    case "contact_timeline_events":
      return store.timeline
    case "sequence_runs":
      return store.sequenceRuns
    default:
      return []
  }
}

// Mocks ONLY @/lib/supabase, not the DAL functions themselves — recordConsent,
// suppress and exitRunsForContact all run for real here. That is deliberate:
// this route's idempotency guarantee depends on `suppress`'s real 23505
// handling, and a mock of `suppress` itself would prove nothing about it.
// Per CONTEXT.md's mock trap: `.eq()` here actually narrows the row set
// (tracked in `filters` and applied in `applyFilter`), and `insert()` on
// `contact_suppressions` simulates the real unique-constraint violation
// instead of always succeeding.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const filters: Array<[string, any]> = []
      let updatePatch: Row | null = null

      const applyFilter = (rows: Row[]) => rows.filter((row) => filters.every(([k, v]) => row[k] === v))

      const api: any = {
        select() {
          return api
        },
        eq(col: string, val: any) {
          filters.push([col, val])
          return api
        },
        insert(payload: Row) {
          if (table === "contact_suppressions") {
            const dupe = collectionFor(table).find(
              (r) => r.business_id === payload.business_id && r.identifier === payload.identifier,
            )
            if (dupe) {
              return Promise.resolve({
                data: null,
                error: {
                  message: 'duplicate key value violates unique constraint "contact_suppressions_uniq"',
                  code: "23505",
                },
              })
            }
          }
          const row = { id: `row-${collectionFor(table).length + 1}`, ...payload }
          collectionFor(table).push(row)
          return Promise.resolve({ data: row, error: null })
        },
        update(patch: Row) {
          updatePatch = patch
          return api
        },
        maybeSingle: async () => {
          const rows = applyFilter(collectionFor(table))
          return { data: rows[0] ?? null, error: null }
        },
        then(resolve: any) {
          const matched = applyFilter(collectionFor(table))
          if (updatePatch) {
            for (const row of matched) Object.assign(row, updatePatch)
          }
          return resolve({ data: matched.map((r) => ({ id: r.id })), error: null })
        },
      }
      return api
    },
  }),
}))

import { recordAudit } from "@/lib/audit/record"
import { signUnsubscribeToken } from "@/lib/lead-engine/unsubscribe-token"
import { signPersonalCheckinToken } from "@/lib/qr/checkin-token"
import { UNSUBSCRIBE_FOOTER_SENTENCE } from "@/lib/lead-engine/email"
import UnsubscribeTokenPage from "@/app/(marketing)/unsubscribe/[token]/page"
import { POST as unsubscribePost, GET as unsubscribeGet } from "@/app/api/unsubscribe/[token]/route"

const CONTACT = "c-1"
const OTHER_CONTACT = "c-2"
const BUSINESS = "00000000-0000-0000-0000-000000000001"

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret"
})

beforeEach(() => {
  // A second, unrelated same-business contact inserted FIRST — if the
  // route's contact lookup ever drops its `.eq("id", contactId)` filter,
  // `rows[0]` resolves to this row instead, and the suppression assertion
  // below catches it.
  store.contacts = [
    { id: "some-other-contact", business_id: BUSINESS, email: "not-marissa@example.com" },
    { id: CONTACT, business_id: BUSINESS, email: "marissa@example.com" },
  ]
  store.consents = []
  store.suppressions = []
  store.timeline = []
  store.sequenceRuns = [
    { id: "run-1", contact_id: CONTACT, business_id: BUSINESS, status: "active" },
    { id: "run-2", contact_id: OTHER_CONTACT, business_id: BUSINESS, status: "active" },
  ]
  vi.clearAllMocks()
})

describe("/unsubscribe/[token]", () => {
  it("renders a confirmation and suppresses on a valid token", async () => {
    const token = signUnsubscribeToken(CONTACT, BUSINESS)
    const el = await UnsubscribeTokenPage({ params: Promise.resolve({ token }) })
    expect(el).toBeTruthy()

    expect(store.suppressions).toHaveLength(1)
    expect(store.suppressions[0].identifier).toBe("marissa@example.com")
    expect(store.suppressions[0].reason).toBe("unsubscribed")

    expect(store.consents).toHaveLength(1)
    expect(store.consents[0]).toMatchObject({
      contact_id: CONTACT,
      channel: "email",
      granted: false,
      source: "unsubscribe_link",
      wording_shown: UNSUBSCRIBE_FOOTER_SENTENCE,
    })

    expect(store.timeline).toHaveLength(1)
    expect(store.timeline[0]).toMatchObject({ contact_id: CONTACT, kind: "unsubscribed" })
  })

  it("does not write anything for an invalid token", async () => {
    await expect(UnsubscribeTokenPage({ params: Promise.resolve({ token: "garbage" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    )

    expect(store.consents).toHaveLength(0)
    expect(store.suppressions).toHaveLength(0)
    expect(store.timeline).toHaveLength(0)
    expect(store.sequenceRuns.every((r) => r.status === "active")).toBe(true)
  })

  it("does not write anything for a foreign (personal check-in) token", async () => {
    // The unsub-family guard, exercised through the whole route: a real
    // check-in link must not be able to reach any of the four writes.
    const foreign = signPersonalCheckinToken("some-user-id")
    await expect(UnsubscribeTokenPage({ params: Promise.resolve({ token: foreign }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    )
    expect(store.suppressions).toHaveLength(0)
    expect(store.consents).toHaveLength(0)
  })

  it("is idempotent — a second visit does not throw or double-suppress", async () => {
    const token = signUnsubscribeToken(CONTACT, BUSINESS)
    await UnsubscribeTokenPage({ params: Promise.resolve({ token }) })
    await expect(UnsubscribeTokenPage({ params: Promise.resolve({ token }) })).resolves.toBeTruthy()

    // contact_suppressions is uniquely keyed on (business_id, identifier);
    // a second visit's insert 23505s and suppress() swallows it — one row.
    expect(store.suppressions).toHaveLength(1)

    // Consent is an append-only log (like recordContactEvent's timeline
    // rows) — a second revocation event is a legitimate second record, not
    // a bug — so two rows here, not one.
    expect(store.consents).toHaveLength(2)

    const ours = store.sequenceRuns.find((r) => r.id === "run-1")
    expect(ours?.status).toBe("exited")
  })

  it("exits active sequence runs, and only this contact's", async () => {
    const token = signUnsubscribeToken(CONTACT, BUSINESS)
    await UnsubscribeTokenPage({ params: Promise.resolve({ token }) })

    const ours = store.sequenceRuns.find((r) => r.id === "run-1")
    expect(ours?.status).toBe("exited")
    expect(ours?.exit_reason).toBe("unsubscribed")

    const theirs = store.sequenceRuns.find((r) => r.id === "run-2")
    expect(theirs?.status).toBe("active")
  })
})

// Fix wave (Important 3). `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
// declares RFC 8058, which obliges the URI in `List-Unsubscribe` to accept an
// HTTPS POST. The declared target used to be the page above — GET only — so
// Gmail's one-click button POSTed and got a 405: the reader pressed
// unsubscribe and nothing happened.
//
// The endpoint lives under /api because Next.js App Router cannot serve a
// `route.ts` and a `page.tsx` from the same segment (both normalise to
// `/unsubscribe/[token]`). These tests exist to prove the two surfaces run the
// SAME flow — that is the whole reason `processUnsubscribe` is shared.
describe("POST /api/unsubscribe/[token] (RFC 8058 one-click)", () => {
  function req(method = "POST") {
    return new Request("https://app.test/api/unsubscribe/tok", { method })
  }

  it("performs the full suppress/revoke/exit flow and answers 200", async () => {
    const token = signUnsubscribeToken(CONTACT, BUSINESS)
    const res = await unsubscribePost(req(), { params: Promise.resolve({ token }) })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    expect(store.suppressions).toHaveLength(1)
    expect(store.suppressions[0].identifier).toBe("marissa@example.com")
    expect(store.consents).toHaveLength(1)
    expect(store.consents[0]).toMatchObject({
      contact_id: CONTACT,
      channel: "email",
      granted: false,
      source: "unsubscribe_link",
      wording_shown: UNSUBSCRIBE_FOOTER_SENTENCE,
    })
    expect(store.timeline).toHaveLength(1)
    expect(store.timeline[0]).toMatchObject({ contact_id: CONTACT, kind: "unsubscribed" })
    expect(store.sequenceRuns.find((r) => r.id === "run-1")?.status).toBe("exited")
    expect(store.sequenceRuns.find((r) => r.id === "run-2")?.status).toBe("active")
  })

  it("writes nothing for an invalid token and answers 404, not 500", async () => {
    const res = await unsubscribePost(req(), { params: Promise.resolve({ token: "garbage" }) })
    expect(res.status).toBe(404)
    expect(store.consents).toHaveLength(0)
    expect(store.suppressions).toHaveLength(0)
    expect(store.timeline).toHaveLength(0)
  })

  it("writes nothing for a foreign (personal check-in) token", async () => {
    const foreign = signPersonalCheckinToken("some-user-id")
    const res = await unsubscribePost(req(), { params: Promise.resolve({ token: foreign }) })
    expect(res.status).toBe(404)
    expect(store.consents).toHaveLength(0)
    expect(store.suppressions).toHaveLength(0)
  })

  it("is idempotent — a mail client retrying the POST still answers 200", async () => {
    const token = signUnsubscribeToken(CONTACT, BUSINESS)
    await unsubscribePost(req(), { params: Promise.resolve({ token }) })
    const second = await unsubscribePost(req(), { params: Promise.resolve({ token }) })

    expect(second.status).toBe(200)
    expect(store.suppressions).toHaveLength(1)
    // Consent is append-only: a second revocation is a second legitimate
    // record, exactly as on the page path.
    expect(store.consents).toHaveLength(2)
  })

  it("lands the reader on the page instead of writing, when a client GETs the header URI", async () => {
    const token = signUnsubscribeToken(CONTACT, BUSINESS)
    const res = await unsubscribeGet(req("GET"), { params: Promise.resolve({ token }) })

    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toContain(`/unsubscribe/${encodeURIComponent(token)}`)
    // The GET arm itself must not act — it only redirects.
    expect(store.consents).toHaveLength(0)
    expect(store.suppressions).toHaveLength(0)
  })

  it("reaches the same end state as the page for the same token", async () => {
    // The two surfaces must not drift. Run the POST, snapshot; reset; run the
    // page; compare the parts that matter.
    const token = signUnsubscribeToken(CONTACT, BUSINESS)
    await unsubscribePost(req(), { params: Promise.resolve({ token }) })
    const viaPost = {
      suppressions: store.suppressions.map((r) => r.identifier),
      consents: store.consents.map((r) => `${r.channel}:${r.granted}:${r.source}`),
      timeline: store.timeline.map((r) => r.kind),
      runs: store.sequenceRuns.map((r) => `${r.id}:${r.status}`),
    }

    store.contacts = [
      { id: "some-other-contact", business_id: BUSINESS, email: "not-marissa@example.com" },
      { id: CONTACT, business_id: BUSINESS, email: "marissa@example.com" },
    ]
    store.consents = []
    store.suppressions = []
    store.timeline = []
    store.sequenceRuns = [
      { id: "run-1", contact_id: CONTACT, business_id: BUSINESS, status: "active" },
      { id: "run-2", contact_id: OTHER_CONTACT, business_id: BUSINESS, status: "active" },
    ]

    await UnsubscribeTokenPage({ params: Promise.resolve({ token }) })
    const viaPage = {
      suppressions: store.suppressions.map((r) => r.identifier),
      consents: store.consents.map((r) => `${r.channel}:${r.granted}:${r.source}`),
      timeline: store.timeline.map((r) => r.kind),
      runs: store.sequenceRuns.map((r) => `${r.id}:${r.status}`),
    }

    expect(viaPost).toEqual(viaPage)
    expect(viaPost.suppressions).toEqual(["marissa@example.com"])
  })
})

// Fix wave (Important 10). Spec §13 requires new audit slugs in the closed
// taxonomy, and nothing in this feature recorded an audit_logs row — not even
// the unsubscribe, an UNAUTHENTICATED URL that revokes consent and suppresses
// an address. A contact_timeline_events row is not a substitute: retention
// scrubs its metadata.
describe("the unsubscribe flow records an audit row", () => {
  it("records marketing.unsubscribed against the contact, with a system actor", async () => {
    const token = signUnsubscribeToken(CONTACT, BUSINESS)
    await UnsubscribeTokenPage({ params: Promise.resolve({ token }) })

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "marketing.unsubscribed",
        category: "compliance",
        outcome: "success",
        actor: expect.objectContaining({ role: "system" }),
        target: expect.objectContaining({ type: "contact", id: CONTACT }),
      }),
    )
  })

  it("records the same row from the one-click POST", async () => {
    const token = signUnsubscribeToken(CONTACT, BUSINESS)
    await unsubscribePost(new Request("https://app.test/api/unsubscribe/tok", { method: "POST" }), {
      params: Promise.resolve({ token }),
    })

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "marketing.unsubscribed", category: "compliance" }),
    )
  })

  it("carries no email address in the audit metadata", async () => {
    const token = signUnsubscribeToken(CONTACT, BUSINESS)
    await UnsubscribeTokenPage({ params: Promise.resolve({ token }) })

    const arg = (recordAudit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(JSON.stringify(arg)).not.toContain("marissa@example.com")
  })

  it("records nothing when the token is rejected", async () => {
    await expect(UnsubscribeTokenPage({ params: Promise.resolve({ token: "garbage" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    )
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("uses a slug that exists in the closed taxonomy", async () => {
    const { getActionDef } = await import("@/lib/audit/actions")
    const def = getActionDef("marketing.unsubscribed")
    expect(def).toBeDefined()
    expect(def?.category).toBe("compliance")
  })
})
