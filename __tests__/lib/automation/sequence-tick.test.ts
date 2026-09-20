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
    lastEmail: null,
    enrolmentMetadata: {},
    // G11. Not anchored — the normal case for every sequence here.
    anchorAt: null,
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

// Retargeted, not deleted. These two kinds used to advance with
// note: "unsupported_kind"; they now do their job. Keeping the cases pointed
// at the replacement is what stops the old no-op quietly coming back.
describe("decideStep — tag", () => {
  it("returns a tag action carrying the normalised tag", () => {
    const tagStep = step({ position: 0, kind: "tag", config: { tag: "Warm Lead" } })
    expect(decideStep(run, [tagStep], ctx())).toEqual({ kind: "tag", step: tagStep, tag: "warm lead" })
  })

  it("fails the run when the config has no tag, carrying the parser's own sentence", () => {
    // Pinned to the sentence rather than to `toContain("tag")`: that substring
    // is satisfied by the step KIND alone, so it stayed green whatever the
    // message said. This reason is written to `sequence_runs.last_error` and
    // rendered raw to a coach, so which string arrives is the point.
    const action = decideStep(run, [step({ position: 0, kind: "tag", config: {} })], ctx())
    expect(action.kind).toBe("fail")
    expect((action as { error: string }).error).toBe("This sequence's tag step does not say which tag to add.")
  })

  it("never advances past a tag step", () => {
    const action = decideStep(run, [step({ position: 0, kind: "tag", config: {} })], ctx())
    expect(action.kind).not.toBe("advance")
  })
})

describe("decideStep — stage", () => {
  it("returns a stage action with a null pipeline when config names only a stage", () => {
    const stageStep = step({ position: 0, kind: "stage", config: { stage: "consulted" } })
    expect(decideStep(run, [stageStep], ctx())).toEqual({
      kind: "stage",
      step: stageStep,
      stageKey: "consulted",
      pipelineKey: null,
    })
  })

  it("carries an explicit pipeline key through", () => {
    const stageStep = step({ position: 0, kind: "stage", config: { stage: "consulted", pipeline: "coaching" } })
    expect(decideStep(run, [stageStep], ctx())).toMatchObject({ kind: "stage", pipelineKey: "coaching" })
  })

  it("fails the run when the config has no stage, carrying the parser's own sentence", () => {
    // Same reasoning as the tag case above.
    const action = decideStep(run, [step({ position: 0, kind: "stage", config: {} })], ctx())
    expect(action.kind).toBe("fail")
    expect((action as { error: string }).error).toBe(
      "This sequence's stage step does not say which stage to move the person to.",
    )
  })
})

// The suppression check runs before the step kind is even looked at, so a
// malformed tag step must not be able to keep a suppressed contact in a
// sequence. Cheap to assert, and the ordering is easy to break.
describe("decideStep — suppression still wins over a tag step", () => {
  it("exits rather than failing on a malformed tag step", () => {
    const action = decideStep(run, [step({ position: 0, kind: "tag", config: {} })], ctx({ isSuppressed: true }))
    expect(action).toEqual({ kind: "exit", reason: "suppressed" })
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
      evaluateBranch(
        { kind: "has_user" },
        ctx({ contact: { email: "a@b.co", phone_e164: null, user_id: "u1", name: null } }),
      ),
    ).toEqual({ ok: true, value: true })
    expect(evaluateBranch({ kind: "has_consent", channel: "sms" }, ctx({ hasSmsConsent: true }))).toEqual({
      ok: true,
      value: true,
    })
    expect(evaluateBranch({ kind: "source_is", value: "funnel_form" }, ctx())).toEqual({ ok: true, value: true })
    expect(evaluateBranch({ kind: "source_is", value: "newsletter" }, ctx())).toEqual({ ok: true, value: false })
  })

  // G09. The quotation sells "branch on whether they opened the last email".
  // Until now `sequence_messages.opened_at` had no writer, so the predicate
  // could not exist — the column it reads was always null.
  //
  // BOTH predicates ship, and they are NOT equally trustworthy. An open is a
  // 1x1 tracking pixel: Apple Mail Privacy Protection pre-fetches it on every
  // message whether or not a human ever looks, and Gmail proxies images too.
  // So `opened_last_email` OVER-COUNTS, on the largest slice of a consumer
  // list, and always will. A click is a real action on a real link.
  it("resolves opened_last_email from the last email's opened_at", () => {
    expect(
      evaluateBranch(
        { kind: "opened_last_email" },
        ctx({ lastEmail: { openedAt: "2026-08-18T14:00:00Z", clickedAt: null } }),
      ),
    ).toEqual({ ok: true, value: true })

    expect(
      evaluateBranch({ kind: "opened_last_email" }, ctx({ lastEmail: { openedAt: null, clickedAt: null } })),
    ).toEqual({ ok: true, value: false })
  })

  it("resolves clicked_last_email independently of opened", () => {
    // A click without a recorded open is normal: an image-blocking client
    // never fires the pixel, and Resend does not synthesise an open.
    expect(
      evaluateBranch(
        { kind: "clicked_last_email" },
        ctx({ lastEmail: { openedAt: null, clickedAt: "2026-08-18T14:05:00Z" } }),
      ),
    ).toEqual({ ok: true, value: true })

    expect(
      evaluateBranch(
        { kind: "clicked_last_email" },
        ctx({ lastEmail: { openedAt: "2026-08-18T14:00:00Z", clickedAt: null } }),
      ),
    ).toEqual({ ok: true, value: false })
  })

  it("is FALSE, not an error, when this run has sent no email yet", () => {
    // A branch placed before any email step. False is the honest answer —
    // they have not opened something that was never sent — and failing the run
    // would punish an editor for an ordering choice that is merely odd.
    expect(evaluateBranch({ kind: "opened_last_email" }, ctx({ lastEmail: null }))).toEqual({
      ok: true,
      value: false,
    })
    expect(evaluateBranch({ kind: "clicked_last_email" }, ctx({ lastEmail: null }))).toEqual({
      ok: true,
      value: false,
    })
  })

  it("REFUSES an unknown predicate instead of defaulting to false", () => {
    const result = evaluateBranch({ kind: "phase_of_moon" } as any, ctx())
    expect(result.ok).toBe(false)
  })

  // G10. `source_is` reads the SEQUENCE's trigger, which is the same value
  // for everyone in that sequence — so until now nothing could tell a camp
  // enquiry from a coaching one, or a parent filling a form in from an adult
  // filling it in for themselves. Both are quoted behaviours.
  describe("enrolled_metadata_is", () => {
    const camp = ctx({ enrolmentMetadata: { service: "camp", role: "parent" } })

    it("is true when the run remembers that key with that value", () => {
      expect(evaluateBranch({ kind: "enrolled_metadata_is", key: "service", value: "camp" }, camp)).toEqual({
        ok: true,
        value: true,
      })
    })

    it("is false when the run remembers that key with a DIFFERENT value", () => {
      expect(evaluateBranch({ kind: "enrolled_metadata_is", key: "service", value: "in_person" }, camp)).toEqual({
        ok: true,
        value: false,
      })
    })

    it("is false — not an error — when the run remembers nothing under that key", () => {
      // A run enrolled before this shipped, or by a front door that has no
      // such fact to offer. Failing would turn every pre-00266 run into a
      // dead run the moment a coach added this branch.
      expect(evaluateBranch({ kind: "enrolled_metadata_is", key: "event_kind", value: "camp" }, camp)).toEqual({
        ok: true,
        value: false,
      })
      expect(
        evaluateBranch({ kind: "enrolled_metadata_is", key: "service", value: "camp" }, ctx({ enrolmentMetadata: {} })),
      ).toEqual({ ok: true, value: false })
    })

    it("ignores case and surrounding spaces on both sides", () => {
      // The stored side is machine-written (`camp`, `parent`, `in_person`);
      // the compared side is TYPED BY A COACH into a text box. Two values
      // differing only in case are never two different answers here, and a
      // silently-never-matching branch is the worst way to find that out.
      expect(evaluateBranch({ kind: "enrolled_metadata_is", key: "service", value: " Camp " }, camp)).toEqual({
        ok: true,
        value: true,
      })
      expect(
        evaluateBranch(
          { kind: "enrolled_metadata_is", key: "camp_name", value: "summer camp" },
          ctx({ enrolmentMetadata: { camp_name: "Summer Camp" } }),
        ),
      ).toEqual({ ok: true, value: true })
    })

    it("a blank answer is false, whether or not the run carries that key", () => {
      // A coach who picks the rule and leaves the box empty must not send
      // everyone down the "yes" side. Nothing in `evaluateBranch` special-
      // cases this — it falls out of the comparison, because
      // `pickEnrolmentMetadata` never stores a blank value — so both halves
      // are asserted: the key the run HAS and the key it does not.
      expect(evaluateBranch({ kind: "enrolled_metadata_is", key: "service", value: "" }, camp)).toEqual({
        ok: true,
        value: false,
      })
      expect(evaluateBranch({ kind: "enrolled_metadata_is", key: "tier", value: "   " }, camp)).toEqual({
        ok: true,
        value: false,
      })
    })
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
