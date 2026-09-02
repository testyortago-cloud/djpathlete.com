// @vitest-environment node
//
// The pure half of the contact detail screen: the booking match, the timeline
// merge, and the per-kind describer.
//
// NODE ENVIRONMENT, PINNED. Every jsdom suite in this repo currently cannot
// start — `require() of ES Module ... html-encoding-sniffer` — and vitest
// reports that as "Test Files no tests" rather than as a failure. A jsdom suite
// here would look green while executing nothing.
//
// These three functions are exported and tested directly, rather than only
// through `getContactDetail`, because they are where the screen can be wrong in
// ways that still render: a booking match that is too loose puts a DIFFERENT
// person's calls on this record, and a merge that drops a source silently omits
// the money.
import { describe, expect, it } from "vitest"
import {
  bookingMatchesContact,
  describeTimelineEvent,
  formatMoney,
  mergeTimeline,
  type BookingRow,
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
    contact_email: "jane@example.com",
    contact_phone: "(813) 555-0142",
    booking_date: "2026-08-21T14:00:00.000Z",
    duration_minutes: 30,
    status: "scheduled",
    source: "ghl",
    created_at: "2026-08-19T12:00:00.000Z",
    ...over,
  }
}

describe("bookingMatchesContact", () => {
  // THE REGRESSION THIS FUNCTION EXISTS FOR. `bookings.contact_phone` is stored
  // in US national format exactly as GoHighLevel sent it, while
  // `contacts.phone_e164` holds E.164. A `.eq()` between the two columns
  // matches nothing, forever, and renders as "never booked a call".
  it("matches a national-format booking phone against an E.164 contact phone", () => {
    expect(
      bookingMatchesContact({ contact_email: "someone.else@example.com", contact_phone: "(813) 555-0142" }, {
        email: "jane@example.com",
        phone: "+18135550142",
      }),
    ).toBe(true)
  })

  it("matches a mixed-case booking email against a lowercased contact email", () => {
    expect(
      bookingMatchesContact({ contact_email: "Jane@Example.COM", contact_phone: null }, {
        email: "jane@example.com",
        phone: null,
      }),
    ).toBe(true)
  })

  // THE DISCLOSURE GUARD. `_` and `%` are LIKE wildcards and both are legal in
  // the emails EMAIL_RE accepts, so an `.ilike()` implementation would match
  // `axb@x.com` for a contact whose address is `a_b@x.com` — putting a second
  // person's booked calls on this person's record.
  it("does NOT treat an underscore in an email as a wildcard", () => {
    expect(
      bookingMatchesContact({ contact_email: "axb@x.com", contact_phone: null }, {
        email: "a_b@x.com",
        phone: null,
      }),
    ).toBe(false)
  })

  // THE SHARPER VERSION OF THE SAME GUARD, and the one that actually holds the
  // implementation down. A mutation sweep caught the first attempt at this test
  // passing VACUOUSLY: it used "%@x.com" as the contact email, but `%` is not in
  // the character class EMAIL_RE accepts, so `normaliseEmail` returned null and
  // the function bailed before comparing anything. It asserted the right answer
  // for the wrong reason, and a substring-matching implementation survived it.
  //
  // This one cannot pass vacuously — both addresses are valid, and one CONTAINS
  // the other. Exact equality says no; any `includes` / `ilike` / prefix
  // comparison says yes and hands this contact a stranger's booked call.
  it("does NOT match a booking whose email merely CONTAINS the contact's", () => {
    expect(
      bookingMatchesContact({ contact_email: "rob@x.com", contact_phone: null }, {
        email: "ob@x.com",
        phone: null,
      }),
    ).toBe(false)
  })

  it("does NOT match a booking phone that merely contains the contact's digits", () => {
    expect(
      bookingMatchesContact({ contact_email: "other@example.com", contact_phone: "+1 813 555 01423" }, {
        email: null,
        phone: "+18135550142",
      }),
    ).toBe(false)
  })

  it("does not match a different person who shares neither identifier", () => {
    expect(
      bookingMatchesContact({ contact_email: "other@example.com", contact_phone: "(212) 555-9999" }, {
        email: "jane@example.com",
        phone: "+18135550142",
      }),
    ).toBe(false)
  })

  // A contact with no identifiers must match NOTHING. The dangerous failure is
  // the opposite: null == null coming out true and attaching every booking that
  // also has a null phone.
  it("a contact with no identifiers matches no booking", () => {
    expect(
      bookingMatchesContact({ contact_email: "jane@example.com", contact_phone: null }, {
        email: null,
        phone: null,
      }),
    ).toBe(false)
  })

  // THE EMAIL LEG OF THE NULL GUARD. A mutation sweep found `contactEmail !== null`
  // was unpinned: every other case gave the booking a valid email, so nothing
  // exercised null-on-both-sides for the EMAIL comparison. normaliseEmail(null)
  // === normaliseEmail(null) is null === null, which is true — without the guard
  // this booking attaches to any contact with no email address on file.
  it("a null booking email does not match a contact with no email", () => {
    expect(
      bookingMatchesContact({ contact_email: null as unknown as string, contact_phone: "(212) 555-9999" }, {
        email: null,
        phone: "+18135550142",
      }),
    ).toBe(false)
  })

  it("an unparseable booking email does not match a contact whose email is also unparseable", () => {
    expect(
      bookingMatchesContact({ contact_email: "not-an-email", contact_phone: null }, {
        email: "also-not-an-email",
        phone: null,
      }),
    ).toBe(false)
  })

  it("a null booking phone does not match a null contact phone", () => {
    expect(
      bookingMatchesContact({ contact_email: "other@example.com", contact_phone: null }, {
        email: "jane@example.com",
        phone: null,
      }),
    ).toBe(false)
  })

  it("an unparseable phone on either side does not match", () => {
    expect(
      bookingMatchesContact({ contact_email: "other@example.com", contact_phone: "not a phone" }, {
        email: "jane@example.com",
        phone: "also not a phone",
      }),
    ).toBe(false)
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
