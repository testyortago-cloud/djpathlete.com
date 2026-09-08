// __tests__/lib/lead-engine/sequence-exit-reasons.test.ts
//
// The one place a `sequence_runs.exit_reason` value becomes a sentence a coach
// can read, shared by components/admin/sequences/SequenceRunsTable.tsx and
// components/admin/contacts/ContactDetail.tsx. Fixing the drift between those
// two screens for `sequence_edited` is the whole point of this file existing,
// so every known reason gets its own test asserting the EXACT sentence — not
// merely that some sentence rendered.

import { describe, it, expect } from "vitest"
import { exitReasonSentence } from "@/lib/lead-engine/sequence-exit-reasons"

describe("exitReasonSentence — every reason confirmed to reach the database today", () => {
  // Confirmed by grepping the verb that performs the exit across BOTH
  // TypeScript (app/api/stripe/webhook/route.ts, lib/bookings/ingest.ts,
  // lib/lead-engine/unsubscribe.ts, app/api/webhooks/twilio/inbound/route.ts,
  // lib/automation/sequence-tick.ts) AND SQL (migrations 00238 and 00256) —
  // a TypeScript-only grep has produced a false "no writers" conclusion in
  // this repo before, because `merge_contacts` is plpgsql.
  it("payment", () => {
    expect(exitReasonSentence("payment")).toBe("Bought something")
  })

  it("booking", () => {
    expect(exitReasonSentence("booking")).toBe("Booked a call")
  })

  it("unsubscribed", () => {
    expect(exitReasonSentence("unsubscribed")).toBe("Clicked unsubscribe in an email")
  })

  it("sms_stop", () => {
    expect(exitReasonSentence("sms_stop")).toBe("Replied STOP to a text")
  })

  // Written by lib/automation/sequence-tick.ts:116, a value the exported
  // SequenceExitReason union does not declare — the union does not close
  // the set of reasons that can actually reach the database.
  it("suppressed", () => {
    expect(exitReasonSentence("suppressed")).toBe("Was already on your do-not-contact list")
  })

  // Written by migration 00238's merge_contacts plpgsql function, not from a
  // button — a TypeScript-only writer search would miss this one.
  it("merged_into_survivor", () => {
    expect(exitReasonSentence("merged_into_survivor")).toBe(
      "Their details were merged into another person's record.",
    )
  })

  it("superseded_by_merged_run", () => {
    expect(exitReasonSentence("superseded_by_merged_run")).toBe(
      "They were already in this sequence under another record.",
    )
  })

  // The reason this whole file exists: reporting this the same way as
  // "Reached the end" would be the exact lie this feature was built to
  // prevent, and the two screens disagreeing about it (fixed here) was the
  // Important finding from round 1's review.
  it("sequence_edited", () => {
    expect(exitReasonSentence("sequence_edited")).toBe("Stopped because the sequence was edited")
  })
})

describe("exitReasonSentence — no exit reason", () => {
  it("returns null for null, rather than an empty or placeholder string", () => {
    expect(exitReasonSentence(null)).toBeNull()
  })
})

describe("exitReasonSentence — the default arm, which is load-bearing", () => {
  // exit_reason is plain `text` with no check constraint, and exitRun/
  // exitRunsForContact take a plain `string`. A reason invented tomorrow with
  // no line written for it yet must still read as something, and never as
  // the raw underscored database value.
  it("humanizes an unknown reason instead of showing the raw slug", () => {
    // MUTANT: return the raw `reason` unchanged (the old SequenceRunsTable.tsx
    // behaviour). This assertion is the exact wording rule the review named:
    // "never as a raw underscored slug."
    expect(exitReasonSentence("refunded_and_left")).toBe("Refunded and left")
  })

  it("never leaves an underscore in an unknown reason's rendered text", () => {
    const sentence = exitReasonSentence("some_brand_new_reason")
    expect(sentence).not.toContain("_")
  })

  it("does not merely capitalize — it also replaces every underscore, not just the first", () => {
    // Presence control for the "replaces every underscore" half of humanize:
    // a naive implementation that only fixes ONE underscore would still pass
    // the "not toContain _" test above if the reason had only one, so this
    // uses a reason with three.
    expect(exitReasonSentence("a_b_c_d")).toBe("A b c d")
  })

  it("still returns a non-empty, capitalized sentence for a single-word unknown reason", () => {
    // Presence control: proves humanize() is actually running (capitalizing),
    // not just stripping underscores that happen not to be there.
    expect(exitReasonSentence("mystery")).toBe("Mystery")
  })
})

describe("exitReasonSentence — known reasons never fall through to the humanizer", () => {
  it("does not merely humanize sequence_edited's underscore — it uses the written sentence", () => {
    // MUTANT this guards against: deleting sequence_edited from KNOWN_REASONS
    // so it falls through to humanize("sequence_edited") = "Sequence edited".
    // That reads as plausible prose, which is exactly why a positive
    // assertion for the WRITTEN sentence — not merely "not the raw slug" — is
    // needed here, separate from the "database has no writers" test above.
    const sentence = exitReasonSentence("sequence_edited")
    expect(sentence).not.toBe("Sequence edited")
    expect(sentence).toBe("Stopped because the sequence was edited")
  })
})
