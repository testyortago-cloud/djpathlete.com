// @vitest-environment node
//
// lib/db/contact-sequence-status.ts — which ONE run out of a person's several
// the list column speaks for.
//
// NODE ENVIRONMENT, PINNED — every jsdom suite in this repo currently fails to
// START (ERR_REQUIRE_ESM from html-encoding-sniffer) and vitest reports that as
// "no tests" rather than as a failure.
//
// The Supabase mock below FILTERS rather than returning a fixed row set, and
// that is load-bearing here rather than tidy: an argument-blind mock answers
// the same rows whether or not the read carries its `business_id` predicate,
// so the tenant test would pass against a reader that leaks every business's
// runs. There is a wrong-tenant row in the store for exactly that reason.
import { beforeEach, describe, expect, it, vi } from "vitest"

type Row = Record<string, any>

const store: {
  sequence_runs: Row[]
  sequence_steps: Row[]
  sequences: Row[]
  contacts: Row[]
  failTable: string | null
} = { sequence_runs: [], sequence_steps: [], sequences: [], contacts: [], failTable: null }

/** Remembers the predicates so a test can assert the read was actually scoped. */
const seen: { table: string; eqs: Array<[string, any]>; ins: Array<[string, any[]]> }[] = []

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const eqs: Array<[string, any]> = []
      const ins: Array<[string, any[]]> = []
      // `range` SLICES rather than being recorded and ignored. A mock that
      // accepted it and returned everything would make the paging loop in
      // `contactIdsInSequence` look correct while never exercising a second
      // page — and would spin forever the day the loop's exit condition broke.
      let range: [number, number] | null = null
      seen.push({ table, eqs, ins })

      const run = () => {
        if (store.failTable === table) {
          return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }
        }
        const source: Record<string, Row[]> = {
          sequence_runs: store.sequence_runs,
          sequence_steps: store.sequence_steps,
          contacts: store.contacts,
        }
        let rows: Row[] = source[table] ?? []
        for (const [col, val] of eqs) rows = rows.filter((r) => r[col] === val)
        for (const [col, vals] of ins) rows = rows.filter((r) => vals.includes(r[col]))
        if (table === "sequence_runs") {
          // PostgREST returns an embedded one-to-one as a nested object.
          rows = rows.map((r) => ({ ...r, sequences: store.sequences.find((s) => s.id === r.sequence_id) ?? null }))
        }
        if (range) rows = rows.slice(range[0], range[1] + 1)
        return { data: rows, error: null }
      }

      const api: any = {
        select: () => api,
        eq: (col: string, val: any) => {
          eqs.push([col, val])
          return api
        },
        in: (col: string, vals: any[]) => {
          ins.push([col, vals])
          return api
        },
        range: (from: number, to: number) => {
          range = [from, to]
          return api
        },
        then: (resolve: (v: any) => unknown) => Promise.resolve(run()).then(resolve),
      }
      return api
    },
  }),
}))

import { contactIdsInSequence, latestRunsForContacts, latestRunsForEmails } from "@/lib/db/contact-sequence-status"

const BUSINESS = "11111111-1111-1111-1111-111111111111"
const OTHER_BUSINESS = "99999999-9999-9999-9999-999999999999"
const NURTURE = "aaaaaaaa-0000-0000-0000-000000000001"
const WELCOME = "aaaaaaaa-0000-0000-0000-000000000002"

function seedSequences() {
  store.sequences = [
    { id: NURTURE, name: "New Lead Nurture" },
    { id: WELCOME, name: "Newsletter Welcome" },
  ]
  // The REAL production shapes, kinds included, because the count the badge
  // shows is of messages rather than of rows. new_lead_nurture is 8 rows that
  // send 4; newsletter_welcome is 6 rows that send 3.
  store.sequence_steps = [
    { id: "n0", sequence_id: NURTURE, position: 0, kind: "email" },
    { id: "n1", sequence_id: NURTURE, position: 1, kind: "wait" },
    { id: "n2", sequence_id: NURTURE, position: 2, kind: "email" },
    { id: "n3", sequence_id: NURTURE, position: 3, kind: "wait" },
    { id: "n4", sequence_id: NURTURE, position: 4, kind: "email" },
    { id: "n5", sequence_id: NURTURE, position: 5, kind: "wait" },
    { id: "n6", sequence_id: NURTURE, position: 6, kind: "sms" },
    { id: "n7", sequence_id: NURTURE, position: 7, kind: "stop" },
    { id: "w0", sequence_id: WELCOME, position: 0, kind: "email" },
    { id: "w1", sequence_id: WELCOME, position: 1, kind: "wait" },
    { id: "w2", sequence_id: WELCOME, position: 2, kind: "email" },
    { id: "w3", sequence_id: WELCOME, position: 3, kind: "wait" },
    { id: "w4", sequence_id: WELCOME, position: 4, kind: "sms" },
    { id: "w5", sequence_id: WELCOME, position: 5, kind: "stop" },
  ]
}

function runRow(overrides: Row = {}): Row {
  return {
    id: `r${store.sequence_runs.length + 1}`,
    business_id: BUSINESS,
    contact_id: "c1",
    sequence_id: NURTURE,
    status: "active",
    exit_reason: null,
    current_position: 2,
    enrolled_at: "2026-09-01T00:00:00Z",
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  store.sequence_runs = []
  store.contacts = []
  store.failTable = null
  seen.length = 0
  seedSequences()
})

describe("latestRunsForContacts", () => {
  it("returns the run with the sequence's name and its step count", async () => {
    store.sequence_runs = [runRow()]

    const map = await latestRunsForContacts(["c1"], BUSINESS)

    expect(map.get("c1")).toEqual({
      status: "active",
      exit_reason: null,
      current_position: 2,
      sequence_name: "New Lead Nurture",
      // The FOUR message positions, not the eight rows — see MESSAGE_KINDS.
      messagePositions: [0, 2, 4, 6],
    })
  })

  it("SCOPES TO THE TENANT — another business's run for the same contact is not read", async () => {
    // The contact id is deliberately the same. Without the business predicate
    // this row is indistinguishable from this tenant's own.
    store.sequence_runs = [
      runRow({ business_id: OTHER_BUSINESS, sequence_id: WELCOME, status: "exited", exit_reason: "payment" }),
    ]

    const map = await latestRunsForContacts(["c1"], BUSINESS)

    expect(map.has("c1")).toBe(false)
    const runsRead = seen.find((s) => s.table === "sequence_runs")
    expect(runsRead?.eqs).toContainEqual(["business_id", BUSINESS])
  })

  it("prefers the ACTIVE run even when a finished one is newer", async () => {
    // What the column answers is "what is happening with this person now?", so
    // a live follow-up outranks a more recent ending.
    store.sequence_runs = [
      runRow({ id: "r1", status: "active", enrolled_at: "2026-01-01T00:00:00Z" }),
      runRow({
        id: "r2",
        sequence_id: WELCOME,
        status: "exited",
        exit_reason: "payment",
        enrolled_at: "2026-09-01T00:00:00Z",
      }),
    ]

    const map = await latestRunsForContacts(["c1"], BUSINESS)

    expect(map.get("c1")?.status).toBe("active")
    expect(map.get("c1")?.sequence_name).toBe("New Lead Nurture")
  })

  it("among FINISHED runs takes the most recently enrolled, not a fixed status order", async () => {
    // A January opt-out must not outrank a March completion: the column would
    // then report a state the person left eight months ago.
    store.sequence_runs = [
      runRow({ id: "r1", status: "exited", exit_reason: "unsubscribed", enrolled_at: "2026-01-01T00:00:00Z" }),
      runRow({ id: "r2", sequence_id: WELCOME, status: "completed", enrolled_at: "2026-03-01T00:00:00Z" }),
    ]

    const map = await latestRunsForContacts(["c1"], BUSINESS)

    expect(map.get("c1")?.status).toBe("completed")
    expect(map.get("c1")?.sequence_name).toBe("Newsletter Welcome")
  })

  it("picks the SAME run every time when two are identical but for their id", async () => {
    // Two runs created in one transaction share a byte-identical `now()`, and
    // the read has no `.order()`, so without a final tie-break the winner is
    // PostgREST's unspecified row order — a badge that can name a different
    // sequence on every refresh. Asserted BOTH WAYS round, because a rule that
    // only happens to agree with insertion order is not a tie-break at all.
    const a = { id: "aaa", sequence_id: NURTURE, status: "exited", exit_reason: "payment" }
    const b = { id: "bbb", sequence_id: WELCOME, status: "exited", exit_reason: "payment" }

    store.sequence_runs = [runRow(a), runRow(b)]
    const forward = await latestRunsForContacts(["c1"], BUSINESS)

    seen.length = 0
    store.sequence_runs = [runRow(b), runRow(a)]
    const reversed = await latestRunsForContacts(["c1"], BUSINESS)

    expect(forward.get("c1")?.sequence_name).toBe(reversed.get("c1")?.sequence_name)
  })

  it("keeps every contact's own latest run apart", async () => {
    store.sequence_runs = [
      runRow({ id: "r1", contact_id: "c1", status: "active" }),
      runRow({ id: "r2", contact_id: "c2", sequence_id: WELCOME, status: "failed" }),
    ]

    const map = await latestRunsForContacts(["c1", "c2"], BUSINESS)

    expect(map.get("c1")?.status).toBe("active")
    expect(map.get("c2")?.status).toBe("failed")
    expect(map.get("c2")?.sequence_name).toBe("Newsletter Welcome")
  })

  it("counts MESSAGES only — waits and stops are not things a person receives", async () => {
    store.sequence_runs = [runRow()]

    const map = await latestRunsForContacts(["c1"], BUSINESS)

    // Eight rows in the fixture; four of them message somebody.
    expect(map.get("c1")?.messagePositions).toHaveLength(4)
  })

  it("treats a kind nobody has planned for as NOT a message", async () => {
    // `sequence_steps.kind` is plain text. Counting an unknown kind would
    // silently inflate every badge in the column the day one is added.
    store.sequence_steps = [
      { id: "x0", sequence_id: NURTURE, position: 0, kind: "email" },
      { id: "x1", sequence_id: NURTURE, position: 1, kind: "carrier_pigeon" },
    ]
    store.sequence_runs = [runRow()]

    const map = await latestRunsForContacts(["c1"], BUSINESS)

    expect(map.get("c1")?.messagePositions).toEqual([0])
  })

  it("counts the messages of EACH sequence separately", async () => {
    store.sequence_runs = [
      runRow({ id: "r1", contact_id: "c1", sequence_id: NURTURE }),
      runRow({ id: "r2", contact_id: "c2", sequence_id: WELCOME }),
    ]

    const map = await latestRunsForContacts(["c1", "c2"], BUSINESS)

    expect(map.get("c1")?.messagePositions).toEqual([0, 2, 4, 6])
    expect(map.get("c2")?.messagePositions).toEqual([0, 2, 4])
  })

  it("asks for no steps at all when nobody on the page is mid-follow-up", async () => {
    // The count only feeds the "step 3 of 8" label, which only an active run
    // shows. A second round trip for rows nothing renders is pure cost.
    store.sequence_runs = [runRow({ status: "exited", exit_reason: "payment" })]

    await latestRunsForContacts(["c1"], BUSINESS)

    expect(seen.some((s) => s.table === "sequence_steps")).toBe(false)
  })

  it("reads nothing at all for an empty page", async () => {
    const map = await latestRunsForContacts([], BUSINESS)

    expect(map.size).toBe(0)
    expect(seen).toHaveLength(0)
  })

  it("names a sequence that no longer exists rather than rendering blank", async () => {
    store.sequences = []
    store.sequence_runs = [runRow()]

    const map = await latestRunsForContacts(["c1"], BUSINESS)

    expect(map.get("c1")?.sequence_name).toBe("A sequence that no longer exists")
  })

  it("THROWS when the run read fails — an empty column must not mean an outage", async () => {
    store.failTable = "sequence_runs"
    store.sequence_runs = [runRow()]

    await expect(latestRunsForContacts(["c1"], BUSINESS)).rejects.toThrow(/latestRunsForContacts/)
  })

  it("asks for each contact ONCE when a page lists the same person twice", async () => {
    // The leads board can show two submissions from one person. Asserting only
    // that the map has one entry would pass without any de-duplication at all,
    // because the map is keyed by contact id — so this asserts the QUERY.
    store.sequence_runs = [runRow({ contact_id: "c1" })]

    const map = await latestRunsForContacts(["c1", "c1"], BUSINESS)

    expect(seen.find((s) => s.table === "sequence_runs")?.ins).toContainEqual(["contact_id", ["c1"]])
    expect(map.size).toBe(1)
  })

  it("degrades to no step count when only the STEP read fails, rather than losing the whole column", async () => {
    // The sequence name and the badge survive; only the "of 8" is missing.
    // Throwing here would take a working column down for a decoration.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    store.failTable = "sequence_steps"
    store.sequence_runs = [runRow()]

    const map = await latestRunsForContacts(["c1"], BUSINESS)

    expect(map.get("c1")?.sequence_name).toBe("New Lead Nurture")
    expect(map.get("c1")?.messagePositions).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

// The funnel leads board's rows are `funnel_submissions`, which carry NO
// contact_id — read off production, not off a migration. Email is the only key
// there is, so these pin what that match can and cannot do.
describe("latestRunsForEmails", () => {
  it("finds the run for the person that submission belongs to", async () => {
    store.contacts = [{ id: "c1", business_id: BUSINESS, email: "sam@example.test" }]
    store.sequence_runs = [runRow({ contact_id: "c1" })]

    const map = await latestRunsForEmails(["sam@example.test"], BUSINESS)

    expect(map.get("sam@example.test")?.sequence_name).toBe("New Lead Nurture")
  })

  it("matches regardless of how the address was typed into the form", async () => {
    // Capture stores addresses lowercase; a form does not.
    store.contacts = [{ id: "c1", business_id: BUSINESS, email: "sam@example.test" }]
    store.sequence_runs = [runRow({ contact_id: "c1" })]

    const map = await latestRunsForEmails(["  Sam@Example.TEST "], BUSINESS)

    expect(map.get("sam@example.test")?.status).toBe("active")
  })

  it("SCOPES the contact lookup to the tenant", async () => {
    // Same address, another business. Without the predicate this is that
    // coach's follow-up rendered on this coach's board.
    store.contacts = [{ id: "c1", business_id: OTHER_BUSINESS, email: "sam@example.test" }]
    store.sequence_runs = [runRow({ contact_id: "c1" })]

    const map = await latestRunsForEmails(["sam@example.test"], BUSINESS)

    expect(map.size).toBe(0)
    const contactsRead = seen.find((s) => s.table === "contacts")
    expect(contactsRead?.eqs).toContainEqual(["business_id", BUSINESS])
  })

  it("UNDER-REPORTS rather than guessing when no contact holds that address", async () => {
    store.contacts = []
    store.sequence_runs = [runRow({ contact_id: "c1" })]

    const map = await latestRunsForEmails(["nobody@example.test"], BUSINESS)

    // Empty, never another row's run — the page renders "—".
    expect(map.size).toBe(0)
  })

  it("reads nothing for a page of submissions that carry no email at all", async () => {
    const map = await latestRunsForEmails([null, undefined, "", "   "], BUSINESS)

    expect(map.size).toBe(0)
    expect(seen).toHaveLength(0)
  })

  it("asks for each distinct address once, however many submissions share it", async () => {
    store.contacts = [{ id: "c1", business_id: BUSINESS, email: "sam@example.test" }]
    store.sequence_runs = [runRow({ contact_id: "c1" })]

    await latestRunsForEmails(["sam@example.test", "SAM@example.test", "sam@example.test"], BUSINESS)

    const contactsRead = seen.find((s) => s.table === "contacts")
    expect(contactsRead?.ins).toContainEqual(["email", ["sam@example.test"]])
  })
})

describe("contactIdsInSequence", () => {
  it("returns only people with an ACTIVE run", async () => {
    store.sequence_runs = [
      runRow({ id: "r1", contact_id: "c1", status: "active" }),
      runRow({ id: "r2", contact_id: "c2", status: "exited", exit_reason: "payment" }),
      runRow({ id: "r3", contact_id: "c3", status: "failed" }),
    ]

    const ids = await contactIdsInSequence(BUSINESS)

    // c2 and c3 are not in a follow-up — their runs ended. A filter that
    // included them would return most of the table while claiming to narrow it.
    expect(ids).toEqual(["c1"])
  })

  it("names one person once even when they hold two active runs", async () => {
    store.sequence_runs = [
      runRow({ id: "r1", contact_id: "c1", status: "active" }),
      runRow({ id: "r2", contact_id: "c1", sequence_id: WELCOME, status: "active" }),
    ]

    expect(await contactIdsInSequence(BUSINESS)).toEqual(["c1"])
  })

  it("SCOPES to the tenant", async () => {
    store.sequence_runs = [runRow({ contact_id: "c1", business_id: OTHER_BUSINESS, status: "active" })]

    expect(await contactIdsInSequence(BUSINESS)).toEqual([])
  })

  it("PAGES PAST PostgREST's 1000-row cap rather than being silently truncated", async () => {
    // The cap truncates, it does not error. Unpaged, the 1001st person would
    // simply not come back — the filter would hide them AND the footer, which
    // is narrowed by this same list, would agree with the truncated set.
    store.sequence_runs = Array.from({ length: 1500 }, (_, i) =>
      runRow({ id: `r${i}`, contact_id: `c${i}`, status: "active" }),
    )

    const ids = await contactIdsInSequence(BUSINESS)

    expect(ids).toHaveLength(1500)
    expect(ids).toContain("c1400")
    // Two pages were actually requested — the assertion above would also pass
    // against a mock that ignored `range`.
    expect(seen.filter((s) => s.table === "sequence_runs").length).toBeGreaterThan(1)
  })

  it("THROWS on a read failure — an empty filter and a broken one must differ", async () => {
    store.failTable = "sequence_runs"

    await expect(contactIdsInSequence(BUSINESS)).rejects.toThrow(/contactIdsInSequence/)
  })
})
