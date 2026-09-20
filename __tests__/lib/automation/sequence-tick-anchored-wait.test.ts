// @vitest-environment node
//
// G11 — a `wait` step that counts down to a fixed moment (`sequence_runs.anchor_at`)
// instead of counting up from enrolment.
//
// WHY THIS IS A SEPARATE FILE from sequence-tick.test.ts: every case here
// turns on the relationship between three clocks — `now`, the anchor, and the
// step's offset — and the fixtures below exist to make that relationship
// readable. Mixing them into the general decideStep file made each test carry
// three dates whose significance was invisible.
//
// THE SHAPE UNDER TEST is the one `camp_clinic_deadline` is being reseeded to:
// a countdown of wait/email pairs at 14, 7, 3 and 1 days before the camp.
import { describe, it, expect } from "vitest"
import { decideStep } from "@/lib/automation/sequence-tick"
import type { DecisionContext, SequenceStepRow, SequenceRunRow } from "@/lib/automation/sequence-tick"

const CAMP_STARTS = "2026-07-01T09:00:00Z"

/** `days` before the camp, as an instant. Keeps every expectation below readable. */
function daysBeforeCamp(days: number): Date {
  return new Date(new Date(CAMP_STARTS).getTime() - days * 24 * 60 * 60 * 1000)
}

const run: SequenceRunRow = {
  id: "run-1",
  sequence_id: "seq-1",
  contact_id: "c-1",
  current_position: 0,
  enrolled_at: "2026-06-01T00:00:00Z",
  attempts: 1,
}

function step(over: Partial<SequenceStepRow> & { position: number; kind: SequenceStepRow["kind"] }): SequenceStepRow {
  return {
    id: `s-${over.position}`,
    wait_minutes: null,
    subject: null,
    body: null,
    branch_condition: null,
    on_true_position: null,
    on_false_position: null,
    config: {},
    ...over,
  }
}

/** A wait step anchored `days` before the camp. */
function anchoredWait(position: number, days: number): SequenceStepRow {
  return step({ position, kind: "wait", config: { wait_until: { days_before_anchor: days } } })
}

function emailAt(position: number, subject: string): SequenceStepRow {
  return step({ position, kind: "email", subject, body: "Body" })
}

function ctx(over: Partial<DecisionContext> = {}): DecisionContext {
  return {
    now: daysBeforeCamp(20),
    timezone: "America/New_York",
    quiet: { startHour: 8, endHour: 21 },
    dailyCap: 1,
    sentAtToday: [],
    activeSiblings: [],
    contact: { email: "a@example.com", phone_e164: null, user_id: null, name: null },
    hasEmailConsent: false,
    hasSmsConsent: false,
    isSuppressed: false,
    enrolledSource: "event_signup",
    lastEmail: null,
    enrolmentMetadata: {},
    anchorAt: CAMP_STARTS,
    ...over,
  }
}

/** The countdown `camp_clinic_deadline` is being reseeded to: 14 / 7 / 3 / 1. */
const COUNTDOWN: SequenceStepRow[] = [
  anchoredWait(0, 14),
  emailAt(1, "Two weeks to go"),
  anchoredWait(2, 7),
  emailAt(3, "One week to go"),
  anchoredWait(4, 3),
  emailAt(5, "Three days to go"),
  anchoredWait(6, 1),
  emailAt(7, "Tomorrow"),
  step({ position: 8, kind: "stop" }),
]

describe("an anchored wait whose moment is still ahead", () => {
  it("holds the run until exactly N days before the event", () => {
    // Enrolled 20 days out, first reminder at 14 days out: the run waits, and
    // the moment it waits for is the CAMP's, not the enrolment's. This is the
    // whole row in one assertion — before G11 this returned `now + 0 minutes`
    // and sent "two weeks to go" 20 days out.
    expect(decideStep(run, COUNTDOWN, ctx({ now: daysBeforeCamp(20) }))).toEqual({
      kind: "advance",
      toPosition: 1,
      deferUntil: daysBeforeCamp(14),
    })
  })

  it("is the same instant whenever the person signed up", () => {
    // Two people, four months apart, same camp: the reminder lands at the
    // same moment for both. Enrolment-relative timing cannot express this,
    // which is why the column exists.
    const early = decideStep(run, COUNTDOWN, ctx({ now: daysBeforeCamp(120) }))
    const late = decideStep(run, COUNTDOWN, ctx({ now: daysBeforeCamp(15) }))
    expect(early).toEqual({ kind: "advance", toPosition: 1, deferUntil: daysBeforeCamp(14) })
    expect(late).toEqual(early)
  })

  it("treats days_before_anchor: 0 as the event's own start", () => {
    const steps = [anchoredWait(0, 0), emailAt(1, "Starting now")]
    expect(decideStep(run, steps, ctx({ now: daysBeforeCamp(2) }))).toEqual({
      kind: "advance",
      toPosition: 1,
      deferUntil: new Date(CAMP_STARTS),
    })
  })
})

describe("an anchored wait whose moment has already passed", () => {
  it("skips the reminders that are in the past and lands on the next one still ahead", () => {
    // Signed up 5 days out. "Two weeks to go" and "one week to go" are both
    // nonsense now, so neither is sent; the run resumes at the 3-day wait.
    // Sending them anyway is the failure this case exists to prevent — and
    // it is what a plain `advance` would do, because an advance with a defer
    // in the past is claimed again immediately.
    expect(decideStep(run, COUNTDOWN, ctx({ now: daysBeforeCamp(5) }))).toEqual({
      kind: "advance",
      toPosition: 4,
      note: "anchor_moment_passed",
    })
  })

  it("sends nothing at all when every moment has passed, landing on the stop step", () => {
    // Signed up twelve hours before the camp: no reminder left is still true.
    //
    // It lands on the `stop` rather than completing in one decision, because
    // a `stop` is not a message and the scan halts at the first thing that is
    // not one. That is the rule doing its job, not a special case for the end
    // of the list — and the outcome a person experiences is identical.
    const action = decideStep(run, COUNTDOWN, ctx({ now: daysBeforeCamp(0.5) }))
    expect(action).toEqual({ kind: "advance", toPosition: 8, note: "anchor_moment_passed" })

    // The half that actually matters: nothing was sent, and the next decision
    // ends the run. Asserting only the advance above would pass just as well
    // if it had landed on an email.
    expect(action).not.toMatchObject({ kind: "send" })
    expect(decideStep({ ...run, current_position: 8 }, COUNTDOWN, ctx({ now: daysBeforeCamp(0.5) }))).toEqual({
      kind: "complete",
    })
  })

  it("completes outright when the countdown has no stop step to land on", () => {
    // Running off the end of the list is the other way this ends. Pinned
    // separately because it is a different line of code from the one above.
    const noStop = COUNTDOWN.slice(0, 8)
    expect(decideStep(run, noStop, ctx({ now: daysBeforeCamp(0.5) }))).toEqual({ kind: "complete" })
  })

  it("stops at an ORDINARY wait rather than skipping past it, so a post-event step survives", () => {
    // The trap this rule is shaped around. A sequence may carry a follow-up
    // AFTER the countdown — "how did it go?" — timed with ordinary
    // wait_minutes. Skipping "everything until the next anchored wait" would
    // swallow it, and the person who signed up late would get nothing at all.
    // An ordinary wait is not part of a countdown moment, so the scan stops.
    const steps = [
      anchoredWait(0, 1),
      emailAt(1, "Tomorrow"),
      step({ position: 2, kind: "wait", wait_minutes: 1440 }),
      emailAt(3, "How did it go?"),
      step({ position: 4, kind: "stop" }),
    ]
    expect(decideStep(run, steps, ctx({ now: daysBeforeCamp(0.5) }))).toEqual({
      kind: "advance",
      toPosition: 2,
      note: "anchor_moment_passed",
    })
  })

  it("skips bookkeeping that sits BETWEEN the wait and the message it gates", () => {
    // THE SHAPE THAT BROKE THE FIRST CUT, and it is buildable in the editor
    // with no hand-editing. The original rule stopped at the first step that
    // was not a message, so a `tag` in this slot ended the skip; the run then
    // advanced tag -> email on the following ticks and sent "Two weeks to go"
    // five days before the camp — exactly the thing this row exists to stop.
    //
    // A tag, stage, alert or branch sitting inside a passed moment's block
    // belongs to that moment. Skipping the reminder and keeping its
    // bookkeeping is not a coherent half — the tag says "we told them", and
    // we did not.
    const steps = [
      anchoredWait(0, 14),
      step({ position: 1, kind: "tag", config: { tag: "camp-reminded-14d" } }),
      emailAt(2, "Two weeks to go"),
      anchoredWait(3, 3),
      emailAt(4, "Three days to go"),
    ]
    expect(decideStep(run, steps, ctx({ now: daysBeforeCamp(5) }))).toEqual({
      kind: "advance",
      toPosition: 3,
      note: "anchor_moment_passed",
    })
  })

  it("does not send the stale reminder even when the run is walked forward step by step", () => {
    // The assertion the first version of the test above was missing. Landing
    // on the right POSITION is not the claim that matters; what matters is
    // that no decision reachable from here is a `send` of a message whose
    // moment has gone. Follows the run until it settles.
    const steps = [
      anchoredWait(0, 14),
      step({ position: 1, kind: "tag", config: { tag: "camp-reminded-14d" } }),
      emailAt(2, "Two weeks to go"),
      anchoredWait(3, 3),
      emailAt(4, "Three days to go"),
    ]
    const now = daysBeforeCamp(5)
    // Quiet hours are opened right up on purpose. daysBeforeCamp(5) is 05:00
    // in New York, so the ordinary guardrail would return a `defer` and this
    // walk would stop before it ever reached the send — passing for a reason
    // that has nothing to do with the anchor. Isolating the subject is the
    // only way this test can fail for the bug it is about.
    const decisionCtx = () => ctx({ now, quiet: { startHour: 0, endHour: 24 } })
    const seen: string[] = []
    let position = 0
    for (let i = 0; i < 8; i++) {
      const action = decideStep({ ...run, current_position: position }, steps, decisionCtx())
      if (action.kind === "send") {
        seen.push(`sent:${action.step.subject}`)
        break
      }
      // Emulate the runner, which is the whole point: `tag`, `stage` and
      // `alert` are SIDE EFFECTS, and sequence-tick-runner.ts performs them
      // and then calls advanceRun(position + 1). A loop that stopped at the
      // tag would prove nothing — that is precisely how the first version of
      // this test missed the bug it was written for.
      if (action.kind === "tag" || action.kind === "stage" || action.kind === "alert") {
        position = action.step.position + 1
        continue
      }
      if (action.kind !== "advance") break
      position = action.toPosition
    }
    expect(seen).not.toContain("sent:Two weeks to go")
  })

  it("skips a SPLIT inside a passed block, rather than routing into a stale reminder", () => {
    // Mutation survivor. A `branch` between a passed wait and its message is
    // routing WITHIN that stale moment — "send the text version to the ones
    // with a phone" — so evaluating it only picks which stale message to
    // send. Both of its arms are inside the block, and the block has gone.
    const steps = [
      anchoredWait(0, 14),
      step({
        position: 1,
        kind: "branch",
        branch_condition: { kind: "has_phone" },
        on_true_position: 2,
        on_false_position: 3,
      }),
      step({ position: 2, kind: "sms", body: "Two weeks to go" }),
      emailAt(3, "Two weeks to go"),
      anchoredWait(4, 3),
      emailAt(5, "Three days to go"),
    ]
    expect(decideStep(run, steps, ctx({ now: daysBeforeCamp(5) }))).toEqual({
      kind: "advance",
      toPosition: 4,
      note: "anchor_moment_passed",
    })
  })

  it("stops at a `stop` inside a passed block rather than skipping past it", () => {
    // A stop ends the run wherever it appears. Skipping it would walk the run
    // into steps that come after a deliberate terminator.
    const steps = [
      anchoredWait(0, 14),
      emailAt(1, "Two weeks to go"),
      step({ position: 2, kind: "stop" }),
      anchoredWait(3, 3),
      emailAt(4, "Three days to go"),
    ]
    expect(decideStep(run, steps, ctx({ now: daysBeforeCamp(5) }))).toEqual({
      kind: "advance",
      toPosition: 2,
      note: "anchor_moment_passed",
    })
  })

  it("skips an SMS belonging to a passed moment, not only an email", () => {
    // `sms` is a message kind too. Pinned because "skip the message" written
    // as `kind === "email"` passes every other test in this file.
    const steps = [
      anchoredWait(0, 14),
      step({ position: 1, kind: "sms", body: "Two weeks to go" }),
      anchoredWait(2, 3),
      emailAt(3, "Three days to go"),
    ]
    expect(decideStep(run, steps, ctx({ now: daysBeforeCamp(5) }))).toEqual({
      kind: "advance",
      toPosition: 2,
      note: "anchor_moment_passed",
    })
  })
})

describe("a run with no anchor", () => {
  it("EXITS with a reason rather than sending or completing", () => {
    // Reachable four ways, all real: a run enrolled before migration 00267;
    // an enrolment during the one-deploy window where the column does not
    // exist yet; a coach manually enrolling somebody into a camp sequence
    // with no event behind it; and an anchored wait added to a sequence no
    // event ever triggers. Sending is the one thing that must not happen —
    // "three days to go" before nothing is worse than silence.
    //
    // EXIT AND NOT COMPLETE IS THE LOAD-BEARING HALF. A `completed` run
    // counts towards G01's re-enrolment cooldown, so completing here would
    // lock a hand-enrolled person out of the sequence — and their REAL camp
    // signup a week later would be refused. The paired test lives in
    // enroll.test.ts ("forgives a run that ended because it had no anchor").
    expect(decideStep(run, COUNTDOWN, ctx({ anchorAt: null }))).toEqual({
      kind: "exit",
      reason: "not_anchored",
    })
  })

  it("does not disturb an ordinary wait on the same run", () => {
    // The control. A run with no anchor is completely normal for every
    // sequence that does not use anchoring, and those must be untouched.
    const steps = [step({ position: 0, kind: "wait", wait_minutes: 60 }), emailAt(1, "Hello")]
    const now = daysBeforeCamp(20)
    expect(decideStep(run, steps, ctx({ anchorAt: null, now }))).toEqual({
      kind: "advance",
      toPosition: 1,
      deferUntil: new Date(now.getTime() + 60 * 60 * 1000),
    })
  })
})

describe("an anchored wait that cannot be read", () => {
  it("fails the run rather than sending at a guessed time", () => {
    // A malformed `wait_until` must never degrade to "wait zero minutes",
    // which would fire a countdown reminder at an arbitrary moment. Failing
    // is visible: the sentence lands on sequence_runs.last_error and the
    // contact detail page renders it.
    const steps = [step({ position: 0, kind: "wait", config: { wait_until: { days_before_anchor: -3 } } })]
    expect(decideStep(run, steps, ctx())).toEqual({
      kind: "fail",
      error: "This sequence's wait step counts days before the event, so it cannot be a negative number.",
    })
  })

  it("fails rather than completing when the ANCHOR itself cannot be read", () => {
    // Distinct from a bad step config: here the step is fine and the stored
    // date is not. Reachable from a hand-edited row, or a column that ever
    // stops being a timestamp.
    //
    // It must FAIL, not complete. An Invalid Date compares false against
    // everything including itself, so without an explicit check this would
    // fall through the "still ahead" test into the skip path and quietly end
    // the run — a countdown that vanishes with no error anywhere.
    expect(decideStep(run, COUNTDOWN, ctx({ anchorAt: "not a date" }))).toEqual({
      kind: "fail",
      error: "This sequence is counting down to an event date we cannot read.",
    })
  })

  it("fails BEFORE looking at the anchor, so a bad step is reported the same way with or without one", () => {
    // Otherwise a malformed step on an un-anchored run completes silently and
    // the same step on an anchored run fails loudly — the editor error a
    // coach sees would depend on which contact happened to hit it first.
    const steps = [step({ position: 0, kind: "wait", config: { wait_until: { days_before_anchor: 2.5 } } })]
    const withAnchor = decideStep(run, steps, ctx())
    const withoutAnchor = decideStep(run, steps, ctx({ anchorAt: null }))
    expect(withAnchor).toEqual(withoutAnchor)
    expect(withAnchor.kind).toBe("fail")
  })
})

describe("the ordinary wait path is untouched", () => {
  it("still counts wait_minutes from now when there is no wait_until", () => {
    const steps = [step({ position: 0, kind: "wait", wait_minutes: 2880 }), emailAt(1, "Hi")]
    const now = daysBeforeCamp(20)
    expect(decideStep(run, steps, ctx({ now }))).toEqual({
      kind: "advance",
      toPosition: 1,
      deferUntil: new Date(now.getTime() + 2880 * 60 * 1000),
    })
  })

  it("still treats a wait with neither wait_minutes nor wait_until as zero", () => {
    const steps = [step({ position: 0, kind: "wait" }), emailAt(1, "Hi")]
    const now = daysBeforeCamp(20)
    expect(decideStep(run, steps, ctx({ now }))).toEqual({ kind: "advance", toPosition: 1, deferUntil: now })
  })

  it("ignores wait_minutes entirely when the step is anchored", () => {
    // Both columns set is a hand-edit or a half-finished conversion. The
    // anchor wins, because it is the more specific instruction — and the two
    // being silently added together would be the worst of both.
    const steps = [
      step({ position: 0, kind: "wait", wait_minutes: 99999, config: { wait_until: { days_before_anchor: 14 } } }),
      emailAt(1, "Two weeks to go"),
    ]
    expect(decideStep(run, steps, ctx({ now: daysBeforeCamp(20) }))).toEqual({
      kind: "advance",
      toPosition: 1,
      deferUntil: daysBeforeCamp(14),
    })
  })
})
