// @vitest-environment node
//
// The one place a `sequence_runs` row becomes the short badge a coach reads on
// a LIST. Its long-form sibling is lib/lead-engine/sequence-exit-reasons.ts,
// which writes the full sentence for a single run on a DETAIL screen; this
// file is what fits in a table cell, and the two must agree — the detail text
// here is that function's output, never a second wording of it.
//
// EVERY ASSERTION NAMES THE LABEL. "a label came back" passes just as happily
// when somebody who unsubscribed is shown as still being messaged, which is
// the one mistake on this surface that has a compliance cost rather than a
// cosmetic one.
import { describe, it, expect } from "vitest"

import { describeSequenceStatus, type LatestSequenceRun } from "@/lib/lead-engine/sequence-status"

function run(overrides: Partial<LatestSequenceRun> = {}): LatestSequenceRun {
  return {
    status: "active",
    exit_reason: null,
    current_position: 2,
    sequence_name: "New Lead Nurture",
    messagePositions: [0, 2, 4, 6],
    ...overrides,
  }
}

describe("describeSequenceStatus", () => {
  it("says which follow-up somebody is on and how many messages have gone", () => {
    const status = describeSequenceStatus(run())

    expect(status.label).toBe("New Lead Nurture · 1 of 4 sent")
    expect(status.tone).toBe("info")
  })

  it("counts MESSAGES, not steps — the fixture's sequence is 8 rows that send 4", () => {
    // `new_lead_nurture` in production is eight rows: three emails, one text,
    // three waits and a stop. "of 8" invites a coach to expect eight things to
    // arrive, and `alert` steps do not even go to the person — they go to the
    // coach. The positions here are the four that message somebody.
    expect(describeSequenceStatus(run()).label).toContain("of 4 sent")
    expect(describeSequenceStatus(run()).label).not.toContain("8")
  })

  it("says NONE have gone for somebody who has just been enrolled", () => {
    // position 0 is somebody who has had nothing yet. "step 1 of 4" would
    // overstate that; "0 of 4 sent" is exactly true.
    expect(describeSequenceStatus(run({ current_position: 0 })).label).toBe("New Lead Nurture · 0 of 4 sent")
  })

  it("says ALL have gone for a run parked past its last message", () => {
    // The end of the run is where "step N of M" is wrong in the other
    // direction: somebody sitting on the wait after the final message has had
    // all four, not three.
    expect(describeSequenceStatus(run({ current_position: 7 })).label).toBe("New Lead Nurture · 4 of 4 sent")
    // And it never runs past the total, however far the position has gone.
    expect(describeSequenceStatus(run({ current_position: 99 })).label).toBe("New Lead Nurture · 4 of 4 sent")
  })

  it("names the follow-up alone when the message positions could not be read", () => {
    // null is "we do not know", which is not the same as an empty list — a
    // sequence that genuinely messages nobody. Neither earns a count.
    expect(describeSequenceStatus(run({ messagePositions: null })).label).toBe("New Lead Nurture")
    expect(describeSequenceStatus(run({ messagePositions: [] })).label).toBe("New Lead Nurture")
  })

  it("shows nothing for somebody in no follow-up at all", () => {
    const status = describeSequenceStatus(null)

    expect(status.label).toBe("—")
    expect(status.tone).toBe("neutral")
    expect(status.detail).toBeNull()
  })

  it("says Bought for a run that ended in a payment", () => {
    const status = describeSequenceStatus(run({ status: "exited", exit_reason: "payment" }))

    expect(status.label).toBe("Bought")
    expect(status.tone).toBe("success")
    expect(status.detail).toBe("Bought something")
  })

  it("says Booked a call for a run that ended in a booking", () => {
    expect(describeSequenceStatus(run({ status: "exited", exit_reason: "booking" })).label).toBe("Booked a call")
  })

  it("collapses all THREE ways of saying stop into one Opted out badge", () => {
    // The badge collapses them; the detail does not. An email unsubscribe, a
    // texted STOP and "already on the do-not-contact list" are three different
    // things a coach would act on differently, and the sentence is where that
    // difference survives.
    for (const reason of ["unsubscribed", "sms_stop", "suppressed"]) {
      const status = describeSequenceStatus(run({ status: "exited", exit_reason: reason }))
      expect(status.label, reason).toBe("Opted out")
      expect(status.tone, reason).toBe("warning")
    }

    expect(describeSequenceStatus(run({ status: "exited", exit_reason: "unsubscribed" })).detail).toBe(
      "Clicked unsubscribe in an email",
    )
    expect(describeSequenceStatus(run({ status: "exited", exit_reason: "sms_stop" })).detail).toBe(
      "Replied STOP to a text",
    )
  })

  it("says Finished for a run that reached the end", () => {
    const status = describeSequenceStatus(run({ status: "completed", exit_reason: null }))

    expect(status.label).toBe("Finished")
    expect(status.tone).toBe("neutral")
  })

  it("SURFACES a failed run rather than showing it as nothing", () => {
    // 73 of the 77 runs in production are `failed` — the incident CLAUDE.md
    // records. The ledger row for this column never mentioned the status, and
    // rendering them as "—" would tell a coach that 73 people are simply not
    // in a follow-up, when what actually happened is that theirs broke.
    const status = describeSequenceStatus(run({ status: "failed", exit_reason: null }))

    expect(status.label).toBe("Stopped early")
    expect(status.tone).toBe("danger")
    expect(status.detail).toMatch(/problem/i)
  })

  it("still says something for an exit reason nobody has written a sentence for", () => {
    // exit_reason is plain text with no check constraint, and this repo has
    // twice had a new value arrive from code that the union did not declare.
    const status = describeSequenceStatus(run({ status: "exited", exit_reason: "refunded_and_left" }))

    expect(status.label).toBe("Stopped")
    expect(status.detail).toBe("Refunded and left")
    expect(status.detail).not.toContain("_")
  })

  it("does not claim a reason for an exited run that recorded none", () => {
    const status = describeSequenceStatus(run({ status: "exited", exit_reason: null }))

    expect(status.label).toBe("Stopped")
    expect(status.detail).toBeNull()
  })

  it("treats a status nobody has planned for as unknown rather than as active", () => {
    // `sequence_runs.status` is text too. Falling through to the active arm
    // would print a message count for a run that is not running — the column
    // saying somebody is being messaged when nobody knows that.
    const status = describeSequenceStatus(run({ status: "paused_by_something_new" }))

    expect(status.label).toBe("Paused by something new")
    expect(status.tone).toBe("neutral")
    expect(status.label).not.toContain("sent")
  })
})
