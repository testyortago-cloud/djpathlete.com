// @vitest-environment node
import { describe, it, expect } from "vitest"
import { decideStep, evaluateBranch } from "@/lib/automation/sequence-tick"
import type { DecisionContext, SequenceStepRow, SequenceRunRow } from "@/lib/automation/sequence-tick"

const run: SequenceRunRow = {
  id: "run-1",
  sequence_id: "seq-1",
  contact_id: "c-1",
  current_position: 0,
  enrolled_at: "2026-08-10T00:00:00Z",
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

function ctx(over: Partial<DecisionContext> = {}): DecisionContext {
  return {
    now: new Date("2026-08-18T18:00:00Z"), // 14:00 America/New_York
    timezone: "America/New_York",
    quiet: { startHour: 8, endHour: 21 },
    dailyCap: 1,
    sentAtToday: [],
    activeSiblings: [],
    contact: { email: "a@example.com", phone_e164: null, user_id: null, name: null },
    hasEmailConsent: false,
    hasSmsConsent: false,
    isSuppressed: false,
    enrolledSource: "funnel_form",
    ...over,
  }
}

const emailStep = step({ position: 0, kind: "email", subject: "Hi", body: "Body" })

describe("decideStep — exits and terminal states", () => {
  it("exits immediately when the contact is suppressed", () => {
    expect(decideStep(run, [emailStep], ctx({ isSuppressed: true }))).toEqual({ kind: "exit", reason: "suppressed" })
  })

  it("completes when the position is past the end of the step list", () => {
    expect(decideStep({ ...run, current_position: 5 }, [emailStep], ctx())).toEqual({ kind: "complete" })
  })

  it("completes on a stop step", () => {
    expect(decideStep(run, [step({ position: 0, kind: "stop" })], ctx())).toEqual({ kind: "complete" })
  })
})

describe("decideStep — email and the consent regime", () => {
  it("sends email with no consent record, because email is opt-out", () => {
    const action = decideStep(run, [emailStep], ctx({ hasEmailConsent: false }))
    expect(action).toEqual({ kind: "send", step: emailStep, channel: "email" })
  })

  it("advances past an email step when the contact has no email address", () => {
    const action = decideStep(
      run,
      [emailStep],
      ctx({ contact: { email: null, phone_e164: "+15551234567", user_id: null, name: null } }),
    )
    expect(action).toMatchObject({ kind: "advance", toPosition: 1, note: "no_email_address" })
  })

  it("refuses SMS without explicit consent, because SMS is opt-in", () => {
    const sms = step({ position: 0, kind: "sms", body: "hi" })
    const action = decideStep(
      run,
      [sms],
      ctx({
        contact: { email: null, phone_e164: "+15551234567", user_id: null, name: null },
        hasSmsConsent: false,
      }),
    )
    expect(action).toMatchObject({ kind: "advance", note: "no_sms_consent" })
  })

  // Added beyond the brief: the SMS opt-in positive path has no coverage
  // otherwise, and it is the branch that becomes load-bearing in Stage 2.
  it("sends sms when the contact has explicit SMS consent", () => {
    const sms = step({ position: 0, kind: "sms", body: "hi" })
    const action = decideStep(
      run,
      [sms],
      ctx({
        contact: { email: null, phone_e164: "+15551234567", user_id: null, name: null },
        hasSmsConsent: true,
      }),
    )
    expect(action).toEqual({ kind: "send", step: sms, channel: "sms" })
  })
})

describe("decideStep — wait", () => {
  it("advances past the wait and defers by its minutes", () => {
    const wait = step({ position: 0, kind: "wait", wait_minutes: 2880 })
    const action = decideStep(run, [wait, emailStep], ctx())
    expect(action).toMatchObject({ kind: "advance", toPosition: 1 })
    expect((action as any).deferUntil.toISOString()).toBe("2026-08-20T18:00:00.000Z")
  })
})

describe("decideStep — unsupported kinds are visible, not silent", () => {
  it.each(["tag", "stage"] as const)("advances past a %s step with a note", (kind) => {
    const action = decideStep(run, [step({ position: 0, kind })], ctx())
    expect(action).toMatchObject({ kind: "advance", toPosition: 1, note: "unsupported_kind" })
  })
})

// Added beyond the brief: the brief specifies no test for the `alert` action,
// but the StepAction union and the switch in decideStep must return it for a
// real step kind.
describe("decideStep — alert", () => {
  it("returns an alert action for an alert step", () => {
    const alertStep = step({ position: 0, kind: "alert" })
    const action = decideStep(run, [alertStep], ctx())
    expect(action).toEqual({ kind: "alert", step: alertStep })
  })
})

describe("evaluateBranch", () => {
  it("resolves has_phone from the contact", () => {
    expect(evaluateBranch({ kind: "has_phone" }, ctx())).toEqual({ ok: true, value: false })
    expect(
      evaluateBranch(
        { kind: "has_phone" },
        ctx({ contact: { email: null, phone_e164: "+15551234567", user_id: null, name: null } }),
      ),
    ).toEqual({ ok: true, value: true })
  })

  it("resolves has_user, has_consent and source_is", () => {
    expect(
      evaluateBranch({ kind: "has_user" }, ctx({ contact: { email: "a@b.co", phone_e164: null, user_id: "u1", name: null } })),
    ).toEqual({ ok: true, value: true })
    expect(evaluateBranch({ kind: "has_consent", channel: "sms" }, ctx({ hasSmsConsent: true }))).toEqual({
      ok: true,
      value: true,
    })
    expect(evaluateBranch({ kind: "source_is", value: "funnel_form" }, ctx())).toEqual({ ok: true, value: true })
    expect(evaluateBranch({ kind: "source_is", value: "newsletter" }, ctx())).toEqual({ ok: true, value: false })
  })

  it("REFUSES an unknown predicate instead of defaulting to false", () => {
    const result = evaluateBranch({ kind: "phase_of_moon" } as any, ctx())
    expect(result.ok).toBe(false)
  })
})

describe("decideStep — branch routing", () => {
  const branch = step({
    position: 0,
    kind: "branch",
    branch_condition: { kind: "has_phone" },
    on_true_position: 5,
    on_false_position: 9,
  })

  it("routes to on_false_position when the predicate is false", () => {
    expect(decideStep(run, [branch], ctx())).toMatchObject({ kind: "advance", toPosition: 9 })
  })

  it("routes to on_true_position when the predicate is true", () => {
    const action = decideStep(
      run,
      [branch],
      ctx({ contact: { email: null, phone_e164: "+15551234567", user_id: null, name: null } }),
    )
    expect(action).toMatchObject({ kind: "advance", toPosition: 5 })
  })

  it("falls through to the next position when the target is null", () => {
    const open = step({
      position: 0,
      kind: "branch",
      branch_condition: { kind: "has_phone" },
      on_true_position: null,
      on_false_position: null,
    })
    expect(decideStep(run, [open], ctx())).toMatchObject({ kind: "advance", toPosition: 1 })
  })

  it("FAILS the run on an unknown predicate rather than guessing an arm", () => {
    const bad = step({
      position: 0,
      kind: "branch",
      branch_condition: { kind: "nope" } as any,
      on_true_position: 5,
      on_false_position: 9,
    })
    expect(decideStep(run, [bad], ctx())).toMatchObject({ kind: "fail" })
  })
})

describe("decideStep — guardrails, in order", () => {
  it("defers when an older sibling run is active", () => {
    const action = decideStep(
      run,
      [emailStep],
      ctx({
        activeSiblings: [{ id: "run-0", enrolled_at: "2026-08-01T00:00:00Z" }],
      }),
    )
    expect(action).toMatchObject({ kind: "defer", reason: "sibling_run" })
  })

  it("defers when the daily cap is already met", () => {
    const action = decideStep(run, [emailStep], ctx({ sentAtToday: ["2026-08-18T13:00:00Z"] }))
    expect(action).toMatchObject({ kind: "defer", reason: "daily_cap" })
  })

  it("defers outside quiet hours", () => {
    const action = decideStep(run, [emailStep], ctx({ now: new Date("2026-08-18T09:00:00Z") }))
    expect(action).toMatchObject({ kind: "defer", reason: "quiet_hours" })
  })

  it("checks the sibling run BEFORE the daily cap", () => {
    const action = decideStep(
      run,
      [emailStep],
      ctx({
        activeSiblings: [{ id: "run-0", enrolled_at: "2026-08-01T00:00:00Z" }],
        sentAtToday: ["2026-08-18T13:00:00Z"],
      }),
    )
    expect(action).toMatchObject({ kind: "defer", reason: "sibling_run" })
  })

  it("does NOT apply send guardrails to a wait step", () => {
    const wait = step({ position: 0, kind: "wait", wait_minutes: 60 })
    const action = decideStep(run, [wait, emailStep], ctx({ now: new Date("2026-08-18T09:00:00Z") }))
    expect(action).toMatchObject({ kind: "advance" })
  })
})
