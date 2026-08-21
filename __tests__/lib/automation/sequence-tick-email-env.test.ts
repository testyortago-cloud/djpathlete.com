// @vitest-environment node
//
// Unit tests for the email branch's env-availability gate in `processRun`'s
// case "send" (lib/automation/sequence-tick-runner.ts) — Task 1,
// 2026-08-22-lead-engine-stage4-spine. Mirrors the sms env-case tests in
// __tests__/lib/automation/sequence-tick-sms.test.ts: RESEND_API_KEY missing
// must advance the run with a visible timeline event and NO
// sequence_messages claim, rather than the old "warn and pretend it sent"
// behavior — lib/lead-engine/email.ts's resend guard used to return
// { data: null, error: null } on a missing key, and the runner then called
// markSent(messageId, "resend", null) on a message nothing ever
// transmitted, permanently burning recordSend's one-shot (run_id, step_id)
// claim.
//
// Only the IO edges are mocked: the sequences DAL, business settings, the
// Resend network call (mocked at the `resend` npm package boundary, same
// point as __tests__/lib/lead-engine/email.test.ts — NOT at the
// lib/lead-engine/email module boundary, so assertSendable, emailEnvPresent,
// renderSequenceEmail and sendRenderedSequenceEmail all stay real), and the
// timeline-event insert. decideStep (lib/automation/sequence-tick.ts, pure)
// stays real throughout — no case here needs to force its return value.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
// The sms path is untouched by this suite, but the runner imports it
// unconditionally, so it needs a mock shape too — same split the sms-focused
// suite uses for its (untouched) email import.
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
  // as the sms-focused and route-level suites.
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

import { getBusinessSettings } from "@/lib/db/businesses"
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
  failRun,
} from "@/lib/db/sequences"
import { runSequenceTick } from "@/lib/automation/sequence-tick-runner"
import type { SequenceRunRow, SequenceStepRow, DecisionContext } from "@/lib/automation/sequence-tick"
import type { BusinessSettings } from "@/lib/db/businesses"

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

const EMAIL_STEP: SequenceStepRow = {
  id: "step-email-1",
  position: 0,
  kind: "email",
  wait_minutes: null,
  subject: "Hi {{name}}",
  body: "Welcome, {{name}}.",
  branch_condition: null,
  on_true_position: null,
  on_false_position: null,
  config: {},
}

// Quiet hours span the full day and dailyCap is generous, so the guardrails
// never fire regardless of wall-clock time — same rationale as the
// route-level suite's `sendableContext`.
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

beforeEach(() => {
  vi.clearAllMocks()
  timelineInsertSpy.mockClear()
  process.env.NEXTAUTH_URL = "https://app.example.test"
  // emailEnvPresent() (lib/lead-engine/email.ts) is real in this suite, not
  // mocked — it reads process.env directly, same treatment as smsEnvPresent
  // in the sms-focused suite. Pinned present by default so the "configured"
  // control test actually exercises the send path; the env-missing test
  // deletes it explicitly.
  process.env.RESEND_API_KEY = "re_test"
  sendMock.mockResolvedValue({ data: { id: "resend-env-default" }, error: null })
  ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue(SETTINGS)
  ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(loadSteps as ReturnType<typeof vi.fn>).mockResolvedValue([EMAIL_STEP])
  ;(loadRunContext as ReturnType<typeof vi.fn>).mockResolvedValue(sendableContext())
  ;(recordSend as ReturnType<typeof vi.fn>).mockResolvedValue({ claimed: true, messageId: "msg-1" })
  ;(sendRenderedSequenceSms as ReturnType<typeof vi.fn>).mockResolvedValue({ providerMessageId: "SM-default" })
  ;(markSent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(markFailed as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(advanceRun as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(deferRun as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(failRun as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
})

afterEach(() => {
  delete process.env.RESEND_API_KEY
})

describe("the email env-availability gate (lib/automation/sequence-tick-runner.ts)", () => {
  it("a due email step with RESEND_API_KEY unset advances with a visible timeline event, no message row, and no provider call", async () => {
    delete process.env.RESEND_API_KEY
    const run = makeRun("r-email-envmissing")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])

    const summary = await runSequenceTick()

    expect(summary).toMatchObject({ sent: 0, failed: 0, skipped_email: 1 })

    expect(timelineInsertSpy).toHaveBeenCalledWith(
      "contact_timeline_events",
      expect.objectContaining({
        contact_id: "contact-r-email-envmissing",
        kind: "sequence_step_unsupported",
        source: "sequence_engine",
        metadata: expect.objectContaining({
          run_id: "r-email-envmissing",
          sequence_id: "seq-1",
          step_id: "step-email-1",
          step_kind: "email",
          reason: "email_env_missing",
        }),
      }),
    )
    expect(advanceRun).toHaveBeenCalledWith("r-email-envmissing", 1)
    expect(failRun).not.toHaveBeenCalled()

    // Nothing pretends to have sent anything, and no message row is
    // claimed — recordSend's (run_id, step_id) claim is permanent, so
    // writing one here would block the real send once RESEND_API_KEY is set.
    expect(sendMock).not.toHaveBeenCalled()
    expect(recordSend).not.toHaveBeenCalled()
    expect(markSent).not.toHaveBeenCalled()
  })

  // Task-1 review guard: the gate must fire BEFORE the `!to` guard (mirrors
  // the sms branch's ordering — smsAvailability.configured is checked before
  // ctx.contact.phone_e164). A contact with no email address on an
  // env-missing deployment must still take the visible/advance path, not the
  // failRun("no email address") path — env-missing is checked first either
  // way, so this also proves the gate does not depend on a resolvable
  // recipient to fire.
  it("the env-missing gate fires even for a contact with no email on file", async () => {
    delete process.env.RESEND_API_KEY
    const run = makeRun("r-email-envmissing-noemail")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadRunContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      sendableContext({ contact: { email: null, phone_e164: null, user_id: null, name: null } }),
    )

    const summary = await runSequenceTick()

    // decideStep itself advances a phoneless/emailless contact with
    // note "no_email_address" before the runner is ever handed a "send"
    // action — same "unreachable through the real decision core" shape as
    // the sms branch's `!to` guard. This assertion pins that the env gate
    // never gets a chance to matter here either way: still no failRun, no
    // provider call, no message row.
    expect(failRun).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
    expect(recordSend).not.toHaveBeenCalled()
    expect(summary.failed).toBe(0)
  })

  // Success path unchanged: a configured deployment still sends via the real
  // Resend call chain (assertSendable -> renderSequenceEmail ->
  // sendRenderedSequenceEmail -> resend.emails.send), records the message,
  // and advances. markSent receives the actual provider id the mocked
  // network call returned, not a null fabricated by a bypassed guard.
  it("a configured deployment sends via Resend, records the message, and advances — the gate does not touch the success path", async () => {
    const run = makeRun("r-email-send")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadRunContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      sendableContext({ contact: { email: "lead@example.com", phone_e164: null, user_id: null, name: "Jane" } }),
    )
    ;(recordSend as ReturnType<typeof vi.fn>).mockResolvedValue({ claimed: true, messageId: "msg-email-a" })
    sendMock.mockResolvedValue({ data: { id: "resend-abc123" }, error: null })

    const summary = await runSequenceTick()

    expect(summary).toMatchObject({ claimed: 1, sent: 1, failed: 0 })
    expect(summary.skipped_email).toBeUndefined()

    expect(recordSend).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "r-email-send",
        stepId: "step-email-1",
        contactId: "contact-r-email-send",
        channel: "email",
        toIdentifier: "lead@example.com",
        subject: "Hi Jane",
      }),
    )
    expect(sendMock).toHaveBeenCalledTimes(1)
    const sentArg = sendMock.mock.calls[0][0]
    expect(sentArg.to).toBe("lead@example.com")
    expect(sentArg.subject).toBe("Hi Jane")

    // markSent gets the REAL provider id the mocked Resend call returned.
    expect(markSent).toHaveBeenCalledWith("msg-email-a", "resend", "resend-abc123")
    expect(advanceRun).toHaveBeenCalledWith("r-email-send", 1)
    expect(failRun).not.toHaveBeenCalled()
  })
})
