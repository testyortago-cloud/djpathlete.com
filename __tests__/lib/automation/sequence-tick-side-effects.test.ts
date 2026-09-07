// @vitest-environment node
//
// The two sequence steps that change something OTHER than a message: `tag`
// puts a label on the contact, `stage` moves their card on the sales board.
// Both used to be decided into a bare `advance` with a "this kind is not
// supported yet" timeline row; Tasks 2-4 gave them a decision, a schema and a
// DAL, and this suite pins what the runner does with them.
//
// THE ASSERTION THAT MATTERS MOST IS THE LAST ONE. The runner's file header
// states a concurrency contract: exactly ONE write-back to `sequence_runs`
// per run per tick invocation, because advanceRun/deferRun/exitRun/
// completeRun/failRun all clear `claimed_at`/`claimed_by` on write. A second
// write-back mid-batch releases the claim early and reopens the race
// `FOR UPDATE SKIP LOCKED` exists to close. So the count is asserted across
// EVERY branch these two cases can take, including the ones that never reach
// `advanceRun` at all — a test that only covered the happy path would be
// green with a stray `advanceRun` after `failRun`.
//
// Harness copied from sequence-tick-send-faults.test.ts (the same mocks for
// @/lib/supabase, @/lib/db/businesses, @/lib/lead-engine/sms,
// @/lib/lead-engine/unsubscribe-token and @/lib/db/sequences), plus the three
// modules these two cases actually call: @/lib/db/contact-tags,
// @/lib/db/pipeline and @/lib/audit/record.
import { describe, it, expect, vi, beforeEach } from "vitest"

const { timelineInsertSpy } = vi.hoisted(() => ({ timelineInsertSpy: vi.fn() }))

const sendMock = vi.fn()
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => sendMock(...a) }
  },
}))

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        timelineInsertSpy(table, row)
        return Promise.resolve({ error: null })
      },
    }),
  })),
}))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn(), listBusinesses: vi.fn() }))
// Neither send path is exercised here, but the runner imports both
// unconditionally, so they still need a mock shape — same split the other
// tick suites use for whichever channel they are not testing.
vi.mock("@/lib/lead-engine/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lead-engine/sms")>()),
  sendRenderedSequenceSms: vi.fn(),
}))
vi.mock("@/lib/lead-engine/unsubscribe-token", () => ({
  unsubscribeUrl: vi.fn(() => "https://example.test/unsubscribe/tok"),
  unsubscribeOneClickUrl: vi.fn(() => "https://example.test/api/unsubscribe/tok"),
}))
vi.mock("@/lib/db/sequences", async (importOriginal) => ({
  // Keep the real constants (TRANSIENT_ERROR_DEFER_REASON) — same rationale
  // as the sibling tick suites.
  ...(await importOriginal<typeof import("@/lib/db/sequences")>()),
  claimDueRuns: vi.fn(),
  loadSteps: vi.fn(),
  loadRunContext: vi.fn(),
  recordSend: vi.fn(),
  markSent: vi.fn(),
  markFailed: vi.fn(),
  advanceRun: vi.fn(),
  deferRun: vi.fn(),
  exitRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
}))
vi.mock("@/lib/db/contact-tags", () => ({ addTag: vi.fn() }))
// importOriginal, NOT a hand-written stub, specifically so
// `PipelineNotConfiguredError` stays the REAL class. The runner classifies
// that fault with `instanceof`, so an invented look-alike would make the
// config-fault test pass against a class the production code never sees.
vi.mock("@/lib/db/pipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/pipeline")>()),
  moveOpportunityBySequence: vi.fn(),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
// Only so `vi.importActual("@/lib/audit/record")` in the last test below can
// exercise the real recorder with a failing write — importActual unmocks the
// requested module, not its dependencies.
vi.mock("@/lib/db/audit-logs", () => ({ insertAuditLog: vi.fn() }))
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))

import { getBusinessSettings, listBusinesses } from "@/lib/db/businesses"
import { sendRenderedSequenceSms } from "@/lib/lead-engine/sms"
import {
  claimDueRuns,
  loadSteps,
  loadRunContext,
  recordSend,
  markSent,
  markFailed,
  advanceRun,
  deferRun,
  exitRun,
  completeRun,
  failRun,
} from "@/lib/db/sequences"
import { addTag } from "@/lib/db/contact-tags"
import { moveOpportunityBySequence, PipelineNotConfiguredError } from "@/lib/db/pipeline"
import { recordAudit } from "@/lib/audit/record"
import { insertAuditLog } from "@/lib/db/audit-logs"
import { runSequenceTick } from "@/lib/automation/sequence-tick-runner"
import type { SequenceRunRow, SequenceStepRow, DecisionContext } from "@/lib/automation/sequence-tick"
import type { BusinessSettings } from "@/lib/db/businesses"

type Mock = ReturnType<typeof vi.fn>

const SETTINGS: BusinessSettings = {
  business_id: "biz-1",
  display_name: "Test Business",
  sender_name: "Test Sender",
  sender_email: "sender@example.com",
  reply_to: "reply@example.com",
  logo_url: null,
  timezone: "UTC",
  quiet_hours_start: 0,
  quiet_hours_end: 24,
  daily_message_cap: 5,
  postal_address: "123 Main St",
  sms_help_text: "Reply STOP to opt out.",
  sms_messaging_service_sid: "",
  sms_sender_phone: "",
}

function makeRun(id: string, overrides: Partial<SequenceRunRow> = {}): SequenceRunRow {
  return {
    id,
    sequence_id: "seq-1",
    contact_id: `contact-${id}`,
    current_position: 0,
    enrolled_at: "2026-08-18T00:00:00Z",
    attempts: 1,
    ...overrides,
  }
}

const TAG_STEP: SequenceStepRow = {
  id: "step-tag-1",
  position: 0,
  kind: "tag",
  wait_minutes: null,
  subject: null,
  body: null,
  branch_condition: null,
  on_true_position: null,
  on_false_position: null,
  config: { tag: "warm-lead" },
}

const STAGE_STEP: SequenceStepRow = {
  id: "step-stage-1",
  position: 0,
  kind: "stage",
  wait_minutes: null,
  subject: null,
  body: null,
  branch_condition: null,
  on_true_position: null,
  on_false_position: null,
  config: { stage: "consulted" },
}

// Quiet hours span the full day and dailyCap is generous, so nothing here
// depends on wall-clock time. `tag` and `stage` bypass the send guardrails
// anyway (decideStep only applies them to email/sms), but keeping the context
// sendable means a guardrail regression shows up as a real failure in these
// tests rather than a mysteriously deferred run.
function sendableContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    now: new Date("2026-08-18T18:00:00Z"),
    timezone: "UTC",
    quiet: { startHour: 0, endHour: 24 },
    dailyCap: 5,
    sentAtToday: [],
    activeSiblings: [],
    contact: { email: "lead@example.com", phone_e164: null, user_id: null, name: null },
    hasEmailConsent: false,
    hasSmsConsent: false,
    isSuppressed: false,
    enrolledSource: "funnel_form",
    ...overrides,
  }
}

/** The `contact_timeline_events` rows this tick wrote, in order. */
function timelineRows(): Array<Record<string, unknown>> {
  return timelineInsertSpy.mock.calls
    .filter(([table]) => table === "contact_timeline_events")
    .map(([, row]) => row as Record<string, unknown>)
}

/**
 * Every `sequence_runs` write-back this tick performed, across all five
 * functions. The runner's concurrency contract is a claim about the TOTAL,
 * not about any one of them, so it has to be counted as a total.
 */
function writeBackCount(): number {
  return (
    (advanceRun as Mock).mock.calls.length +
    (deferRun as Mock).mock.calls.length +
    (exitRun as Mock).mock.calls.length +
    (completeRun as Mock).mock.calls.length +
    (failRun as Mock).mock.calls.length
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  timelineInsertSpy.mockClear()
  process.env.NEXTAUTH_URL = "https://app.example.test"
  process.env.RESEND_API_KEY = "re_test"
  sendMock.mockResolvedValue({ data: { id: "resend-default" }, error: null })
  ;(getBusinessSettings as Mock).mockResolvedValue(SETTINGS)
  ;(listBusinesses as Mock).mockResolvedValue([{ id: "biz-1" }])
  ;(claimDueRuns as Mock).mockResolvedValue([])
  ;(loadSteps as Mock).mockResolvedValue([TAG_STEP])
  ;(loadRunContext as Mock).mockResolvedValue(sendableContext())
  ;(recordSend as Mock).mockResolvedValue({ claimed: true, messageId: "msg-1" })
  ;(sendRenderedSequenceSms as Mock).mockResolvedValue({ providerMessageId: "SM-default" })
  ;(markSent as Mock).mockResolvedValue(undefined)
  ;(markFailed as Mock).mockResolvedValue(undefined)
  ;(advanceRun as Mock).mockResolvedValue(undefined)
  ;(deferRun as Mock).mockResolvedValue(undefined)
  ;(exitRun as Mock).mockResolvedValue(undefined)
  ;(completeRun as Mock).mockResolvedValue(undefined)
  ;(failRun as Mock).mockResolvedValue(undefined)
  ;(addTag as Mock).mockResolvedValue({ tag: "warm-lead", created: true })
  ;(moveOpportunityBySequence as Mock).mockResolvedValue({
    kind: "moved",
    opportunityId: "opp-1",
    fromStageKey: "new",
    toStageKey: "consulted",
  })
  ;(recordAudit as Mock).mockResolvedValue(undefined)
  ;(insertAuditLog as Mock).mockResolvedValue(undefined)
})

describe("a tag step", () => {
  it("applies the tag and advances", async () => {
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1")])

    await runSequenceTick()

    expect(addTag).toHaveBeenCalledTimes(1)
    expect(addTag).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: "contact-run-1", tag: "warm-lead", businessId: "biz-1" }),
    )
    expect(advanceRun).toHaveBeenCalledTimes(1)
    // Position 0 + 1 — the step after this one, not a re-run of this one.
    expect(advanceRun).toHaveBeenCalledWith("run-1", 1)
  })

  it("writes a sequence_tag_applied timeline row", async () => {
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1")])

    await runSequenceTick()

    const rows = timelineRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      business_id: "biz-1",
      contact_id: "contact-run-1",
      kind: "sequence_tag_applied",
      source: "sequence_engine",
    })
    // `created` distinguishes "this tag is new" from "they already had it",
    // which is the whole reason addTag bothers to return it.
    expect(rows[0].metadata).toMatchObject({
      run_id: "run-1",
      sequence_id: "seq-1",
      step_id: "step-tag-1",
      tag: "warm-lead",
      created: true,
    })
  })

  it("records a sequence.contact_tagged audit row against the contact", async () => {
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1")])

    await runSequenceTick()

    expect(recordAudit).toHaveBeenCalledTimes(1)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sequence.contact_tagged",
        // automation, never admin_write: the admin trail answers "did a coach
        // do this?" and a cron filed there gives that question a wrong answer.
        category: "automation",
        actor: { id: null, email: null, role: "system" },
        target: { type: "contact", id: "contact-run-1" },
        // `created` travels on the audit row as well as the timeline row, and
        // it is the field the "a retried tick can write a second audit row,
        // but never a second tag" judgement rests on. Pinned in both places,
        // and in both directions — see the sibling test below.
        metadata: expect.objectContaining({ tag: "warm-lead", created: true, sequence_run_id: "run-1" }),
      }),
    )
  })

  it("records created: false on the audit row when the tag was already there", async () => {
    // The other direction, as its own test. One assertion pinning only
    // `created: true` stays green against a hardcoded `true`.
    ;(addTag as Mock).mockResolvedValue({ tag: "warm-lead", created: false })
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1")])

    await runSequenceTick()

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sequence.contact_tagged",
        metadata: expect.objectContaining({ tag: "warm-lead", created: false }),
      }),
    )
  })

  it("advances even when the tag was already there", async () => {
    // addTag is idempotent — a 23505 comes back as `created: false`, not as a
    // throw — so a retried tick must not stall on a tag it already applied.
    ;(addTag as Mock).mockResolvedValue({ tag: "warm-lead", created: false })
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1")])

    const summary = await runSequenceTick()

    expect(advanceRun).toHaveBeenCalledTimes(1)
    expect(failRun).not.toHaveBeenCalled()
    expect(summary.failed).toBe(0)
    expect(timelineRows()[0].metadata).toMatchObject({ created: false })
  })

  it("does not advance when addTag throws", async () => {
    // The side effect comes FIRST and the write-back last, so a failed tag
    // leaves the run exactly where it was for the next tick to retry. If the
    // order were reversed the run would march past a tag it never applied.
    ;(addTag as Mock).mockRejectedValue(new Error("addTag: connection reset"))
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1")])

    const summary = await runSequenceTick()

    expect(advanceRun).not.toHaveBeenCalled()
    expect(deferRun).toHaveBeenCalledTimes(1)
    expect(summary.deferred).toBe(1)
    expect(timelineRows()).toHaveLength(0)
  })
})

describe("a stage step", () => {
  beforeEach(() => {
    ;(loadSteps as Mock).mockResolvedValue([STAGE_STEP])
  })

  it("moves the card and advances", async () => {
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1")])

    await runSequenceTick()

    expect(moveOpportunityBySequence).toHaveBeenCalledTimes(1)
    expect(moveOpportunityBySequence).toHaveBeenCalledWith({
      contactId: "contact-run-1",
      stageKey: "consulted",
      // Absent in the step config, so null — the DAL turns that into the
      // default board's key. Absent and empty are different answers.
      pipelineKey: null,
      businessId: "biz-1",
      sequenceRunId: "run-1",
    })
    expect(advanceRun).toHaveBeenCalledTimes(1)
    expect(advanceRun).toHaveBeenCalledWith("run-1", 1)
  })

  it("writes a sequence_stage_moved timeline row", async () => {
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1")])

    await runSequenceTick()

    const rows = timelineRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      business_id: "biz-1",
      contact_id: "contact-run-1",
      kind: "sequence_stage_moved",
    })
    expect(rows[0].metadata).toMatchObject({
      run_id: "run-1",
      sequence_id: "seq-1",
      step_id: "step-stage-1",
      from_stage: "new",
      to_stage: "consulted",
    })
  })

  it("advances and records the reason on a skip", async () => {
    // A skip is not a failure: the contact simply has no open card to move.
    // The reason is recorded because "nothing happened" with no explanation is
    // indistinguishable from a broken step.
    ;(moveOpportunityBySequence as Mock).mockResolvedValue({ kind: "skipped", reason: "no_opportunity" })
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1")])

    const summary = await runSequenceTick()

    const rows = timelineRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe("sequence_stage_skipped")
    expect(rows[0].metadata).toMatchObject({ run_id: "run-1", step_id: "step-stage-1", reason: "no_opportunity" })
    expect(advanceRun).toHaveBeenCalledTimes(1)
    expect(failRun).not.toHaveBeenCalled()
    expect(summary.failed).toBe(0)
  })

  it("fails the run on an invalid stage step", async () => {
    // Deterministic: the sequence's own definition names a stage that cannot
    // be moved to, and every retry fails identically. Failing now records the
    // reason on the run instead of burning five attempts and then recording
    // `transient_error`. (There is no `/admin/sequences` screen on this
    // branch — the reason is read on the contact detail page, which renders
    // `run.last_error` beside the run.)
    ;(moveOpportunityBySequence as Mock).mockResolvedValue({
      kind: "invalid",
      error:
        'This sequence\'s stage step points at the "won" stage, which closes a sale. A sequence is not allowed to close one.',
    })
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1")])

    const summary = await runSequenceTick()

    expect(failRun).toHaveBeenCalledTimes(1)
    // The DAL's reason reaches `failRun` verbatim — the runner must not
    // paraphrase it, because that string is what a coach reads on the contact
    // detail page.
    expect(failRun).toHaveBeenCalledWith(
      "run-1",
      'This sequence\'s stage step points at the "won" stage, which closes a sale. A sequence is not allowed to close one.',
    )
    expect(advanceRun).not.toHaveBeenCalled()
    expect(deferRun).not.toHaveBeenCalled()
    expect(summary.failed).toBe(1)
    // No timeline row: the fault is the sequence author's, not part of this
    // contact's history.
    expect(timelineRows()).toHaveLength(0)
  })

  it("defers and counts a config fault when the pipeline is not configured", async () => {
    // The opposite treatment to `invalid`, and the distinction is the whole
    // point of the throw-vs-return split in the DAL. Somebody can seed the
    // pipeline and the next tick works, so the run is deferred instead of
    // failed on the spot.
    //
    // It DOES still count against MAX_ATTEMPTS — `retryable` in the batch
    // catch is fault-type-blind, and the test at the bottom of this block
    // proves the fifth one destroys the run. What the classification buys is
    // the 20-minute defer floor (asserted in the next test) and the
    // `config_faults` alarm firing while attempts remain, which is the window
    // a human has to fix the setting. The same false claim — that a config
    // fault is exempt from MAX_ATTEMPTS — was already corrected in the
    // runner's own comment; this copy was missed.
    ;(moveOpportunityBySequence as Mock).mockRejectedValue(new PipelineNotConfiguredError("coaching"))
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1")])

    const summary = await runSequenceTick()

    expect(deferRun).toHaveBeenCalledTimes(1)
    expect(failRun).not.toHaveBeenCalled()
    expect(summary.config_faults).toBe(1)
    expect(summary.deferred).toBe(1)
    expect(summary.failed).toBe(0)
  })

  it("defers past the reclaim window on a config fault, like a send config fault does", async () => {
    // A control for the assertion above: `config_faults` counting is only
    // half of the treatment. The other half is the longer defer, and the two
    // are set by the same branch.
    ;(moveOpportunityBySequence as Mock).mockRejectedValue(new PipelineNotConfiguredError("coaching"))
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1", { attempts: 1 })])

    const before = Date.now()
    await runSequenceTick()

    const until = (deferRun as Mock).mock.calls[0][1] as Date
    expect(until.getTime() - before).toBeGreaterThan(15 * 60 * 1000)
  })

  it("still fails the run terminally once attempts are exhausted", async () => {
    // THE BOUNDED HALF, and it is here because the code comment in the batch
    // catch now claims it out loud. A configuration fault does NOT exempt a
    // run from MAX_ATTEMPTS: `retryable` is fault-type-blind, and `deferRun`
    // does not reset `attempts` for a transient-error defer. What the config
    // branch buys is the 20-minute floor and the `config_faults` alarm, not
    // immortality — so the fifth one still destroys the run. Asserted rather
    // than described, because the previous wording of that comment claimed the
    // opposite and nothing caught it.
    ;(moveOpportunityBySequence as Mock).mockRejectedValue(new PipelineNotConfiguredError("coaching"))
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1", { attempts: 5 })])

    const summary = await runSequenceTick()

    expect(deferRun).not.toHaveBeenCalled()
    expect(failRun).toHaveBeenCalledTimes(1)
    expect(summary.failed).toBe(1)
    expect(summary.config_faults ?? 0).toBe(0)
  })

  // RESIDUAL 3. This is the route by which a THROWN error's `.message` becomes
  // coach-facing text: the terminal arm of the batch catch calls
  // `failRun(run.id, message)`, and the contact detail page renders
  // `run.last_error` raw. The string predates this branch, but nothing routed
  // it to a coach until a sequence could move a card.
  //
  // Driven through the real class, not a fixture, so the assertion pins what
  // production would actually write.
  it("writes the pipeline error to the run in words a coach can act on", async () => {
    ;(moveOpportunityBySequence as Mock).mockRejectedValue(new PipelineNotConfiguredError("coaching"))
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1", { attempts: 5 })])

    await runSequenceTick()

    // Presence control: this is the terminal arm, not the defer arm.
    expect(failRun).toHaveBeenCalledTimes(1)
    const written = (failRun as Mock).mock.calls[0][1] as string
    expect(written).toBe('No pipeline is set up for this business under the name "coaching".')
    // Same bar as every other operator-facing string on this branch.
    expect(written).not.toContain("`")
    expect(written.toLowerCase()).not.toContain("board")
    expect(written.toLowerCase()).not.toContain("config")
  })
})

describe("the one-write-back concurrency contract", () => {
  // Every branch `tag` and `stage` can take, including the two that never
  // reach advanceRun. Covering only the happy path would stay green with a
  // stray advanceRun after failRun on the `invalid` branch, which is exactly
  // the mistake the contract exists to prevent.
  const BRANCHES: Array<{ name: string; arrange: () => void }> = [
    {
      name: "tag, applied",
      arrange: () => {
        ;(loadSteps as Mock).mockResolvedValue([TAG_STEP])
      },
    },
    {
      name: "tag, already there",
      arrange: () => {
        ;(loadSteps as Mock).mockResolvedValue([TAG_STEP])
        ;(addTag as Mock).mockResolvedValue({ tag: "warm-lead", created: false })
      },
    },
    {
      name: "tag, addTag threw",
      arrange: () => {
        ;(loadSteps as Mock).mockResolvedValue([TAG_STEP])
        ;(addTag as Mock).mockRejectedValue(new Error("addTag: connection reset"))
      },
    },
    {
      name: "stage, moved",
      arrange: () => {
        ;(loadSteps as Mock).mockResolvedValue([STAGE_STEP])
      },
    },
    {
      name: "stage, skipped",
      arrange: () => {
        ;(loadSteps as Mock).mockResolvedValue([STAGE_STEP])
        ;(moveOpportunityBySequence as Mock).mockResolvedValue({ kind: "skipped", reason: "already_on_stage" })
      },
    },
    {
      name: "stage, invalid",
      arrange: () => {
        ;(loadSteps as Mock).mockResolvedValue([STAGE_STEP])
        ;(moveOpportunityBySequence as Mock).mockResolvedValue({ kind: "invalid", error: "no such stage" })
      },
    },
    {
      name: "stage, pipeline not configured",
      arrange: () => {
        ;(loadSteps as Mock).mockResolvedValue([STAGE_STEP])
        ;(moveOpportunityBySequence as Mock).mockRejectedValue(new PipelineNotConfiguredError("coaching"))
      },
    },
  ]

  it.each(BRANCHES)("makes exactly one sequence_runs write-back per run: $name", async ({ arrange }) => {
    arrange()
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1")])

    await runSequenceTick()

    expect(writeBackCount()).toBe(1)
  })

  it("still makes exactly one write-back per run across a multi-run batch", async () => {
    // Two runs, two write-backs — not four. The per-run count is what the
    // contract is about, and a batch is where a stray extra write actually
    // releases somebody else's claim.
    ;(loadSteps as Mock).mockResolvedValue([STAGE_STEP])
    ;(claimDueRuns as Mock).mockResolvedValue([makeRun("run-1"), makeRun("run-2")])

    await runSequenceTick()

    expect(writeBackCount()).toBe(2)
  })
})

describe("the audit write cannot break a run", () => {
  it("is a property of recordAudit itself, not of a try/catch in the runner", async () => {
    // The runner calls recordAudit with no try/catch, exactly as
    // lib/db/pipeline.ts does. That is only safe because recordAudit swallows
    // its own failures. Pinned here rather than assumed: if that ever changes,
    // a broken audit table starts deferring live runs, and the tag step is one
    // of the callers that would find out the hard way.
    const actual = await vi.importActual<typeof import("@/lib/audit/record")>("@/lib/audit/record")
    ;(insertAuditLog as Mock).mockRejectedValue(new Error("audit_logs unreachable"))

    await expect(
      actual.recordAudit({
        action: "sequence.contact_tagged",
        category: "automation",
        actor: { id: null, email: null, role: "system" },
        target: { type: "contact", id: "contact-run-1" },
        metadata: { tag: "warm-lead", sequence_run_id: "run-1" },
      }),
    ).resolves.toBeUndefined()
  })
})
