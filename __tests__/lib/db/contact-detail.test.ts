// @vitest-environment node
//
// The pure half of the contact detail screen: the timeline merge and the
// per-kind describer. Plus (Task 13) a mocked-database suite for
// `getContactDetail`'s bookings read, which used to be an in-memory
// identifier match and is now a join on `contact_id`.
//
// NODE ENVIRONMENT, PINNED. Every jsdom suite in this repo currently cannot
// start — `require() of ES Module ... html-encoding-sniffer` — and vitest
// reports that as "Test Files no tests" rather than as a failure. A jsdom suite
// here would look green while executing nothing.
//
// mergeTimeline and describeTimelineEvent are exported and tested directly,
// rather than only through `getContactDetail`, because a merge that drops a
// source silently omits the money.
import { beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// getContactDetail's supabase double
// ---------------------------------------------------------------------------
// One fake `.from(table)` handler shared by every parallel read
// getContactDetail issues. It records every `.eq()`/`.in()`/`.order()`/
// `.limit()` call PER TABLE (an argument-blind `eq: () => chain` tolerates a
// wrong-tenant mutant silently — see contacts-list.test.ts's own header for
// the same lesson), and resolves with a per-table canned result. Every table
// except "bookings" returns an empty result by default: this suite's claim is
// about the bookings read alone, and an unscoped return elsewhere would just
// be noise.
type Op = [string, ...unknown[]]
const opsByTable: Record<string, Op[]> = {}
let bookingsResult: { data: unknown; error: unknown } = { data: [], error: null }
const EMPTY = { data: [], error: null }

function makeBuilder(table: string, result: unknown) {
  const ops: Op[] = (opsByTable[table] ??= [])
  const builder: Record<string, unknown> = {}
  for (const method of ["eq", "in", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      ops.push([method, ...args] as Op)
      return builder
    }
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(result)
  return builder
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      select: () => makeBuilder(table, table === "bookings" ? bookingsResult : EMPTY),
    }),
  }),
}))

import {
  describeTimelineEvent,
  formatMoney,
  getContactDetail,
  mergeTimeline,
  type BookingRow,
  type ContactRecord,
  type PaymentRow,
  type TimelineEventRow,
} from "@/lib/db/contact-detail"

function event(over: Partial<TimelineEventRow> & { id: string }): TimelineEventRow {
  return {
    kind: "entry_point",
    source: "newsletter",
    occurred_at: "2026-08-22T10:00:00.000Z",
    metadata: {},
    scrubbed_at: null,
    ...over,
  }
}

function payment(over: Partial<PaymentRow> & { id: string }): PaymentRow {
  return {
    amount_cents: 18000,
    currency: "usd",
    status: "succeeded",
    description: "Rotational Reboot",
    created_at: "2026-08-19T09:00:00.000Z",
    ...over,
  }
}

function booking(over: Partial<BookingRow> & { id: string }): BookingRow {
  return {
    booking_date: "2026-08-21T14:00:00.000Z",
    duration_minutes: 30,
    status: "scheduled",
    source: "ghl",
    created_at: "2026-08-19T12:00:00.000Z",
    ...over,
  }
}

// Distinct from SINGLETON_BUSINESS_ID on purpose — see this branch's own
// fixture-hazard note: a "business" value that IS the singleton makes a
// tenancy assertion pass regardless of whether the code scopes at all.
const BUSINESS = "22222222-2222-2222-2222-222222222222"

function contact(over: Partial<ContactRecord> & { id: string }): ContactRecord {
  return {
    business_id: BUSINESS,
    user_id: null,
    name: "Jane Contact",
    email: null,
    phone_e164: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    timezone: null,
    ...over,
  }
}

describe("getContactDetail — bookings join on contact_id (Task 13)", () => {
  beforeEach(() => {
    for (const key of Object.keys(opsByTable)) delete opsByTable[key]
    bookingsResult = { data: [], error: null }
  })

  // MUTATION 1 target: drop `.eq("business_id", businessId)` from the read.
  // MUTATION 2 target: drop `.eq("contact_id", contact.id)` from the read.
  // Either one leaves this assertion unsatisfied — pinning the VALUE, not
  // merely that "some eq() happened" (an argument-blind chain would tolerate
  // a wrong-tenant mutant silently).
  it("scopes the bookings read to the business AND joins on contact_id", async () => {
    await getContactDetail(contact({ id: "c1", business_id: BUSINESS }))
    const ops = opsByTable["bookings"]
    expect(ops).toContainEqual(["eq", "business_id", BUSINESS])
    expect(ops).toContainEqual(["eq", "contact_id", "c1"])
  })

  // MUTATION 3 target: revert the read to the old in-memory email/phone
  // comparison. This booking's stored email and phone BOTH mismatch the
  // contact's own — the old `bookingMatchesContact` would exclude it, and
  // only the contact_id join includes it. A test that used a booking whose
  // identifiers happen to agree could not tell the two mechanisms apart.
  it("includes a booking whose stored email/phone differ from the contact's own, because it matches by contact_id", async () => {
    bookingsResult = {
      data: [
        booking({
          id: "book-mismatched-email",
          // These two fields don't exist on the new SELECT at all any more —
          // included here only to prove that even if a reverted
          // implementation looked at them, they would NOT match.
          ...({ contact_email: "totally-different@example.com", contact_phone: "+19995550000" } as unknown as Partial<BookingRow>),
        }),
      ],
      error: null,
    }
    const c = contact({ id: "c1", business_id: BUSINESS, email: "jane@example.com", phone_e164: "+18135550142" })

    const detail = await getContactDetail(c)

    expect(detail.timeline.some((entry) => entry.key === "booking:book-mismatched-email")).toBe(true)
  })

  it("drops a booking with a null contact_id off the record (pre-phase-0 row)", async () => {
    // Not literally reachable through this mock (the query already filters
    // server-side on contact_id), but documents the intended behaviour: a
    // pre-phase-0 booking with no contact_id was never provably this
    // contact's, and correctly never appears rather than being guessed at.
    bookingsResult = { data: [], error: null }
    const detail = await getContactDetail(contact({ id: "c1", business_id: BUSINESS }))
    expect(detail.timeline.filter((entry) => entry.origin === "booking")).toEqual([])
  })

  it("throws on a read failure rather than rendering an empty bookings list", async () => {
    bookingsResult = { data: null, error: { message: "connection reset" } }
    await expect(getContactDetail(contact({ id: "c1", business_id: BUSINESS }))).rejects.toThrow(
      /getContactDetail bookings/,
    )
  })
})

describe("mergeTimeline", () => {
  it("includes all three sources and orders them newest first", () => {
    const merged = mergeTimeline({
      events: [event({ id: "e1", occurred_at: "2026-08-22T10:00:00.000Z" })],
      payments: [payment({ id: "p1", created_at: "2026-08-19T09:00:00.000Z" })],
      bookings: [booking({ id: "b1", booking_date: "2026-08-21T14:00:00.000Z" })],
    })

    // Pins WHICH rows and in WHICH order, not merely that something came back.
    expect(merged.map((entry) => entry.key)).toEqual(["event:e1", "booking:b1", "payment:p1"])
    expect(merged.map((entry) => entry.origin)).toEqual(["event", "booking", "payment"])
  })

  // THE PRESENCE CONTROL for every "shows no payments" assertion elsewhere. A
  // broken payment join returns nothing for everyone, and an absence test alone
  // passes just as happily in that case.
  it("renders a payment with its amount and description", () => {
    const merged = mergeTimeline({
      events: [],
      payments: [payment({ id: "p1", amount_cents: 18000, description: "Rotational Reboot" })],
      bookings: [],
    })
    expect(merged).toHaveLength(1)
    expect(merged[0].title).toBe("Paid $180.00 — Rotational Reboot")
    expect(merged[0].origin).toBe("payment")
    expect(merged[0].tone).toBe("success")
  })

  // A REFUND MUST NOT CLAIM AN AMOUNT THE ROW DOES NOT KNOW. `payments
  // .amount_cents` is the ORIGINAL charge and is never reduced on refund — the
  // Stripe webhook only flips `status` — while Stripe fires `charge.refunded`
  // for PARTIAL refunds too. So "Refunded $180.00" on a $20 refund is a number
  // the coach would act on and it would be wrong by nine times.
  it("words a refund so it does not assert the refunded amount", () => {
    const merged = mergeTimeline({
      events: [],
      payments: [payment({ id: "p1", status: "refunded", amount_cents: 18000, description: "Rotational Reboot" })],
      bookings: [],
    })
    expect(merged[0].title).toBe("A payment of $180.00 — Rotational Reboot was refunded")
    expect(merged[0].title).not.toMatch(/^Refunded /)
    expect(merged[0].tone).toBe("warning")
  })

  it("a failed payment reads as failed, not as money received", () => {
    const merged = mergeTimeline({
      events: [],
      payments: [payment({ id: "p1", status: "failed", amount_cents: 18000, description: null })],
      bookings: [],
    })
    expect(merged[0].title).toBe("A payment of $180.00 failed")
    expect(merged[0].tone).toBe("danger")
  })

  it("the matching absence case: a lead with no payments has no payment rows", () => {
    const merged = mergeTimeline({ events: [event({ id: "e1" })], payments: [], bookings: [] })
    expect(merged.filter((entry) => entry.origin === "payment")).toEqual([])
    // ...and the control, in the same test: the event DID render, so an empty
    // payment list is a real answer rather than a merge that dropped everything.
    expect(merged.map((entry) => entry.key)).toEqual(["event:e1"])
  })

  it("uses the booked slot as a booking's date, not the row's created_at", () => {
    const merged = mergeTimeline({
      events: [],
      payments: [],
      bookings: [booking({ id: "b1", booking_date: "2026-09-30T14:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z" })],
    })
    expect(merged[0].occurredAt).toBe("2026-09-30T14:00:00.000Z")
  })

  // Ties are real: recordContactEvent writes an entry_point plus one
  // identifier_conflict per conflicting field, all within the same millisecond.
  // Without the tiebreak the rows swap places between renders of the same data.
  it("orders same-instant rows deterministically", () => {
    const rows = {
      events: [
        event({ id: "b", occurred_at: "2026-08-22T10:00:00.000Z" }),
        event({ id: "a", occurred_at: "2026-08-22T10:00:00.000Z" }),
        event({ id: "c", occurred_at: "2026-08-22T10:00:00.000Z" }),
      ],
      payments: [],
      bookings: [],
    }
    const first = mergeTimeline(rows).map((entry) => entry.key)
    const second = mergeTimeline({ ...rows, events: [...rows.events].reverse() }).map((entry) => entry.key)
    expect(first).toEqual(["event:a", "event:b", "event:c"])
    expect(second).toEqual(first)
  })

  // The retention cron empties metadata in place after 365 days. Building a
  // description from the empty object would produce a confident-looking blank.
  it("says so when a row's details were removed by the retention cron", () => {
    const merged = mergeTimeline({
      events: [event({ id: "e1", kind: "sms_inbound", metadata: {}, scrubbed_at: "2027-09-01T00:00:00.000Z" })],
      payments: [],
      bookings: [],
    })
    expect(merged[0].scrubbed).toBe(true)
    expect(merged[0].detail).toBe("The details of this were removed after 365 days.")
  })

  it("keeps an unscrubbed row's own detail", () => {
    const merged = mergeTimeline({
      events: [event({ id: "e1", kind: "sms_inbound", metadata: { body: "hi there" }, scrubbed_at: null })],
      payments: [],
      bookings: [],
    })
    expect(merged[0].scrubbed).toBe(false)
    expect(merged[0].detail).toBe("hi there")
  })
})

describe("describeTimelineEvent", () => {
  it("names the entry point from its source", () => {
    expect(describeTimelineEvent(event({ id: "e", kind: "entry_point", source: "newsletter" })).title).toBe(
      "Signed up for the newsletter",
    )
  })

  it("has a default arm — `kind` has no CHECK constraint, so a new kind must still render", () => {
    const described = describeTimelineEvent(event({ id: "e", kind: "some_future_kind_nobody_wrote_yet" }))
    expect(described.title).toBe("Some future kind nobody wrote yet")
    expect(described.title).not.toBe("")
  })

  // identifier_conflict metadata holds a SECOND PERSON'S raw identifier.
  it("masks the email in an identifier conflict rather than printing it", () => {
    const described = describeTimelineEvent(
      event({
        id: "e",
        kind: "identifier_conflict",
        metadata: { field: "email", submitted: "someone@secret.com", existing: "jane@example.com" },
      }),
    )
    expect(described.detail).toContain("s***@s***")
    expect(described.detail).not.toContain("someone@secret.com")
  })

  it("masks a phone conflict with the phone masker, keeping the country code", () => {
    const described = describeTimelineEvent(
      event({
        id: "e",
        kind: "identifier_conflict",
        metadata: { field: "phone", submitted: "+18135550142", existing: "+18135550001" },
      }),
    )
    expect(described.title).toBe("Gave a different phone number")
    expect(described.detail).toContain("+1")
    expect(described.detail).toContain("42")
    expect(described.detail).not.toContain("8135550142")
  })

  it("marks a STOP as a negative event", () => {
    const described = describeTimelineEvent(event({ id: "e", kind: "sms_stop_received" }))
    expect(described.title).toBe("Texted STOP")
    expect(described.tone).toBe("danger")
  })
})

describe("formatMoney", () => {
  it("renders cents as dollars", () => {
    expect(formatMoney(18000, "usd")).toBe("$180.00")
  })

  it("does not throw on a malformed currency code", () => {
    expect(formatMoney(1000, "not-a-currency")).toContain("10.00")
  })
})
