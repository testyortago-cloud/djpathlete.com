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

// Tracks every `contact_timeline_events` insert the runner makes (for the
// "sequence_step_unsupported" / "sequence_alert" visibility rows) without
// reimplementing Supabase filtering — this table is write-only from the
// runner's side, so a spy that records inserts is enough; no read path to
// get wrong. `vi.hoisted` because the mock factory below runs before this
// module's own top-level statements.
const { timelineInsertSpy } = vi.hoisted(() => ({ timelineInsertSpy: vi.fn() }))

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: vi.fn() }))
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
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: vi.fn(), logCronEnd: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
// Only the SENDER is mocked. `assertSendable`, `renderSequenceEmail` and
// `BusinessNotConfiguredError` stay real: the route's unconfigured-business
// arm is an `instanceof` check across this module boundary, and a mock that
// replaced the class would make that check pass or fail for reasons unrelated
// to the code that ships.
vi.mock("@/lib/lead-engine/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lead-engine/email")>()),
  sendSequenceEmail: vi.fn(),
}))
vi.mock("@/lib/lead-engine/unsubscribe-token", () => ({
  unsubscribeUrl: vi.fn(() => "https://example.test/unsubscribe/tok"),
  unsubscribeOneClickUrl: vi.fn(() => "https://example.test/api/unsubscribe/tok"),
}))
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
import { unsubscribeUrl, unsubscribeOneClickUrl } from "@/lib/lead-engine/unsubscribe-token"
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
  process.env.INTERNAL_CRON_TOKEN = TOKEN
  // appOrigin() throws when no public origin is configured (fix wave,
  // Critical 2). Pinned here rather than inherited from .env.local so this
  // suite does not depend on a developer's local file.
  process.env.NEXTAUTH_URL = "https://app.example.test"
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
        // RFC 8058: the List-Unsubscribe header needs a POST-capable URI,
        // which is a different path from the human landing page.
        oneClickUrl: "https://example.test/api/unsubscribe/tok",
        settings: SETTINGS,
      }),
    )
    expect(unsubscribeUrl).toHaveBeenCalledWith(expect.any(String), "contact-r1", expect.any(String))
    expect(unsubscribeOneClickUrl).toHaveBeenCalledWith(expect.any(String), "contact-r1", expect.any(String))
    expect(markSent).toHaveBeenCalledWith("msg-1", "resend", "resend-1")
    expect(advanceRun).toHaveBeenCalledWith("r1", 1)
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      "success",
      expect.objectContaining({ claimed: 1, sent: 1 }),
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
      expect.anything(),
      "run-1",
      "success",
      expect.objectContaining({ claimed: 0 }),
    )
    // Settings ARE read before claiming now — the unconfigured-business
    // preflight (assertSendable) has to run before anything is claimed.
    expect(getBusinessSettings).toHaveBeenCalled()
  })

  it("writes a cron_runs row on failure when the batch itself throws", async () => {
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("rpc unreachable"))
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      "failed",
      expect.objectContaining({ message: expect.stringContaining("rpc unreachable") }),
    )
  })

  it("an sms send action fails that run loudly rather than pretending to send", async () => {
    const run = makeRun("r-sms")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadSteps as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...EMAIL_STEP, kind: "sms" }])
    ;(loadRunContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      sendableContext({
        contact: { email: null, phone_e164: "+15551234567", user_id: null, name: null },
        hasSmsConsent: true,
      }),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ failed: 1 })
    expect(failRun).toHaveBeenCalledWith("r-sms", expect.stringContaining("sms"))
    expect(sendSequenceEmail).not.toHaveBeenCalled()
    expect(recordSend).not.toHaveBeenCalled()
  })

  it("an alert step writes a sequence_alert timeline event and advances the run rather than stalling it", async () => {
    const run = makeRun("r-alert")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadSteps as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...EMAIL_STEP, kind: "alert" }])

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(timelineInsertSpy).toHaveBeenCalledWith(
      "contact_timeline_events",
      expect.objectContaining({
        contact_id: "contact-r-alert",
        kind: "sequence_alert",
        source: "sequence_engine",
        metadata: expect.objectContaining({ run_id: "r-alert", sequence_id: "seq-1", step_id: "step-1" }),
      }),
    )
    expect(advanceRun).toHaveBeenCalledWith("r-alert", 1)
    expect(failRun).not.toHaveBeenCalled()
  })

  // Fix wave (Important 6). The alert notifies the OPERATOR at
  // settings.reply_to but reused the marketing sender, so it carried an
  // unsubscribe link signed for the LEAD the alert concerns. The unsubscribe
  // page writes on GET and corporate mail scanners GET every URL in an inbound
  // message — a scanner in the operator's inbox would silently suppress that
  // lead, exit their runs, and write a granted:false consent row blaming
  // `unsubscribe_link`: a falsified record in the table whose whole purpose is
  // defensible consent.
  it("an alert email carries no unsubscribe link for the lead it is about", async () => {
    const run = makeRun("r-alert-nolink")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadSteps as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...EMAIL_STEP, kind: "alert" }])

    await POST(makeRequest())

    expect(sendSequenceEmail).toHaveBeenCalledTimes(1)
    const arg = (sendSequenceEmail as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.to).toBe(SETTINGS.reply_to)
    expect(arg.includeUnsubscribeFooter).toBe(false)
    // Not merely "not rendered" — no token URL is minted for this message at
    // all, so there is nothing for a scanner to follow.
    expect(arg.unsubscribeUrl).toBeUndefined()
    expect(arg.oneClickUrl).toBeUndefined()
    expect(unsubscribeUrl).not.toHaveBeenCalled()
    expect(unsubscribeOneClickUrl).not.toHaveBeenCalled()
  })

  it("a normal marketing send still carries the footer (the flag is opt-out, not default-off)", async () => {
    const run = makeRun("r-marketing")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])

    await POST(makeRequest())

    const arg = (sendSequenceEmail as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.includeUnsubscribeFooter).not.toBe(false)
    expect(arg.unsubscribeUrl).toBe("https://example.test/unsubscribe/tok")
  })

  it("an unsupported tag/stage step writes a sequence_step_unsupported timeline event before advancing (spec §6, 'visible, not silent')", async () => {
    const run = makeRun("r-tag")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadSteps as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...EMAIL_STEP, kind: "tag" }])

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(timelineInsertSpy).toHaveBeenCalledWith(
      "contact_timeline_events",
      expect.objectContaining({
        contact_id: "contact-r-tag",
        kind: "sequence_step_unsupported",
        source: "sequence_engine",
        metadata: expect.objectContaining({ run_id: "r-tag", sequence_id: "seq-1", step_id: "step-1" }),
      }),
    )
    expect(advanceRun).toHaveBeenCalledWith("r-tag", 1, undefined)
    expect(failRun).not.toHaveBeenCalled()
  })

  it("a 'stage' step ALSO writes the unsupported-kind timeline event (not just 'tag')", async () => {
    const run = makeRun("r-stage")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadSteps as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...EMAIL_STEP, kind: "stage" }])

    await POST(makeRequest())

    expect(timelineInsertSpy).toHaveBeenCalledWith(
      "contact_timeline_events",
      expect.objectContaining({ kind: "sequence_step_unsupported" }),
    )
  })

  it("a normal advance (e.g. past a wait step) does NOT write any timeline event", async () => {
    const run = makeRun("r-wait")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadSteps as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...EMAIL_STEP, kind: "wait", wait_minutes: 60 }])

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(advanceRun).toHaveBeenCalledWith("r-wait", 1, expect.any(Date))
    expect(timelineInsertSpy).not.toHaveBeenCalled()
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

  // Fix round (Important 1): {{name}} was rendering empty for every
  // recipient because the runner hardcoded contactName: null instead of
  // reading it from DecisionContext.contact.name.
  it("a contact with a name on file has it threaded through to the sent email", async () => {
    const run = makeRun("r-named")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadRunContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      sendableContext({ contact: { email: "lead@example.com", phone_e164: null, user_id: null, name: "Jane" } }),
    )

    await POST(makeRequest())

    expect(sendSequenceEmail).toHaveBeenCalledWith(expect.objectContaining({ contactName: "Jane" }))
  })

  // Fix wave (Critical 1): migration 00212 seeds display_name / sender_name /
  // sender_email / reply_to / postal_address as NOT NULL DEFAULT '' and
  // nothing calls updateBusinessSettings, so the first tick after the flag is
  // flipped would send `from: " <>"`, get rejected by Resend, and permanently
  // fail every claimed run. The preflight must run BEFORE claiming.
  describe("an unconfigured business", () => {
    it("claims nothing, fails nothing, and answers 200 naming the missing fields", async () => {
      ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...SETTINGS,
        sender_email: "",
        display_name: "",
        postal_address: "",
      })
      ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([makeRun("r-would-have-sent")])

      const res = await POST(makeRequest())

      // 200, not 500: the caller is a scheduler. A 500 retries a
      // misconfiguration forever.
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.error).toBe("business_settings not configured: sender_email, display_name, postal_address")

      // Nothing claimed and nothing failed — the whole point of running the
      // preflight before claimDueRuns.
      expect(claimDueRuns).not.toHaveBeenCalled()
      expect(failRun).not.toHaveBeenCalled()
      expect(recordSend).not.toHaveBeenCalled()
      expect(sendSequenceEmail).not.toHaveBeenCalled()
    })

    it("names only the fields that are actually blank", async () => {
      ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...SETTINGS, postal_address: "   " })

      const res = await POST(makeRequest())

      expect(res.status).toBe(200)
      expect((await res.json()).error).toBe("business_settings not configured: postal_address")
      expect(claimDueRuns).not.toHaveBeenCalled()
    })

    it("records the refusal on the cron run so it is not silent", async () => {
      ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...SETTINGS, sender_email: "" })

      await POST(makeRequest())

      expect(logCronEnd).toHaveBeenCalledWith(
        expect.anything(),
        "run-1",
        "failed",
        expect.objectContaining({ message: expect.stringContaining("business_settings not configured") }),
      )
    })

    it("a fully configured business is not blocked", async () => {
      ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([makeRun("r-fine")])
      const res = await POST(makeRequest())
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ok: true, sent: 1 })
    })
  })

  it("a contact with no name on file still sends, with contactName null (falls back to '' per lib/lead-engine/email.ts)", async () => {
    const run = makeRun("r-unnamed")
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([run])
    ;(loadRunContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      sendableContext({ contact: { email: "lead@example.com", phone_e164: null, user_id: null, name: null } }),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(sendSequenceEmail).toHaveBeenCalledWith(expect.objectContaining({ contactName: null }))
  })
})
