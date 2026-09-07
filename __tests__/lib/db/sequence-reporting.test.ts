// __tests__/lib/db/sequence-reporting.test.ts
//
// The reporting read behind /admin/sequences.
//
// `bucketForRun` is where the whole feature lives. `sequence_runs` carries the
// outcome across TWO columns that do not line up with the four outcomes the
// screen promises: "ran to the end" is a status, "unsubscribed" is two
// different reasons, and there is a fifth reason the TypeScript union does not
// declare. Every one of those is a test below.

import { beforeEach, describe, expect, it, vi } from "vitest"

type Call = { table: string; select: string; ops: [string, ...unknown[]][] }
const calls: Call[] = []

/** Queued results, one per `.from(...).select(...)` in call order. */
let results: { data: unknown; error: unknown }[] = []

function makeBuilder(table: string, select: string) {
  const record: Call = { table, select, ops: [] }
  calls.push(record)
  const index = calls.length - 1
  const settle = () => results[index] ?? { data: [], error: null }

  const builder: Record<string, unknown> = {}
  for (const method of ["eq", "order", "limit", "in", "not", "range"]) {
    builder[method] = (...args: unknown[]) => {
      record.ops.push([method, ...args])
      return builder
    }
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(settle())
  builder.maybeSingle = () => settle()
  builder.single = () => settle()
  return builder
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      select: (select: string) => makeBuilder(table, select),
    }),
  }),
}))

import {
  bucketForRun,
  contactsWithEmailConsent,
  emptyBuckets,
  OUTCOME_BUCKETS,
  sequenceDetail,
  sequenceReport,
} from "@/lib/db/sequence-reporting"

const BUSINESS = "biz-under-test"

beforeEach(() => {
  calls.length = 0
  results = []
})

describe("bucketForRun", () => {
  it("puts a running person in progress", () => {
    expect(bucketForRun("active", null)).toBe("in_progress")
  })

  it("maps the four declared exit reasons", () => {
    expect(bucketForRun("exited", "payment")).toBe("bought")
    expect(bucketForRun("exited", "booking")).toBe("booked")
    expect(bucketForRun("exited", "unsubscribed")).toBe("opted_out")
    expect(bucketForRun("exited", "sms_stop")).toBe("opted_out")
  })

  // The reason SequenceExitReason does not declare. exitRun takes a plain
  // string and lib/automation/sequence-tick.ts:113 writes this one straight
  // past the union, so tsc cannot catch its absence — only this test can.
  it("maps 'suppressed', which the exported union omits", () => {
    expect(bucketForRun("exited", "suppressed")).toBe("opted_out")
  })

  // "Ran to the end" is a STATUS. completeRun writes no exit_reason at all,
  // so a mapping keyed only on exit_reason would lose every finisher.
  it("treats completed as finished regardless of exit_reason", () => {
    expect(bucketForRun("completed", null)).toBe("finished")
    expect(bucketForRun("completed", "payment")).toBe("finished")
  })

  it("treats failed as failed — a failure is not an exit", () => {
    expect(bucketForRun("failed", null)).toBe("failed")
  })

  // A sixth reason added later must be VISIBLE, not silently missing from the
  // totals. This is why "other" exists.
  it("puts an unknown exit reason in other rather than dropping it", () => {
    expect(bucketForRun("exited", "refunded_and_left")).toBe("other")
    expect(bucketForRun("exited", null)).toBe("other")
  })

  it("puts an unknown status in other", () => {
    expect(bucketForRun("paused_by_hand", null)).toBe("other")
  })

  // The two the first grep missed because it only searched TypeScript. Both are
  // written by SQL, inside migration 00238's merge_contacts, which runs during
  // ordinary identity resolution rather than from any button. They belong in
  // `other` — they are bookkeeping about which record somebody ended up in, not
  // an outcome the follow-up produced — and `other` is a COLUMN on the list, so
  // they are visible rather than making the row stop adding up.
  it("puts the two reasons migration 00238 writes in other", () => {
    expect(bucketForRun("exited", "merged_into_survivor")).toBe("other")
    expect(bucketForRun("exited", "superseded_by_merged_run")).toBe("other")
  })
})

describe("emptyBuckets", () => {
  it("has a zero for every bucket in OUTCOME_BUCKETS", () => {
    const empty = emptyBuckets()
    expect(Object.keys(empty).sort()).toEqual([...OUTCOME_BUCKETS].sort())
    expect(Object.values(empty).every((n) => n === 0)).toBe(true)
  })

  it("returns a fresh object each call, so two sequences cannot share a tally", () => {
    // MUTANT: `const EMPTY = {...}; return EMPTY`. Every sequence would
    // accumulate into the same object and the first row would hold the totals
    // for all nine.
    const a = emptyBuckets()
    a.bought += 1
    expect(emptyBuckets().bought).toBe(0)
  })
})

describe("sequenceReport", () => {
  function seed(opts: {
    sequences?: unknown[]
    runs?: unknown[]
    consents?: unknown[]
  }) {
    results = [
      { data: opts.sequences ?? [], error: null },
      { data: opts.runs ?? [], error: null },
      { data: opts.consents ?? [], error: null },
    ]
  }

  const ONE_SEQUENCE = [
    {
      id: "s1",
      key: "new_lead_nurture",
      name: "New Lead Nurture",
      description: "The eight-step one",
      status: "active",
      trigger_source: "funnel_form",
    },
  ]

  it("scopes every read to the business the caller names", async () => {
    // MUTANT: change the business_id VALUE passed to .eq — not the arity. An
    // argument-blind mock tolerates a wrong predicate value happily, and has
    // done in this repo before, 91 assertions passing on a wrong tenant.
    seed({ sequences: ONE_SEQUENCE, runs: [] })
    await sequenceReport(BUSINESS)
    for (const call of calls) {
      expect(call.ops).toContainEqual(["eq", "business_id", BUSINESS])
    }
  })

  it("counts entered as every run, and buckets each one", async () => {
    seed({
      sequences: ONE_SEQUENCE,
      runs: [
        { sequence_id: "s1", contact_id: "c1", status: "active", exit_reason: null },
        { sequence_id: "s1", contact_id: "c2", status: "exited", exit_reason: "payment" },
        { sequence_id: "s1", contact_id: "c3", status: "exited", exit_reason: "sms_stop" },
        { sequence_id: "s1", contact_id: "c4", status: "completed", exit_reason: null },
        { sequence_id: "s1", contact_id: "c5", status: "failed", exit_reason: null },
      ],
    })
    const { rows } = await sequenceReport(BUSINESS)
    const [row] = rows
    expect(row.entered).toBe(5)
    expect(row.buckets.in_progress).toBe(1)
    expect(row.buckets.bought).toBe(1)
    expect(row.buckets.opted_out).toBe(1)
    expect(row.buckets.finished).toBe(1)
    expect(row.buckets.failed).toBe(1)
  })

  // The invariant that makes the screen believable.
  it("buckets always sum to entered", async () => {
    seed({
      sequences: ONE_SEQUENCE,
      runs: [
        { sequence_id: "s1", contact_id: "c1", status: "active", exit_reason: null },
        { sequence_id: "s1", contact_id: "c2", status: "exited", exit_reason: "who_knows" },
        { sequence_id: "s1", contact_id: "c3", status: "exited", exit_reason: "suppressed" },
        { sequence_id: "s1", contact_id: "c4", status: "weird_new_status", exit_reason: null },
      ],
    })
    const { rows } = await sequenceReport(BUSINESS)
    const [row] = rows
    const total = OUTCOME_BUCKETS.reduce((n, b) => n + row.buckets[b], 0)
    expect(total).toBe(row.entered)
    expect(row.entered).toBe(4)
  })

  it("gives a sequence with no runs a zero in every bucket, not a missing one", async () => {
    // MUTANT: build the tally only for sequences that appear in the runs list.
    // Eight of the nine sequences in production have never run; they would
    // render with `undefined` in every column.
    seed({ sequences: ONE_SEQUENCE, runs: [] })
    const { rows } = await sequenceReport(BUSINESS)
    const [row] = rows
    expect(row.entered).toBe(0)
    expect(row.buckets).toEqual(emptyBuckets())
  })

  it("does not let one sequence's runs land on another", async () => {
    seed({
      sequences: [
        ...ONE_SEQUENCE,
        { id: "s2", key: "quiz_rebuilder", name: "Quiz Rebuilder", description: null, status: "active", trigger_source: "quiz" },
      ],
      runs: [
        { sequence_id: "s2", contact_id: "c1", status: "exited", exit_reason: "payment" },
      ],
    })
    const { rows } = await sequenceReport(BUSINESS)
    const nurture = rows.find((r) => r.key === "new_lead_nurture")!
    const quiz = rows.find((r) => r.key === "quiz_rebuilder")!
    expect(nurture.entered).toBe(0)
    expect(quiz.buckets.bought).toBe(1)
  })

  it("computes contactsWithoutEmailConsent from the newest row per contact, not merely whether one exists", async () => {
    // MUTANT this test targets: `contactsWithEmailConsent` implemented as "a
    // consent row exists" instead of "the newest row grants". c2's newest row
    // is a revocation, but c2 also has an OLDER granted row — an `exists`
    // check would find that older row and wrongly call c2 consented, hiding
    // it from the count below. c3 has never granted at all.
    seed({
      sequences: [
        ...ONE_SEQUENCE,
        { id: "s2", key: "quiz_rebuilder", name: "Quiz Rebuilder", description: null, status: "active", trigger_source: "quiz" },
      ],
      runs: [
        { sequence_id: "s1", contact_id: "c1", status: "active", exit_reason: null },
        { sequence_id: "s1", contact_id: "c2", status: "active", exit_reason: null },
        { sequence_id: "s2", contact_id: "c3", status: "active", exit_reason: null },
        { sequence_id: "s2", contact_id: "c1", status: "active", exit_reason: null },
      ],
      consents: [
        // Newest first, as the real .order(occurred_at desc, created_at desc)
        // call would return from the database.
        { contact_id: "c2", granted: false, occurred_at: "2026-09-05T00:00:00Z" },
        { contact_id: "c2", granted: true, occurred_at: "2026-08-01T00:00:00Z" },
        { contact_id: "c1", granted: true, occurred_at: "2026-09-01T00:00:00Z" },
        // c3 has no consent row at all.
      ],
    })
    const { rows } = await sequenceReport(BUSINESS)
    const nurture = rows.find((r) => r.key === "new_lead_nurture")!
    const quiz = rows.find((r) => r.key === "quiz_rebuilder")!
    // s1: c1's newest row grants, c2's newest row revokes -> 1 without consent.
    expect(nurture.contactsWithoutEmailConsent).toBe(1)
    // s2: c3 has never consented, c1 (shared with s1) grants -> 1 without consent.
    expect(quiz.contactsWithoutEmailConsent).toBe(1)
  })

  it("pages the runs read — PostgREST silently caps a plain select at ~1000 rows", async () => {
    // MUTANT: drop the .range() and read straight. Nothing errors; the numbers
    // are simply wrong past 1000 runs, and wrong in a confusing direction — the
    // detail page reads runs for ONE sequence and stays right, so a sequence can
    // read "nobody yet" on the list and "Entered 600" one click later.
    seed({ sequences: ONE_SEQUENCE, runs: [] })
    await sequenceReport(BUSINESS)
    const runsCall = calls.find((c) => c.table === "sequence_runs")!
    expect(runsCall.ops).toContainEqual(["range", 0, 999])
    // And an order, because a .range() walk over an unordered result set can
    // repeat and skip rows between windows.
    expect(runsCall.ops).toContainEqual(["order", "id", { ascending: true }])
  })

  it("counts a person in two sequences once at the top level, and in both rows", async () => {
    // MUTANT this kills: the page summing `contactsWithoutEmailConsent` across
    // the rows, which is what it used to do. c1 is in both sequences and has
    // never consented, so the summed version says two people where there is one
    // — under a sentence that says "people".
    seed({
      sequences: [
        ...ONE_SEQUENCE,
        { id: "s2", key: "quiz_rebuilder", name: "Quiz Rebuilder", status: "active", trigger_source: "quiz" },
      ],
      runs: [
        { sequence_id: "s1", contact_id: "c1", status: "active", exit_reason: null },
        { sequence_id: "s2", contact_id: "c1", status: "active", exit_reason: null },
      ],
      consents: [],
    })
    const report = await sequenceReport(BUSINESS)
    expect(report.contactsWithoutEmailConsent).toBe(1)
    // Presence control: the per-row numbers must still be 1 each, or this would
    // pass just as well against an implementation that counts nobody anywhere.
    expect(report.rows.find((r) => r.key === "new_lead_nurture")!.contactsWithoutEmailConsent).toBe(1)
    expect(report.rows.find((r) => r.key === "quiz_rebuilder")!.contactsWithoutEmailConsent).toBe(1)
  })

  it("throws when the runs read fails, rather than reporting zero runs", async () => {
    // "Could not read" and "nobody entered" must not look the same. A screen
    // whose entire job is to be believed cannot render a failure as an empty
    // sequence.
    results = [
      { data: ONE_SEQUENCE, error: null },
      { data: null, error: { message: "boom" } },
    ]
    await expect(sequenceReport(BUSINESS)).rejects.toThrow(/boom/)
  })

  it("throws when the sequences read fails", async () => {
    results = [{ data: null, error: { message: "sequences down" } }]
    await expect(sequenceReport(BUSINESS)).rejects.toThrow(/sequences down/)
  })
})

describe("contactsWithEmailConsent", () => {
  it("asks only about email, only for the ids given, scoped to the business", async () => {
    results = [{ data: [], error: null }]
    await contactsWithEmailConsent(BUSINESS, ["c1", "c2"])
    expect(calls[0].table).toBe("contact_consents")
    expect(calls[0].ops).toContainEqual(["eq", "business_id", BUSINESS])
    expect(calls[0].ops).toContainEqual(["eq", "channel", "email"])
    expect(calls[0].ops).toContainEqual(["in", "contact_id", ["c1", "c2"]])
  })

  // THE MUTATION THAT MATTERS. Consent is the most recent row per contact with
  // granted = true, NOT "a row exists". A naive `exists` implementation reports
  // a REVOKED consent as a granted one, which is exactly backwards and the more
  // dangerous of the two possible errors.
  it("takes the newest row per contact, so a later revocation wins", async () => {
    results = [
      {
        data: [
          { contact_id: "c1", granted: false, occurred_at: "2026-09-01T00:00:00Z" },
          { contact_id: "c1", granted: true, occurred_at: "2026-08-01T00:00:00Z" },
        ],
        error: null,
      },
    ]
    const granted = await contactsWithEmailConsent(BUSINESS, ["c1"])
    expect(granted.has("c1")).toBe(false)
  })

  it("keeps a contact whose newest row grants", async () => {
    results = [
      {
        data: [
          { contact_id: "c1", granted: true, occurred_at: "2026-09-01T00:00:00Z" },
          { contact_id: "c1", granted: false, occurred_at: "2026-08-01T00:00:00Z" },
        ],
        error: null,
      },
    ]
    const granted = await contactsWithEmailConsent(BUSINESS, ["c1"])
    // Presence control: without this, the revocation test above would pass just
    // as well against an implementation that returns an empty set for everything.
    expect(granted.has("c1")).toBe(true)
  })

  it("orders by occurred_at descending — the walk depends on it", async () => {
    // MUTANT: drop the .order, or make it ascending. The first row seen per
    // contact would be the OLDEST, so every revocation would be ignored. The
    // dedup and the ordering are one mechanism; neither is correct alone.
    results = [{ data: [], error: null }]
    await contactsWithEmailConsent(BUSINESS, ["c1"])
    expect(calls[0].ops).toContainEqual(["order", "occurred_at", { ascending: false }])
    expect(calls[0].ops).toContainEqual(["order", "created_at", { ascending: false }])
  })

  it("does not query at all for an empty id list", async () => {
    const granted = await contactsWithEmailConsent(BUSINESS, [])
    expect(granted.size).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it("chunks the contact ids so the query string cannot outgrow PostgREST's limit", async () => {
    // MUTANT: pass every id in one .in(). PostgREST puts the list in the query
    // STRING, so at roughly 450 uuids the request clears 16 KB and fails — and
    // on this screen a failed read is the admin error boundary, not a missing
    // number.
    const ids = Array.from({ length: 450 }, (_, i) => `c${i}`)
    results = []
    await contactsWithEmailConsent(BUSINESS, ids)
    expect(calls).toHaveLength(3)
    expect(calls[0].ops).toContainEqual(["in", "contact_id", ids.slice(0, 200)])
    expect(calls[1].ops).toContainEqual(["in", "contact_id", ids.slice(200, 400)])
    expect(calls[2].ops).toContainEqual(["in", "contact_id", ids.slice(400)])
  })

  it("pages each chunk — one person can have many consent rows", async () => {
    results = [{ data: [], error: null }]
    await contactsWithEmailConsent(BUSINESS, ["c1"])
    expect(calls[0].ops).toContainEqual(["range", 0, 999])
  })

  it("throws on a failed read rather than reporting nobody consented", async () => {
    results = [{ data: null, error: { message: "consent read failed" } }]
    await expect(contactsWithEmailConsent(BUSINESS, ["c1"])).rejects.toThrow(/consent read failed/)
  })
})

describe("sequenceDetail", () => {
  const SEQUENCE = {
    id: "s1",
    key: "new_lead_nurture",
    name: "New Lead Nurture",
    description: "Eight steps",
    status: "active",
    trigger_source: "funnel_form",
  }

  it("returns null for a key this business does not own", async () => {
    // NOT an empty report. An empty report tells the operator a sequence they
    // can name has nobody in it; null lets the page 404, which is the truth:
    // it belongs to somebody else.
    results = [{ data: null, error: null }]
    expect(await sequenceDetail(BUSINESS, "not_ours")).toBeNull()
  })

  it("looks the sequence up by key AND business", async () => {
    results = [{ data: SEQUENCE, error: null }, { data: [], error: null }, { data: [], error: null }, { data: [], error: null }]
    await sequenceDetail(BUSINESS, "new_lead_nurture")
    expect(calls[0].table).toBe("sequences")
    expect(calls[0].ops).toContainEqual(["eq", "key", "new_lead_nurture"])
    expect(calls[0].ops).toContainEqual(["eq", "business_id", BUSINESS])
  })

  it("buckets each run and flattens the joined contact", async () => {
    results = [
      { data: SEQUENCE, error: null },
      { data: [{ count: 2 }], error: null },
      {
        data: [
          {
            id: "r1",
            contact_id: "c1",
            enrolled_at: "2026-09-01T10:00:00Z",
            completed_at: "2026-09-02T10:00:00Z",
            status: "exited",
            exit_reason: "payment",
            last_error: null,
            contacts: { name: "Alex Rivera", email: "alex@example.com" },
          },
          {
            id: "r2",
            contact_id: "c2",
            enrolled_at: "2026-09-01T11:00:00Z",
            completed_at: null,
            status: "active",
            exit_reason: null,
            last_error: null,
            contacts: null,
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ]
    const detail = await sequenceDetail(BUSINESS, "new_lead_nurture")
    expect(detail!.runs[0]).toMatchObject({
      id: "r1",
      contactName: "Alex Rivera",
      contactEmail: "alex@example.com",
      bucket: "bought",
      exitReason: "payment",
    })
    // A run whose contact row did not come back must still render — a missing
    // join is not a reason to hide a person from the count.
    expect(detail!.runs[1]).toMatchObject({ id: "r2", contactName: null, bucket: "in_progress" })
  })

  it("keeps the raw exit reason, so the page can split opted-out three ways", async () => {
    // MUTANT: return only `bucket` and drop `exitReason`. The detail page could
    // no longer tell an email unsubscribe from a texted STOP from someone who
    // was already on the do-not-contact list — three different things.
    results = [
      { data: SEQUENCE, error: null },
      { data: [{ count: 1 }], error: null },
      {
        data: [
          {
            id: "r1", contact_id: "c1", enrolled_at: "2026-09-01T10:00:00Z", completed_at: null,
            status: "exited", exit_reason: "sms_stop", last_error: null, contacts: null,
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ]
    const detail = await sequenceDetail(BUSINESS, "new_lead_nurture")
    expect(detail!.runs[0].bucket).toBe("opted_out")
    expect(detail!.runs[0].exitReason).toBe("sms_stop")
  })

  it("pages the runs and reports the true total", async () => {
    // KNOWN DEFECT IN THE BRIEF, ruled on by the controller: the brief's
    // original version of this test seeded `{ data: [], error: null, count: 240 }`
    // and asserted `totalRuns === 240`. That cannot pass — the mock harness has
    // no `count` field, and the implementation deliberately does not issue a
    // separate count query: the tally read (the second read) already fetches
    // every run for this sequence, so `totalRuns` is derived from ITS row
    // count. A dedicated count query would be a redundant round trip. The
    // ruling: the implementation is right, so this test seeds the TALLY read
    // with the true number of rows and asserts against that, while separately
    // asserting the paged runs read carried the requested range.
    const tallyRows = Array.from({ length: 240 }, (_, i) => ({
      status: "active",
      exit_reason: null,
      contact_id: `c${i}`,
    }))
    results = [
      { data: SEQUENCE, error: null },
      { data: tallyRows, error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]
    const detail = await sequenceDetail(BUSINESS, "new_lead_nurture", { limit: 100, offset: 100 })
    const runsCall = calls.find((c) => c.table === "sequence_runs" && c.select.includes("contacts"))!
    expect(runsCall.ops).toContainEqual(["range", 100, 199])
    expect(detail!.totalRuns).toBe(240)
    // The mocked Supabase client cannot tell us `contacts.full_name` does not
    // exist on the real table — only a real PostgREST round trip would 400 on
    // that. This is the one thing standing between this suite and that same
    // mistake shipping again silently: pin the select string's column name.
    expect(runsCall.select).toContain("contacts(name, email)")
  })

  it("scopes EVERY read it makes to the business, not just the first", async () => {
    // MUTANT: point any one of the three business_id predicates inside
    // sequenceDetail at a different tenant. The previous version of this test
    // only looked at calls[0], so all three could be wrong and 29/29 still
    // passed. Spec §7 names this test: mutate the VALUE, not the arity — an
    // argument-blind mock swallows a wrong-tenant .eq() happily.
    results = [
      { data: SEQUENCE, error: null },
      { data: [{ status: "active", exit_reason: null, contact_id: "c1" }], error: null },
      { data: [], error: null },
      { data: [{ id: "step1" }], error: null },
      { data: [], error: null },
    ]
    await sequenceDetail(BUSINESS, "new_lead_nurture")
    // Presence control: an empty `calls` satisfies the loop below trivially.
    // Five reads: the sequence, the tally, the page of people, the steps, and
    // the consent lookup.
    expect(calls).toHaveLength(5)
    for (const call of calls) {
      expect(call.ops).toContainEqual(["eq", "business_id", BUSINESS])
    }
  })

  it("reads the page of people newest first — .range() over an unordered read repeats and skips", async () => {
    // MUTANT: remove .order("enrolled_at", { ascending: false }). 29/29 passed
    // without it. Postgres promises no row order without an ORDER BY, so page 2
    // can show somebody page 1 already showed and silently omit somebody else.
    results = [
      { data: SEQUENCE, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]
    await sequenceDetail(BUSINESS, "new_lead_nurture")
    const runsCall = calls.find((c) => c.table === "sequence_runs" && c.select.includes("contacts"))!
    expect(runsCall.ops).toContainEqual(["order", "enrolled_at", { ascending: false }])
    // The tally read is paged too, and pages its own way.
    const tallyCall = calls.find((c) => c.table === "sequence_runs" && !c.select.includes("contacts"))!
    expect(tallyCall.ops).toContainEqual(["range", 0, 999])
    expect(tallyCall.ops).toContainEqual(["order", "id", { ascending: true }])
  })

  it("counts the people in this sequence with no recorded permission to email", async () => {
    // MUTANT: hardcode contactsWithoutEmailConsent to 0. That passed 29/29,
    // because the number was computed at the cost of a fifth round trip and
    // then never rendered anywhere. The detail page shows it now.
    results = [
      { data: SEQUENCE, error: null },
      {
        data: [
          { status: "active", exit_reason: null, contact_id: "c1" },
          { status: "active", exit_reason: null, contact_id: "c2" },
          // c1 twice: counted as one PERSON, not two.
          { status: "completed", exit_reason: null, contact_id: "c1" },
        ],
        error: null,
      },
      { data: [], error: null },
      { data: [], error: null },
      { data: [{ contact_id: "c1", granted: true, occurred_at: "2026-09-01T00:00:00Z" }], error: null },
    ]
    const detail = await sequenceDetail(BUSINESS, "new_lead_nurture")
    // Presence control: three runs really were read, so a 1 below is a count and
    // not an empty fixture.
    expect(detail!.entered).toBe(3)
    // c1 consented. c2 has no consent row at all.
    expect(detail!.contactsWithoutEmailConsent).toBe(1)
  })

  it("carries the recorded failure reason through to the screen", async () => {
    // MUTANT: drop last_error from the select, or from the mapping. On
    // production the only sequence anybody has entered has 73 people in it and
    // nothing was sent to any of them; without this the screen can say only
    // "something went wrong", which is the bare red number the design was
    // written to prevent.
    results = [
      { data: SEQUENCE, error: null },
      { data: [{ status: "failed", exit_reason: null, contact_id: "c1" }], error: null },
      {
        data: [
          {
            id: "r1", contact_id: "c1", enrolled_at: "2026-09-01T10:00:00Z", completed_at: null,
            status: "failed", exit_reason: null,
            last_error: "The darrenjpaul.com domain is not verified",
            contacts: null,
          },
        ],
        error: null,
      },
      { data: [], error: null },
      { data: [], error: null },
    ]
    const detail = await sequenceDetail(BUSINESS, "new_lead_nurture")
    expect(detail!.runs[0].bucket).toBe("failed")
    expect(detail!.runs[0].lastError).toBe("The darrenjpaul.com domain is not verified")
    const runsCall = calls.find((c) => c.table === "sequence_runs" && c.select.includes("contacts"))!
    expect(runsCall.select).toContain("last_error")
  })

  it("throws when the sequence read fails, rather than 404ing", async () => {
    // A failed read must not be indistinguishable from "no such sequence".
    results = [{ data: null, error: { message: "sequence read failed" } }]
    await expect(sequenceDetail(BUSINESS, "new_lead_nurture")).rejects.toThrow(/sequence read failed/)
  })
})
