// @vitest-environment node
//
// Unit tests for the sms branch of `processRun`'s case "send"
// (lib/automation/sequence-tick-runner.ts). Modeled on the mock harness in
// __tests__/api/admin/internal/sequence-tick.test.ts, but calls
// `runSequenceTick` directly rather than going through the route — this
// suite has nothing to do with the bearer/cron-flag/logging shell, only with
// the executor itself. Only the IO edges are mocked: the sequences DAL,
// business settings, the sms network call, and the timeline-event insert.
// `decideStep` (lib/automation/sequence-tick.ts, pure) stays real for every
// case except (d) below, whose whole point is a branch decideStep itself
// never reaches.

import { describe, it, expect, vi, beforeEach } from "vitest"

const { timelineInsertSpy } = vi.hoisted(() => ({ timelineInsertSpy: vi.fn() }))

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
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
// The email path is untouched by this suite, but the runner imports it
// unconditionally, so it needs a mock shape too. `assertSendable` stays real
// (the tick-wide preflight this suite's fixtures must satisfy); only the
// network-shaped calls are mocked, same split as the route-level suite.
vi.mock("@/lib/lead-engine/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lead-engine/email")>()),
  sendSequenceEmail: vi.fn(),
  sendRenderedSequenceEmail: vi.fn(),
}))
vi.mock("@/lib/lead-engine/unsubscribe-token", () => ({
  unsubscribeUrl: vi.fn(() => "https://example.test/unsubscribe/tok"),
  unsubscribeOneClickUrl: vi.fn(() => "https://example.test/api/unsubscribe/tok"),
}))
// `smsConfigured` and `renderSequenceSms` are pure — kept real so this suite
// proves the runner reads the actual configuration boolean off `settings`
// and the actual rendered bytes, not a mock's opinion of either. Only the
// network call is mocked.
vi.mock("@/lib/lead-engine/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lead-engine/sms")>()),
  sendRenderedSequenceSms: vi.fn(),
}))
vi.mock("@/lib/db/sequences", async (importOriginal) => ({
  // Keep the real constants (TRANSIENT_ERROR_DEFER_REASON) — see the
  // route-level suite's identical comment for why.
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
// `decideStep` is pure and real for every test except (d). Wrapping it in
// `vi.fn(actual)` rather than replacing it means every other test gets the
// real decision core for free — decideStep itself never emits a "send"/"sms"
// action for a phoneless contact (it advances first, per its own guard), so
// exercising the runner's own defensive guard requires overriding its return
// value for exactly one call.
vi.mock("@/lib/automation/sequence-tick", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/automation/sequence-tick")>()
  return { ...actual, decideStep: vi.fn(actual.decideStep) }
})

import { getBusinessSettings } from "@/lib/db/businesses"
import { sendSequenceEmail, sendRenderedSequenceEmail } from "@/lib/lead-engine/email"
import { sendRenderedSequenceSms, SMS_OPT_OUT_SENTENCE } from "@/lib/lead-engine/sms"
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
  failRun,
} from "@/lib/db/sequences"
import { decideStep } from "@/lib/automation/sequence-tick"
import { runSequenceTick } from "@/lib/automation/sequence-tick-runner"
import type { SequenceRunRow, SequenceStepRow, DecisionContext } from "@/lib/automation/sequence-tick"
import type { BusinessSettings } from "@/lib/db/businesses"

const CONFIGURED_SETTINGS: BusinessSettings = {
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
  sms_messaging_service_sid: "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  sms_sender_phone: "",
}

const UNCONFIGURED_SETTINGS: BusinessSettings = {
  ...CONFIGURED_SETTINGS,
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

const SMS_STEP: SequenceStepRow = {
  id: "step-sms-1",
  position: 0,
  kind: "sms",
  wait_minutes: null,
  subject: null,
  body: "Hi {{name}}, quick reminder about your session.",
  branch_condition: null,
  on_true_position: null,
  on_false_position: null,
  config: {},
}

// Quiet hours span the full day and dailyCap is generous, so the guardrails
// never fire regardless of wall-clock time — same rationale as the
// route-level suite's `sendableContext`.
function smsSendableContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    now: new Date("2026-08-18T18:00:00Z"),
    timezone: "UTC",
    quiet: { startHour: 0, endHour: 24 },
    dailyCap: 5,
    sentAtToday: [],
    activeSiblings: [],
    contact: { email: null, phone_e164: "+15551234567", user_id: null, name: null },
    hasEmailConsent: false,
    hasSmsConsent: true,
    isSuppressed: false,
    enrolledSource: "funnel_form",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  timelineInsertSpy.mockClear()
  // appOrigin() throws when no public origin is configured — pinned here
  // rather than inherited from .env.local, same as the route-level suite.
  process.env.NEXTAUTH_URL = "https://app.example.test"
  ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue(CONFIGURED_SETTINGS)
  ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(loadSteps as ReturnType<typeof vi.fn>).mockResolvedValue([SMS_STEP])
  ;(loadRunContext as ReturnType<typeof vi.fn>).mockResolvedValue(smsSendableContext())
  ;(recordSend as ReturnType<typeof vi.fn>).mockResolvedValue({ claimed: true, messageId: "msg-1" })
  ;(sendSequenceEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ providerMessageId: "resend-1" })
  ;(sendRenderedSequenceEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ providerMessageId: "resend-1" })
  ;(sendRenderedSequenceSms as ReturnType<typeof vi.fn>).mockResolvedValue({ providerMessageId: "SM-default" })
  ;(markSent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(markFailed as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(advanceRun as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(deferRun as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(exitRun as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(failRun as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
})

describe("the sms executor (lib/automation/sequence-tick-runner.ts)", () => {
  // (a) consented contact + configured business -> provider called with
  // rendered text ending in the opt-out sentence, message row sent with
  // provider twilio.
  it("a consented contact on a configured business sends via Twilio, records the message, and advances", async () => {
    const run = makeRun("r-sms-send")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadRunContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      smsSendableContext({ contact: { email: null, phone_e164: "+15551234567", user_id: null, name: "Jane" } }),
    )
    ;(recordSend as ReturnType<typeof vi.fn>).mockResolvedValue({ claimed: true, messageId: "msg-sms-a" })
    ;(sendRenderedSequenceSms as ReturnType<typeof vi.fn>).mockResolvedValue({ providerMessageId: "SM123" })

    const summary = await runSequenceTick()

    expect(summary).toMatchObject({ claimed: 1, sent: 1, failed: 0 })
    expect(summary.skipped_sms).toBeUndefined()

    expect(recordSend).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "r-sms-send",
        stepId: "step-sms-1",
        contactId: "contact-r-sms-send",
        channel: "sms",
        toIdentifier: "+15551234567",
        subject: null,
      }),
    )

    const sentArg = (sendRenderedSequenceSms as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(sentArg.to).toBe("+15551234567")
    // Rendered once and handed to the provider verbatim — {{name}} resolved,
    // opt-out sentence appended as the last line.
    expect(sentArg.text).toContain("Hi Jane, quick reminder")
    expect(sentArg.text.endsWith(SMS_OPT_OUT_SENTENCE)).toBe(true)
    expect(sentArg.statusCallbackUrl).toBe("https://app.example.test/api/webhooks/twilio/status")
    expect(sentArg.settings).toBe(CONFIGURED_SETTINGS)

    // The very same rendering that was recorded is what was sent — one
    // render, not two (same invariant the route-level suite pins for email).
    const recordedArg = (recordSend as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(sentArg.text).toBe(recordedArg.bodyRendered)

    expect(markSent).toHaveBeenCalledWith("msg-sms-a", "twilio", "SM123")
    expect(advanceRun).toHaveBeenCalledWith("r-sms-send", 1)
    expect(failRun).not.toHaveBeenCalled()
  })

  // (b) consented + unconfigured -> advance, timeline sequence_step_unsupported
  // with reason sms_not_configured, provider NOT called, no message row.
  it("a consented contact on an UNCONFIGURED business advances with a visible timeline event and never touches the provider", async () => {
    ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue(UNCONFIGURED_SETTINGS)
    const run = makeRun("r-sms-unconf")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])

    const summary = await runSequenceTick()

    expect(summary).toMatchObject({ sent: 0, failed: 0, skipped_sms: 1 })

    expect(timelineInsertSpy).toHaveBeenCalledWith(
      "contact_timeline_events",
      expect.objectContaining({
        contact_id: "contact-r-sms-unconf",
        kind: "sequence_step_unsupported",
        source: "sequence_engine",
        metadata: expect.objectContaining({
          run_id: "r-sms-unconf",
          step_id: "step-sms-1",
          step_kind: "sms",
          reason: "sms_not_configured",
        }),
      }),
    )
    expect(advanceRun).toHaveBeenCalledWith("r-sms-unconf", 1)
    expect(failRun).not.toHaveBeenCalled()

    // Still nothing pretends to have sent anything, and no message row is
    // claimed — recordSend's (run_id, step_id) claim is permanent (spec §4
    // amendment), so writing one here would block the real send later.
    expect(sendRenderedSequenceSms).not.toHaveBeenCalled()
    expect(recordSend).not.toHaveBeenCalled()
  })

  // (c) provider throws -> row failed, run failed; a second tick does not
  // re-send because recordSend's idempotency gate refuses the already-failed
  // row (lib/db/sequences.ts: `!claimed` on anything but a crashed 'queued'
  // attempt).
  it("a provider failure marks the message and run failed, and a second tick never re-sends", async () => {
    const run = makeRun("r-sms-throws")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(recordSend as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ claimed: true, messageId: "msg-sms-c" }) // tick 1
      .mockResolvedValueOnce({ claimed: false, messageId: null }) // tick 2: idempotency gate refuses
    ;(sendRenderedSequenceSms as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Twilio rejected the number"),
    )

    const summary1 = await runSequenceTick()
    expect(summary1).toMatchObject({ sent: 0, failed: 1 })
    expect(markFailed).toHaveBeenCalledWith("msg-sms-c", expect.stringContaining("Twilio rejected"))
    expect(failRun).toHaveBeenCalledWith("r-sms-throws", expect.stringContaining("Twilio rejected"))
    expect(markSent).not.toHaveBeenCalled()

    const summary2 = await runSequenceTick()
    // The provider was called exactly once across both ticks — the second
    // tick never got past the `!claimed` gate.
    expect(sendRenderedSequenceSms).toHaveBeenCalledTimes(1)
    expect(deferRun).toHaveBeenCalledWith("r-sms-throws", expect.any(Date), "send_in_progress")
    expect(summary2.sent).toBe(0)
  })

  // (d) contact with no phone + consent -> run fails loud. decideStep itself
  // guards this (returns "advance" with note "no_phone_number" before a
  // "send" action is ever produced for a phoneless contact), so this is the
  // runner's OWN defensive guard — unreachable through the real decision
  // core, same as the email branch's identical `!to` guard. Forcing it open
  // requires overriding decideStep's return value for this one call.
  it("an sms send action reaching the runner with no phone on file fails the run loud, never calling the provider", async () => {
    const run = makeRun("r-sms-nophone")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadRunContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      smsSendableContext({ contact: { email: null, phone_e164: null, user_id: null, name: null } }),
    )
    ;(decideStep as ReturnType<typeof vi.fn>).mockReturnValueOnce({ kind: "send", channel: "sms", step: SMS_STEP })

    const summary = await runSequenceTick()

    expect(summary).toMatchObject({ sent: 0, failed: 1 })
    expect(failRun).toHaveBeenCalledWith("r-sms-nophone", expect.stringContaining("no phone number"))
    expect(sendRenderedSequenceSms).not.toHaveBeenCalled()
    expect(recordSend).not.toHaveBeenCalled()
    expect(advanceRun).not.toHaveBeenCalled()
  })

  // (e) suppressed phone -> decideStep exits before the runner ever reaches
  // the send/sms branch. Mutation-proof: the only thing that changes between
  // this test and (a) is `isSuppressed`.
  it("a suppressed contact exits the run before the sms branch is ever reached", async () => {
    const run = makeRun("r-sms-suppressed")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadRunContext as ReturnType<typeof vi.fn>).mockResolvedValue(smsSendableContext({ isSuppressed: true }))

    const summary = await runSequenceTick()

    expect(summary).toMatchObject({ exited: 1, sent: 0, failed: 0 })
    expect(exitRun).toHaveBeenCalledWith("r-sms-suppressed", "suppressed")
    expect(recordSend).not.toHaveBeenCalled()
    expect(sendRenderedSequenceSms).not.toHaveBeenCalled()
    expect(advanceRun).not.toHaveBeenCalled()
    expect(failRun).not.toHaveBeenCalled()
  })
})
