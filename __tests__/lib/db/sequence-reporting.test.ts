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
    const [row] = await sequenceReport(BUSINESS)
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
    const [row] = await sequenceReport(BUSINESS)
    const total = OUTCOME_BUCKETS.reduce((n, b) => n + row.buckets[b], 0)
    expect(total).toBe(row.entered)
    expect(row.entered).toBe(4)
  })

  it("gives a sequence with no runs a zero in every bucket, not a missing one", async () => {
    // MUTANT: build the tally only for sequences that appear in the runs list.
    // Eight of the nine sequences in production have never run; they would
    // render with `undefined` in every column.
    seed({ sequences: ONE_SEQUENCE, runs: [] })
    const [row] = await sequenceReport(BUSINESS)
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
    const rows = await sequenceReport(BUSINESS)
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
    const rows = await sequenceReport(BUSINESS)
    const nurture = rows.find((r) => r.key === "new_lead_nurture")!
    const quiz = rows.find((r) => r.key === "quiz_rebuilder")!
    // s1: c1's newest row grants, c2's newest row revokes -> 1 without consent.
    expect(nurture.contactsWithoutEmailConsent).toBe(1)
    // s2: c3 has never consented, c1 (shared with s1) grants -> 1 without consent.
    expect(quiz.contactsWithoutEmailConsent).toBe(1)
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

  it("throws on a failed read rather than reporting nobody consented", async () => {
    results = [{ data: null, error: { message: "consent read failed" } }]
    await expect(contactsWithEmailConsent(BUSINESS, ["c1"])).rejects.toThrow(/consent read failed/)
  })
})
