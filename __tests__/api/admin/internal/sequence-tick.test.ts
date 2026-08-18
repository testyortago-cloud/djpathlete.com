// @vitest-environment node
//
// Route-level tests for POST /api/admin/internal/sequence-tick. The route is
// a thin wrapper (bearer check, cron-flag gate, logCronStart/logCronEnd)
// around `runSequenceTick` (lib/automation/sequence-tick-runner.ts), which is
// NOT mocked here — its pure decision core (`decideStep`, lib/automation/
// sequence-tick.ts) is real too. Only the IO edges are mocked: the sequences
// DAL, business settings, the email sender and the unsubscribe URL builder.
// This is the same "mock the DAL, run the real logic" shape as
// __tests__/api/admin/internal/bookkeeping-income-sync.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: vi.fn(), logCronEnd: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
vi.mock("@/lib/lead-engine/email", () => ({ sendSequenceEmail: vi.fn() }))
vi.mock("@/lib/lead-engine/unsubscribe-token", () => ({ unsubscribeUrl: vi.fn(() => "https://example.test/unsubscribe/tok") }))
vi.mock("@/lib/db/sequences", () => ({
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

import { isCronSkipped } from "@/lib/db/system-settings"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { getBusinessSettings } from "@/lib/db/businesses"
import { sendSequenceEmail } from "@/lib/lead-engine/email"
import { unsubscribeUrl } from "@/lib/lead-engine/unsubscribe-token"
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
import { POST } from "@/app/api/admin/internal/sequence-tick/route"
import type { SequenceRunRow, SequenceStepRow, DecisionContext } from "@/lib/automation/sequence-tick"

const TOKEN = "test-cron-token"
const AUTH = `Bearer ${TOKEN}`

const SETTINGS = {
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
}

function makeRequest(authHeader = AUTH): NextRequest {
  return new NextRequest("http://localhost/api/admin/internal/sequence-tick", {
    method: "POST",
    headers: { authorization: authHeader },
  })
}

function makeRun(id: string, overrides: Partial<SequenceRunRow> = {}): SequenceRunRow {
  return {
    id,
    sequence_id: "seq-1",
    contact_id: `contact-${id}`,
    current_position: 0,
    enrolled_at: "2026-08-18T00:00:00Z",
    ...overrides,
  }
}

const EMAIL_STEP: SequenceStepRow = {
  id: "step-1",
  position: 0,
  kind: "email",
  wait_minutes: null,
  subject: "Hi",
  body: "Welcome",
  branch_condition: null,
  on_true_position: null,
  on_false_position: null,
  config: {},
}

// Quiet hours span the full day and dailyCap is generous, so quietHoursDefer
// and dailyCapDefer never fire regardless of wall-clock time — the point is
// to exercise the real decideStep/guardrail code without a flaky test tied
// to "now".
function sendableContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    now: new Date("2026-08-18T18:00:00Z"),
    timezone: "UTC",
    quiet: { startHour: 0, endHour: 24 },
    dailyCap: 5,
    sentAtToday: [],
    activeSiblings: [],
    contact: { email: "lead@example.com", phone_e164: null, user_id: null },
    hasEmailConsent: false,
    hasSmsConsent: false,
    isSuppressed: false,
    enrolledSource: "funnel_form",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = TOKEN
  ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: false })
  ;(logCronStart as ReturnType<typeof vi.fn>).mockResolvedValue("run-1")
  ;(logCronEnd as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue(SETTINGS)
  ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(loadSteps as ReturnType<typeof vi.fn>).mockResolvedValue([EMAIL_STEP])
  ;(loadRunContext as ReturnType<typeof vi.fn>).mockResolvedValue(sendableContext())
  ;(recordSend as ReturnType<typeof vi.fn>).mockResolvedValue({ claimed: true, messageId: "msg-1" })
  ;(sendSequenceEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ providerMessageId: "resend-1" })
  ;(markSent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(markFailed as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(advanceRun as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(deferRun as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(exitRun as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(completeRun as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(failRun as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
})

describe("POST /api/admin/internal/sequence-tick", () => {
  it("401s without the bearer token", async () => {
    const res = await POST(makeRequest(""))
    expect(res.status).toBe(401)
    expect(isCronSkipped).not.toHaveBeenCalled()
  })

  it("401s with a wrong bearer token", async () => {
    const res = await POST(makeRequest("Bearer wrong"))
    expect(res.status).toBe(401)
  })

  it("skips when the flag is off, and does not claim anything", async () => {
    ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: true, reason: "disabled" })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).skipped).toBe("disabled")
    expect(logCronStart).not.toHaveBeenCalled()
    expect(claimDueRuns).not.toHaveBeenCalled()
  })

  it("claims, decides and records a send for a due run", async () => {
    const run = makeRun("r1")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, claimed: 1, sent: 1 })

    expect(recordSend).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "r1",
        stepId: "step-1",
        contactId: "contact-r1",
        channel: "email",
        toIdentifier: "lead@example.com",
      }),
    )
    expect(sendSequenceEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "lead@example.com",
        subject: "Hi",
        body: "Welcome",
        unsubscribeUrl: "https://example.test/unsubscribe/tok",
        settings: SETTINGS,
      }),
    )
    expect(unsubscribeUrl).toHaveBeenCalledWith(expect.any(String), "contact-r1", expect.any(String))
    expect(markSent).toHaveBeenCalledWith("msg-1", "resend", "resend-1")
    expect(advanceRun).toHaveBeenCalledWith("r1", 1)
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ claimed: 1, sent: 1 }),
    )
  })

  it("continues the batch when one run throws", async () => {
    const runA = makeRun("r-poison")
    const runB = makeRun("r-ok")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([runA, runB])
    ;(loadRunContext as ReturnType<typeof vi.fn>).mockImplementation(async (run: SequenceRunRow) => {
      if (run.id === "r-poison") throw new Error("contact row missing")
      return sendableContext()
    })

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    // The poisoned run is recorded as failed; the healthy run still sent.
    expect(body).toMatchObject({ ok: true, claimed: 2, sent: 1, failed: 1 })

    expect(failRun).toHaveBeenCalledWith("r-poison", expect.stringContaining("contact row missing"))
    // The second run was NOT skipped — it reached the real send path.
    expect(recordSend).toHaveBeenCalledWith(expect.objectContaining({ runId: "r-ok" }))
    expect(advanceRun).toHaveBeenCalledWith("r-ok", 1)

    // The batch as a whole still succeeded — a per-run failure is not a
    // cron-run failure.
    expect(logCronEnd).toHaveBeenCalledWith(expect.anything(), "run-1", "success", expect.anything())
  })

  it("writes a cron_runs row on success (nothing due)", async () => {
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "sequenceTickCron")
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ claimed: 0 }),
    )
    // Nothing claimed: business settings should not even be read.
    expect(getBusinessSettings).not.toHaveBeenCalled()
  })

  it("writes a cron_runs row on failure when the batch itself throws", async () => {
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("rpc unreachable"))
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "failed", expect.objectContaining({ message: expect.stringContaining("rpc unreachable") }),
    )
  })

  it("an sms send action fails that run loudly rather than pretending to send", async () => {
    const run = makeRun("r-sms")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadSteps as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...EMAIL_STEP, kind: "sms" }])
    ;(loadRunContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      sendableContext({ contact: { email: null, phone_e164: "+15551234567", user_id: null }, hasSmsConsent: true }),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ failed: 1 })
    expect(failRun).toHaveBeenCalledWith("r-sms", expect.stringContaining("sms"))
    expect(sendSequenceEmail).not.toHaveBeenCalled()
    expect(recordSend).not.toHaveBeenCalled()
  })

  it("an alert step advances the run rather than stalling it", async () => {
    const run = makeRun("r-alert")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadSteps as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...EMAIL_STEP, kind: "alert" }])

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(advanceRun).toHaveBeenCalledWith("r-alert", 1)
    expect(failRun).not.toHaveBeenCalled()
  })

  it("a guardrail-deferred send calls deferRun and counts it, not sent", async () => {
    const run = makeRun("r-defer")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    // Daily cap already met -> dailyCapDefer fires.
    ;(loadRunContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      sendableContext({ dailyCap: 1, sentAtToday: ["2026-08-18T12:00:00Z"] }),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ deferred: 1, sent: 0 })
    expect(deferRun).toHaveBeenCalledWith("r-defer", expect.any(Date), "daily_cap")
    expect(sendSequenceEmail).not.toHaveBeenCalled()
  })

  it("recordSend reporting the send already owned by another attempt releases the claim via a short defer", async () => {
    const run = makeRun("r-race")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(recordSend as ReturnType<typeof vi.fn>).mockResolvedValue({ claimed: false, messageId: null })

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(deferRun).toHaveBeenCalledWith("r-race", expect.any(Date), "send_in_progress")
    expect(sendSequenceEmail).not.toHaveBeenCalled()
  })
})
