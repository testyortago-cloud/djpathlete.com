// @vitest-environment node
//
// Which faults kill a run, and which ones only pause it.
//
// On 2026-08-31 the tick ran in production for the first time and destroyed
// all 73 sms_repermission runs in ten minutes. Every one failed with
// "The darrenjpaul.com domain is not verified" — one settings field naming a
// domain Resend had never been asked to verify. The email branch treated that
// provider rejection the way it treats an undeliverable mailbox: markFailed +
// failRun, terminal. recordSend refuses to re-claim a `failed` message row, so
// there was no way back in without a hand-run database repair.
//
// The runner already owns the mechanism this needed — transientBackoffMs and
// MAX_ATTEMPTS, reached from runSequenceTick's per-run catch. The email branch
// simply never routed into it, because its own try swallowed the throw first.
//
// Harness copied from sequence-tick-email-env.test.ts: the network is mocked
// at the `resend` PACKAGE boundary, not at the lib/lead-engine/email module
// boundary, so sendRenderedSequenceEmail and classifySendFault both stay real
// and the classification is exercised through the actual throw site.
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
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn(), listBusinesses: vi.fn() }))
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
  ;(listBusinesses as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "biz-1" }])
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


const UNVERIFIED_DOMAIN = {
  data: null,
  error: {
    name: "validation_error",
    statusCode: 403,
    message:
      "The darrenjpaul.com domain is not verified. Please, add and verify your domain on https://resend.com/domains",
  },
}

describe("a configuration fault", () => {
  it("defers the run and leaves the message row claimable", async () => {
    sendMock.mockResolvedValue(UNVERIFIED_DOMAIN)
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([makeRun("run-1")])

    const summary = await runSequenceTick()

    // markFailed is the thing that makes a run unrecoverable: recordSend will
    // not re-claim a row in status 'failed'. Leaving it `queued` is also
    // simply true — nothing was delivered.
    expect(markFailed).not.toHaveBeenCalled()
    expect(failRun).not.toHaveBeenCalled()
    expect(deferRun).toHaveBeenCalledTimes(1)
    expect(summary.config_faults).toBe(1)
    expect(summary.failed).toBe(0)
  })

  it("defers past recordSend's 15-minute reclaim window", async () => {
    // A shorter defer bounces: recordSend sees its own queued row as too
    // young to re-claim and hands back claimed:false, burning a tick on
    // `send_in_progress`.
    sendMock.mockResolvedValue(UNVERIFIED_DOMAIN)
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([makeRun("run-1", { attempts: 1 })])

    const before = Date.now()
    await runSequenceTick()

    const until = (deferRun as ReturnType<typeof vi.fn>).mock.calls[0][1] as Date
    expect(until.getTime() - before).toBeGreaterThan(15 * 60 * 1000)
  })

  it("still fails terminally once attempts are exhausted", async () => {
    // The bounded half of "default to configuration": five deferrals, then
    // the run fails for real. Without this the inverted default would be an
    // infinite retry.
    sendMock.mockResolvedValue(UNVERIFIED_DOMAIN)
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([makeRun("run-1", { attempts: 5 })])

    const summary = await runSequenceTick()

    expect(deferRun).not.toHaveBeenCalled()
    expect(failRun).toHaveBeenCalledTimes(1)
    expect(summary.failed).toBe(1)
  })
})

describe("a recipient fault", () => {
  it("still fails the run terminally, exactly as before", async () => {
    // The other direction gets its own test on purpose. One test that passes
    // whichever way the branch goes pins neither.
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "invalid_to_address", statusCode: 422, message: "Invalid `to` field." },
    })
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([makeRun("run-1")])

    const summary = await runSequenceTick()

    expect(markFailed).toHaveBeenCalledTimes(1)
    expect(failRun).toHaveBeenCalledTimes(1)
    expect(summary.failed).toBe(1)
    expect(summary.config_faults ?? 0).toBe(0)
  })
})
