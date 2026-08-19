import { describe, it, expect } from "vitest"
import {
  decideMove,
  stalenessOf,
  REBOOKING_SUPPRESSION_DAYS,
  type MoveContext,
  type StageRow,
} from "@/lib/lead-engine/pipeline-move"

const STAGES: StageRow[] = [
  { id: "s1", key: "consult_booked", name: "Consult Booked", position: 1, kind: "open", amber_after_days: 3, red_after_days: 7 },
  { id: "s2", key: "consulted",      name: "Consulted",      position: 2, kind: "open", amber_after_days: 5, red_after_days: 14 },
  { id: "s3", key: "won",            name: "Won",            position: 3, kind: "won",  amber_after_days: null, red_after_days: null },
  { id: "s4", key: "lost",           name: "Lost",           position: 4, kind: "lost", amber_after_days: null, red_after_days: null },
]

const NOW = new Date("2026-08-19T12:00:00Z")

function ctx(over: Partial<MoveContext> = {}): MoveContext {
  return { now: NOW, stages: STAGES, current: null, ...over }
}

function openAt(key: string, enteredIso = "2026-08-19T09:00:00Z") {
  const s = STAGES.find((x) => x.key === key)!
  return {
    id: "opp-1", stage_id: s.id, stage_position: s.position, stage_kind: s.kind,
    entered_stage_at: enteredIso, outcome: null, closed_trigger: null, closed_at: null,
    value_cents: null,
  }
}

function closedAt(outcome: "won" | "lost", trigger: "manual" | "booking" | "payment" | "reconciler", closedIso: string) {
  const s = STAGES.find((x) => x.kind === outcome)!
  return {
    id: "opp-1", stage_id: s.id, stage_position: s.position, stage_kind: s.kind,
    entered_stage_at: closedIso, outcome, closed_trigger: trigger, closed_at: closedIso,
    value_cents: null,
  }
}

/** A Won opportunity carrying a specific value_cents — the shape refund events amend. */
function wonAt(
  valueCents: number | null,
  closedIso = "2026-08-18T12:00:00Z",
  trigger: "manual" | "booking" | "payment" | "reconciler" = "payment",
) {
  const s = STAGES.find((x) => x.kind === "won")!
  return {
    id: "opp-1", stage_id: s.id, stage_position: s.position, stage_kind: s.kind,
    entered_stage_at: closedIso, outcome: "won" as const, closed_trigger: trigger, closed_at: closedIso,
    value_cents: valueCents,
  }
}

describe("decideMove — creation", () => {
  it("creates a card at Consult Booked when a booking is scheduled and nothing exists", () => {
    const d = decideMove(ctx(), { kind: "booking", status: "scheduled", occurredAt: NOW })
    expect(d).toEqual({ kind: "create", toStageKey: "consult_booked", trigger: "booking" })
  })

  it("creates directly at Consulted when the scheduled webhook was missed", () => {
    // The consult demonstrably happened; a dropped 'scheduled' hook must not
    // cost us the card.
    const d = decideMove(ctx(), { kind: "booking", status: "completed", occurredAt: NOW })
    expect(d).toEqual({ kind: "create", toStageKey: "consulted", trigger: "booking" })
  })

  it("creates an already-won card when a payment arrives with no prior deal", () => {
    const d = decideMove(ctx(), { kind: "payment", amountCents: 120000, currency: "usd", occurredAt: NOW })
    expect(d).toMatchObject({ kind: "create", toStageKey: "won", outcome: "won", valueCents: 120000 })
  })
})

describe("decideMove — advancing, and never backwards", () => {
  it("advances Consult Booked to Consulted on booking.completed", () => {
    const d = decideMove(ctx({ current: openAt("consult_booked") }), {
      kind: "booking", status: "completed", occurredAt: NOW,
    })
    expect(d).toEqual({ kind: "advance", toStageKey: "consulted", trigger: "booking" })
  })

  it("does NOT move a Consulted card back on a later booking.scheduled", () => {
    const d = decideMove(ctx({ current: openAt("consulted") }), {
      kind: "booking", status: "scheduled", occurredAt: NOW,
    })
    expect(d.kind).toBe("noop")
  })

  it("does NOT re-advance a Consulted card on a duplicate booking.completed", () => {
    // Boundary case the "never backwards" test above doesn't reach: the target
    // stage EQUALS the card's current stage (a repeated/duplicate webhook),
    // not strictly behind it. Same-stage must be a noop, not a redundant advance.
    const d = decideMove(ctx({ current: openAt("consulted") }), {
      kind: "booking", status: "completed", occurredAt: NOW,
    })
    expect(d.kind).toBe("noop")
  })

  it("wins an open card on payment", () => {
    const d = decideMove(ctx({ current: openAt("consulted") }), {
      kind: "payment", amountCents: 95000, currency: "usd", occurredAt: NOW,
    })
    expect(d).toMatchObject({ kind: "close", outcome: "won", valueCents: 95000, trigger: "payment" })
  })

  it("loses an open card on a cancellation, recording which kind", () => {
    const d = decideMove(ctx({ current: openAt("consult_booked") }), {
      kind: "booking", status: "no_show", occurredAt: NOW,
    })
    expect(d).toMatchObject({ kind: "close", outcome: "lost", reason: "booking_no_show" })
  })
})

describe("decideMove — a human's close is final (spec §2.4)", () => {
  it("refuses to win a card a human marked Lost", () => {
    const d = decideMove(
      ctx({ current: closedAt("lost", "manual", "2026-08-18T12:00:00Z") }),
      { kind: "payment", amountCents: 50000, currency: "usd", occurredAt: NOW },
    )
    expect(d).toEqual({ kind: "refuse", reason: "human_close_is_final" })
  })

  it("DOES win a card the system auto-lost — a no-show who later pays", () => {
    const d = decideMove(
      ctx({ current: closedAt("lost", "booking", "2026-08-18T12:00:00Z") }),
      { kind: "payment", amountCents: 50000, currency: "usd", occurredAt: NOW },
    )
    expect(d).toMatchObject({ kind: "close", outcome: "won", valueCents: 50000 })
  })

  it("refuses a new card when they re-book inside the suppression window", () => {
    const d = decideMove(
      ctx({ current: closedAt("lost", "manual", "2026-08-10T12:00:00Z") }), // 9 days
      { kind: "booking", status: "scheduled", occurredAt: NOW },
    )
    expect(d).toEqual({ kind: "refuse", reason: "suppressed_after_manual_lost" })
  })

  it("allows a new card once the suppression window has passed", () => {
    const past = new Date(NOW.getTime() - (REBOOKING_SUPPRESSION_DAYS + 1) * 86400000)
    const d = decideMove(
      ctx({ current: closedAt("lost", "manual", past.toISOString()) }),
      { kind: "booking", status: "scheduled", occurredAt: NOW },
    )
    expect(d.kind).toBe("create")
  })

  it("treats a re-booking after a WON deal as a new deal, not a suppression", () => {
    const d = decideMove(
      ctx({ current: closedAt("won", "manual", "2026-08-18T12:00:00Z") }),
      { kind: "booking", status: "scheduled", occurredAt: NOW },
    )
    expect(d.kind).toBe("create")
  })
})

describe("decideMove — refunds (spec §14)", () => {
  it("does nothing when the contact has no opportunity at all", () => {
    const d = decideMove(ctx({ current: null }), {
      kind: "refund", amountRefundedCents: 5000, occurredAt: NOW,
    })
    expect(d).toEqual({ kind: "noop", reason: "no_won_opportunity" })
  })

  it("does nothing when the most recent opportunity is Lost, not Won", () => {
    const d = decideMove(ctx({ current: closedAt("lost", "booking", "2026-08-18T12:00:00Z") }), {
      kind: "refund", amountRefundedCents: 5000, occurredAt: NOW,
    })
    expect(d).toEqual({ kind: "noop", reason: "no_won_opportunity" })
  })

  it("a full refund zeroes value_cents and reads 'refunded'", () => {
    const d = decideMove(ctx({ current: wonAt(120000) }), {
      kind: "refund", amountRefundedCents: 120000, occurredAt: NOW,
    })
    expect(d).toEqual({ kind: "amend", valueCents: 0, outcomeReason: "refunded", trigger: "payment" })
  })

  it("a partial refund subtracts and reads 'partially_refunded'", () => {
    const d = decideMove(ctx({ current: wonAt(120000) }), {
      kind: "refund", amountRefundedCents: 10000, occurredAt: NOW,
    })
    expect(d).toEqual({ kind: "amend", valueCents: 110000, outcomeReason: "partially_refunded", trigger: "payment" })
  })

  it("an over-refund clamps at 0 rather than going negative", () => {
    const d = decideMove(ctx({ current: wonAt(5000) }), {
      kind: "refund", amountRefundedCents: 999999, occurredAt: NOW,
    })
    expect(d).toEqual({ kind: "amend", valueCents: 0, outcomeReason: "refunded", trigger: "payment" })
  })

  it("treats a null value_cents as zero rather than throwing", () => {
    const d = decideMove(ctx({ current: wonAt(null) }), {
      kind: "refund", amountRefundedCents: 100, occurredAt: NOW,
    })
    expect(d).toEqual({ kind: "amend", valueCents: 0, outcomeReason: "refunded", trigger: "payment" })
  })

  // Stripe's charge.amount_refunded is CUMULATIVE per charge — a second,
  // later partial refund on the same charge reports the running total, not
  // just the new increment. `previouslyRefundedCents` is the impure caller's
  // ledger read (highest amount_refunded already recorded for this charge);
  // decideMove computes the delta itself so the same cumulative figure is
  // never subtracted twice — the highest-risk failure mode named in the task.
  describe("idempotency — the delta against previouslyRefundedCents", () => {
    it("a second delivery reporting the SAME cumulative amount changes nothing", () => {
      const d = decideMove(ctx({ current: wonAt(110000), previouslyRefundedCents: 10000 }), {
        kind: "refund", amountRefundedCents: 10000, occurredAt: NOW,
      })
      expect(d).toEqual({ kind: "noop", reason: "refund_already_applied" })
    })

    it("a stale/lower redelivery also changes nothing", () => {
      const d = decideMove(ctx({ current: wonAt(110000), previouslyRefundedCents: 10000 }), {
        kind: "refund", amountRefundedCents: 4000, occurredAt: NOW,
      })
      expect(d).toEqual({ kind: "noop", reason: "refund_already_applied" })
    })

    it("a genuinely new partial refund on the same charge applies only the delta", () => {
      // First refund already took value_cents from 120000 to 110000 (and is
      // already recorded: previouslyRefundedCents=10000). A second, later
      // partial refund brings the charge's cumulative amount_refunded to
      // 25000 — only the NEW 15000 must come off, not the full 25000 again.
      const d = decideMove(ctx({ current: wonAt(110000), previouslyRefundedCents: 10000 }), {
        kind: "refund", amountRefundedCents: 25000, occurredAt: NOW,
      })
      expect(d).toEqual({ kind: "amend", valueCents: 95000, outcomeReason: "partially_refunded", trigger: "payment" })
    })
  })
})

describe("stalenessOf", () => {
  const stage = STAGES[0] // amber 3, red 7

  it("is fresh below the amber threshold", () => {
    expect(stalenessOf(stage, "2026-08-17T12:00:00Z", NOW)).toBe("fresh") // 2 days
  })

  it("turns amber exactly ON the amber threshold", () => {
    expect(stalenessOf(stage, "2026-08-16T12:00:00Z", NOW)).toBe("amber") // 3 days
  })

  it("turns red exactly ON the red threshold", () => {
    expect(stalenessOf(stage, "2026-08-12T12:00:00Z", NOW)).toBe("red") // 7 days
  })

  it("never marks a closed card stale", () => {
    expect(stalenessOf(STAGES[3], "2020-01-01T00:00:00Z", NOW)).toBe("fresh")
  })

  it("never marks a closed card stale, even if its row carries thresholds", () => {
    // The seeded lost/won stages always have null thresholds, so that alone
    // can't prove the "closed stages are never stale" rule holds — it would
    // read "fresh" from the null checks regardless of stage.kind. Give a
    // closed stage real thresholds so only the kind guard can save it.
    const lostWithThresholds = { ...STAGES[3], amber_after_days: 3, red_after_days: 7 }
    expect(stalenessOf(lostWithThresholds, "2020-01-01T00:00:00Z", NOW)).toBe("fresh")
  })

  it("is fresh when the stage sets no thresholds", () => {
    const noThresh = { ...stage, amber_after_days: null, red_after_days: null }
    expect(stalenessOf(noThresh, "2020-01-01T00:00:00Z", NOW)).toBe("fresh")
  })
})
