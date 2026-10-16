// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

type Row = {
  id: string
  business_id: string
  newsletter_id: string
  email: string
  status: string
  attempts: number
  batch_key: string | null
  claimed_at: string | null
}

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  getBusinessSettings: vi.fn(async (..._a: unknown[]) => ({ timezone: "America/New_York" }) as { timezone: string }),
  getNewsletterById: vi.fn(async (..._a: unknown[]) => ({
    id: "nl-1",
    subject: "Awareness before Action",
    content: "<p>body</p>",
    sent_count: 1100,
    failed_count: 4783,
  })),
  updateNewsletter: vi.fn(async (..._a: unknown[]) => ({})),
  stillSubscribed: vi.fn(async (emails: string[]) => new Set(emails)),
  getSetting: vi.fn(async (_k: string, fallback: unknown) => fallback),
  businessesWithRetryWork: vi.fn(async () => ["biz-1"]),
  listInflightDeliveries: vi.fn(async (..._a: unknown[]) => [] as Row[]),
  oldestPendingNewsletterId: vi.fn(async (..._a: unknown[]) => "nl-1" as string | null),
  settledRetryStats: vi.fn(async (..._a: unknown[]) => ({ sent: 0, bounced: 0, complained: 0 })),
  pauseNewsletterRetry: vi.fn(async (..._a: unknown[]) => 3683),
  pauseDeliveries: vi.fn(async (..._a: unknown[]) => undefined),
  listPendingDeliveries: vi.fn(async (..._a: unknown[]) => [] as Row[]),
  markDeliveriesSkipped: vi.fn(async (..._a: unknown[]) => undefined),
  claimDeliveries: vi.fn(async (ids: string[], ..._a: unknown[]) => ids),
  releaseDeliveries: vi.fn(async (..._a: unknown[]) => undefined),
  markDeliveryFailed: vi.fn(async (..._a: unknown[]) => undefined),
  markBatchSent: vi.fn(async (..._a: unknown[]) => undefined),
  noteDeliveryError: vi.fn(async (..._a: unknown[]) => undefined),
  buildNewsletterHtml: vi.fn((c: string) => `<html>${c}</html>`),
  batchSend: vi.fn(async (..._a: unknown[]) => ({ data: { data: [] as { id: string }[] }, error: null }) as unknown),
}))

vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: mocks.getBusinessSettings }))
vi.mock("@/lib/db/newsletters", () => ({
  getNewsletterById: mocks.getNewsletterById,
  updateNewsletter: mocks.updateNewsletter,
}))
vi.mock("@/lib/db/newsletter", () => ({ stillSubscribed: mocks.stillSubscribed }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: mocks.getSetting }))
vi.mock("@/lib/db/newsletter-deliveries", () => ({
  businessesWithRetryWork: mocks.businessesWithRetryWork,
  listInflightDeliveries: mocks.listInflightDeliveries,
  oldestPendingNewsletterId: mocks.oldestPendingNewsletterId,
  settledRetryStats: mocks.settledRetryStats,
  pauseNewsletterRetry: mocks.pauseNewsletterRetry,
  pauseDeliveries: mocks.pauseDeliveries,
  listPendingDeliveries: mocks.listPendingDeliveries,
  markDeliveriesSkipped: mocks.markDeliveriesSkipped,
  claimDeliveries: (...a: [string[], ...unknown[]]) => {
    mocks.calls.push("claim")
    return mocks.claimDeliveries(...a)
  },
  releaseDeliveries: mocks.releaseDeliveries,
  markDeliveryFailed: mocks.markDeliveryFailed,
  markBatchSent: mocks.markBatchSent,
  noteDeliveryError: mocks.noteDeliveryError,
}))
vi.mock("@/lib/email", () => ({ buildNewsletterHtml: mocks.buildNewsletterHtml }))
vi.mock("@/lib/email/layout", () => ({
  resend: {
    batch: {
      send: (...a: unknown[]) => {
        mocks.calls.push("send")
        return mocks.batchSend(...a)
      },
    },
  },
}))

import {
  BRAKE_MIN_SETTLED,
  BRAKE_MIN_SETTLED_FOR_COMPLAINTS,
  INFLIGHT_RESEND_MS,
  SETTLE_MS,
  batchSizeFor,
  brakeReason,
  isWorkingTime,
  runNewsletterRetryTick,
} from "@/lib/automation/newsletter-retry"

// Monday 2026-10-19, 14:00 UTC = 10:00 in New York (EDT, UTC-4).
const MON_10AM_NY = new Date("2026-10-19T14:00:00Z")
const row = (id: string, email: string, attempts = 0, extra: Partial<Row> = {}): Row => ({
  id,
  business_id: "biz-1",
  newsletter_id: "nl-1",
  email,
  status: "pending",
  attempts,
  batch_key: null,
  claimed_at: null,
  ...extra,
})
const rows = [row("r1", "a@gmail.com"), row("r2", "b@gmail.com"), row("r3", "c@gmail.com")]
const LIMITS = { maxBouncePct: 4, maxComplaintPct: 0.1 }

describe("isWorkingTime", () => {
  it.each([
    ["2026-10-19T13:00:00Z", "America/New_York", true], // Mon 09:00, the first working minute
    ["2026-10-19T12:59:00Z", "America/New_York", false], // Mon 08:59
    ["2026-10-23T20:59:00Z", "America/New_York", true], // Fri 16:59
    ["2026-10-23T21:00:00Z", "America/New_York", false], // Fri 17:00, closed
    ["2026-10-24T16:00:00Z", "America/New_York", false], // Sat noon
    ["2026-10-25T16:00:00Z", "America/New_York", false], // Sun noon
    // The SAME instant is Fri 09:00 in Manila and Thu 21:00 in New York: the
    // business's own clock decides, not the server's.
    ["2026-10-16T01:00:00Z", "Asia/Manila", true],
    ["2026-10-16T01:00:00Z", "America/New_York", false],
  ])("%s in %s -> %s", (iso, tz, expected) => {
    expect(isWorkingTime(new Date(iso), tz)).toBe(expected)
  })

  it("treats a timezone it cannot read as never working time", () => {
    expect(isWorkingTime(MON_10AM_NY, "Not/AZone")).toBe(false)
  })
})

describe("brakeReason", () => {
  it("does not judge bounces on fewer settled sends than the minimum, however bad they look", () => {
    expect(brakeReason({ sent: BRAKE_MIN_SETTLED - 1, bounced: 50, complained: 0 }, LIMITS)).toBeNull()
  })

  it("lets a bounce rate AT the limit through and stops one just over it", () => {
    expect(brakeReason({ sent: 100, bounced: 4, complained: 0 }, LIMITS)).toBeNull()
    expect(brakeReason({ sent: 100, bounced: 5, complained: 0 }, LIMITS)).toBe(
      "5 of 100 resent emails bounced (5.0%, the limit is 4%).",
    )
  })

  it("stops on spam complaints, but only on a big enough sample", () => {
    expect(brakeReason({ sent: BRAKE_MIN_SETTLED_FOR_COMPLAINTS - 1, bounced: 0, complained: 3 }, LIMITS)).toBeNull()
    expect(brakeReason({ sent: 1000, bounced: 0, complained: 1 }, LIMITS)).toBeNull() // 0.10%, at the limit
    expect(brakeReason({ sent: 1000, bounced: 0, complained: 2 }, LIMITS)).toBe(
      "2 of 1,000 people marked a resent email as spam (0.20%, the limit is 0.1%).",
    )
  })

  it("uses the limits it is given", () => {
    expect(brakeReason({ sent: 200, bounced: 18, complained: 0 }, { ...LIMITS, maxBouncePct: 10 })).toBeNull()
    expect(brakeReason({ sent: 200, bounced: 18, complained: 0 }, { ...LIMITS, maxBouncePct: 8 })).not.toBeNull()
  })
})

describe("batchSizeFor", () => {
  it("halves with each 422 a row has had, down to one", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 12].map(batchSizeFor)).toEqual([100, 50, 25, 12, 6, 3, 1, 1, 1])
  })
})

describe("runNewsletterRetryTick", () => {
  const savedFrom = process.env.RESEND_FROM_EMAIL
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.calls.length = 0
    process.env.RESEND_FROM_EMAIL = "Darren J. Paul <noreply@send.darrenjpaul.com>"
    mocks.businessesWithRetryWork.mockResolvedValue(["biz-1"])
    mocks.getBusinessSettings.mockResolvedValue({ timezone: "America/New_York" })
    mocks.listInflightDeliveries.mockResolvedValue([])
    mocks.oldestPendingNewsletterId.mockResolvedValue("nl-1")
    mocks.settledRetryStats.mockResolvedValue({ sent: 0, bounced: 0, complained: 0 })
    mocks.listPendingDeliveries.mockResolvedValue(rows)
    mocks.stillSubscribed.mockImplementation(async (emails: string[]) => new Set(emails))
    mocks.claimDeliveries.mockImplementation(async (ids: string[]) => ids)
    mocks.getSetting.mockImplementation(async (_k: string, fallback: unknown) => fallback)
    mocks.batchSend.mockResolvedValue({ data: { data: [{ id: "re_1" }, { id: "re_2" }, { id: "re_3" }] }, error: null })
  })
  afterEach(() => {
    process.env.RESEND_FROM_EMAIL = savedFrom
  })

  it("sends nothing outside the business's working hours", async () => {
    const summary = await runNewsletterRetryTick(new Date("2026-10-24T16:00:00Z"))
    expect(summary.businesses).toEqual([{ businessId: "biz-1", outcome: "outside_working_hours" }])
    expect(mocks.listInflightDeliveries).not.toHaveBeenCalled()
    expect(mocks.batchSend).not.toHaveBeenCalled()
  })

  it("claims the rows BEFORE sending, then marks each sent with ITS OWN Resend id in one write", async () => {
    const summary = await runNewsletterRetryTick(MON_10AM_NY)

    expect(mocks.calls).toEqual(["claim", "send"])
    const [claimedIds, claimKey, claimedAt] = mocks.claimDeliveries.mock.calls[0] as [string[], string, Date]
    expect(claimedIds).toEqual(["r1", "r2", "r3"])
    expect(claimedAt).toEqual(MON_10AM_NY)

    const [payload, options] = mocks.batchSend.mock.calls[0] as [
      { from: string; to: string; subject: string; html: string }[],
      { idempotencyKey: string },
    ]
    expect(payload.map((p) => p.to)).toEqual(["a@gmail.com", "b@gmail.com", "c@gmail.com"])
    expect(payload[0]).toMatchObject({
      from: "Darren J. Paul <noreply@send.darrenjpaul.com>",
      subject: "Awareness before Action",
      html: "<html><p>body</p></html>",
    })
    // The key sent is the key stored on the rows.
    expect(options.idempotencyKey).toBe(claimKey)
    expect(claimKey).toMatch(/^newsletter-retry\/[0-9a-f]{64}$/)

    expect(mocks.markBatchSent).toHaveBeenCalledTimes(1)
    expect(mocks.markBatchSent).toHaveBeenCalledWith(rows, ["re_1", "re_2", "re_3"], MON_10AM_NY)
    expect(mocks.updateNewsletter).toHaveBeenCalledWith("nl-1", { sent_count: 1103, failed_count: 4780 })
    expect(summary.businesses).toEqual([
      { businessId: "biz-1", outcome: "sent", newsletterId: "nl-1", sent: 3, skipped: 0 },
    ])
  })

  // After a refusal the same rows are claimed again. A key Resend has already
  // answered (with that refusal) must not be the one they go out under.
  it("gives a fresh claim of the same rows a NEW key", async () => {
    await runNewsletterRetryTick(MON_10AM_NY)
    await runNewsletterRetryTick(new Date(MON_10AM_NY.getTime() + 60 * 60 * 1000))
    const [first, second] = mocks.claimDeliveries.mock.calls.map((c) => c[1])
    expect(mocks.claimDeliveries.mock.calls[0][0]).toEqual(mocks.claimDeliveries.mock.calls[1][0])
    expect(second).not.toBe(first)
  })

  it("does not send when another tick claimed some of the rows first", async () => {
    mocks.claimDeliveries.mockResolvedValue(["r1"])
    const summary = await runNewsletterRetryTick(MON_10AM_NY)
    expect(mocks.batchSend).not.toHaveBeenCalled()
    expect(summary.businesses[0]).toEqual({ businessId: "biz-1", outcome: "busy" })
  })

  it("skips anyone who unsubscribed while waiting, and never claims or sends to them", async () => {
    mocks.stillSubscribed.mockResolvedValue(new Set(["a@gmail.com", "c@gmail.com"]))
    mocks.batchSend.mockResolvedValue({ data: { data: [{ id: "re_1" }, { id: "re_3" }] }, error: null })
    const summary = await runNewsletterRetryTick(MON_10AM_NY)

    expect(mocks.markDeliveriesSkipped).toHaveBeenCalledWith(["r2"])
    expect(mocks.claimDeliveries.mock.calls[0][0]).toEqual(["r1", "r3"])
    const payload = mocks.batchSend.mock.calls[0][0] as { to: string }[]
    expect(payload.map((p) => p.to)).toEqual(["a@gmail.com", "c@gmail.com"])
    expect(summary.businesses[0]).toMatchObject({ outcome: "sent", sent: 2, skipped: 1 })
  })

  it("takes a smaller batch from rows a 422 has already halved", async () => {
    const head = Array.from({ length: 100 }, (_, i) => row(`r${i}`, `p${i}@gmail.com`, 1))
    mocks.listPendingDeliveries.mockResolvedValue(head)
    mocks.batchSend.mockResolvedValue({
      data: { data: head.slice(0, 50).map((r) => ({ id: `re_${r.id}` })) },
      error: null,
    })
    await runNewsletterRetryTick(MON_10AM_NY)
    expect((mocks.batchSend.mock.calls[0][0] as unknown[]).length).toBe(50)
  })

  it("pauses the newsletter instead of sending once its settled retries bounce over the limit", async () => {
    mocks.settledRetryStats.mockResolvedValue({ sent: 100, bounced: 9, complained: 0 })
    const summary = await runNewsletterRetryTick(MON_10AM_NY)

    // Only sends old enough to have bounced are judged.
    expect(mocks.settledRetryStats).toHaveBeenCalledWith("biz-1", "nl-1", new Date(MON_10AM_NY.getTime() - SETTLE_MS))
    expect(mocks.pauseNewsletterRetry).toHaveBeenCalledWith(
      "biz-1",
      "nl-1",
      "9 of 100 resent emails bounced (9.0%, the limit is 4%).",
    )
    expect(mocks.batchSend).not.toHaveBeenCalled()
    expect(summary.businesses[0]).toMatchObject({ outcome: "paused", paused: 3683 })
  })

  it("reads both brake limits from system_settings", async () => {
    mocks.settledRetryStats.mockResolvedValue({ sent: 1000, bounced: 90, complained: 2 })
    mocks.getSetting.mockImplementation(async (k: string, fallback: unknown) =>
      k === "newsletter_retry_max_bounce_pct" ? 10 : k === "newsletter_retry_max_complaint_pct" ? 0.5 : fallback,
    )
    await runNewsletterRetryTick(MON_10AM_NY)
    expect(mocks.pauseNewsletterRetry).not.toHaveBeenCalled()
    expect(mocks.batchSend).toHaveBeenCalledTimes(1)
  })

  it("on a 429, puts the rows back with no attempt spent", async () => {
    mocks.batchSend.mockResolvedValue({
      data: null,
      error: {
        name: "daily_quota_exceeded",
        message: "You have reached your daily email sending quota.",
        statusCode: 429,
      },
    })
    const summary = await runNewsletterRetryTick(MON_10AM_NY)
    expect(mocks.releaseDeliveries).toHaveBeenCalledWith(rows, expect.stringContaining("daily_quota_exceeded"), false)
    expect(mocks.markBatchSent).not.toHaveBeenCalled()
    expect(summary.businesses[0]).toMatchObject({ outcome: "deferred" })
  })

  it("on a 422 for a batch, puts the rows back WITH an attempt spent, so the next batch is half the size", async () => {
    mocks.batchSend.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Invalid `to`", statusCode: 422 },
    })
    const summary = await runNewsletterRetryTick(MON_10AM_NY)
    expect(mocks.releaseDeliveries).toHaveBeenCalledWith(rows, "422 validation_error: Invalid `to`", true)
    expect(mocks.markDeliveryFailed).not.toHaveBeenCalled()
    expect(summary.businesses[0]).toMatchObject({ outcome: "refused" })
  })

  it("on a 422 for a batch of ONE, fails that row: it is the bad address", async () => {
    mocks.listPendingDeliveries.mockResolvedValue([row("bad", "bad@gmail.com", 6)])
    mocks.batchSend.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Invalid `to`", statusCode: 422 },
    })
    await runNewsletterRetryTick(MON_10AM_NY)
    expect(mocks.markDeliveryFailed).toHaveBeenCalledWith("bad", "422 validation_error: Invalid `to`")
    expect(mocks.releaseDeliveries).not.toHaveBeenCalled()
  })

  it("on any other refusal (an unverified sender), puts the rows back with NO attempt spent", async () => {
    mocks.batchSend.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "The send.darrenjpaul.com domain is not verified", statusCode: 403 },
    })
    const summary = await runNewsletterRetryTick(MON_10AM_NY)
    expect(mocks.releaseDeliveries).toHaveBeenCalledWith(rows, expect.any(String), false)
    expect(summary.businesses[0]).toMatchObject({ outcome: "send_error" })
  })

  // Resend may have sent these. Releasing them would let a new key send them again.
  it.each([
    ["a 5xx", { data: null, error: { name: "internal_server_error", message: "x", statusCode: 500 } }],
    ["no status", { data: null, error: { name: "application_error", message: "fetch failed", statusCode: null } }],
    [
      "a 409 key conflict",
      { data: null, error: { name: "invalid_idempotent_request", message: "x", statusCode: 409 } },
    ],
  ])("on %s, keeps the rows claimed: no release, no attempt", async (_label, answer) => {
    mocks.batchSend.mockResolvedValue(answer)
    const summary = await runNewsletterRetryTick(MON_10AM_NY)
    expect(mocks.releaseDeliveries).not.toHaveBeenCalled()
    expect(mocks.markBatchSent).not.toHaveBeenCalled()
    expect(mocks.noteDeliveryError).toHaveBeenCalledWith(["r1", "r2", "r3"], expect.any(String))
    expect(summary.businesses[0]).toMatchObject({ outcome: "unconfirmed" })
  })

  it("keeps the rows claimed when the send throws", async () => {
    mocks.batchSend.mockRejectedValue(new Error("socket hang up"))
    const summary = await runNewsletterRetryTick(MON_10AM_NY)
    expect(mocks.releaseDeliveries).not.toHaveBeenCalled()
    expect(summary.businesses[0]).toMatchObject({ outcome: "unconfirmed", error: "exception: socket hang up" })
  })

  it("resends an unconfirmed batch FIRST, the same rows under the same key, and claims nothing new", async () => {
    const claimedAt = new Date(MON_10AM_NY.getTime() - 60 * 60 * 1000).toISOString()
    const inflight = rows.map((r) => ({
      ...r,
      status: "sending",
      batch_key: "newsletter-retry/abc",
      claimed_at: claimedAt,
    }))
    mocks.listInflightDeliveries.mockResolvedValue(inflight)
    await runNewsletterRetryTick(MON_10AM_NY)

    expect(mocks.claimDeliveries).not.toHaveBeenCalled()
    expect(mocks.listPendingDeliveries).not.toHaveBeenCalled()
    expect((mocks.batchSend.mock.calls[0][1] as { idempotencyKey: string }).idempotencyKey).toBe("newsletter-retry/abc")
    expect(mocks.markBatchSent).toHaveBeenCalledWith(inflight, ["re_1", "re_2", "re_3"], MON_10AM_NY)
  })

  it("pauses an unconfirmed batch once Resend's key may have expired, instead of resending it", async () => {
    const claimedAt = new Date(MON_10AM_NY.getTime() - INFLIGHT_RESEND_MS).toISOString()
    const inflight = rows.map((r) => ({
      ...r,
      status: "sending",
      batch_key: "newsletter-retry/abc",
      claimed_at: claimedAt,
    }))
    mocks.listInflightDeliveries.mockResolvedValue(inflight)
    const summary = await runNewsletterRetryTick(MON_10AM_NY)

    expect(mocks.batchSend).not.toHaveBeenCalled()
    expect(mocks.pauseDeliveries).toHaveBeenCalledWith(
      ["r1", "r2", "r3"],
      "Resend never confirmed a batch of 3 sent on Oct 18. Check Resend before resuming, or those people may get it twice.",
    )
    expect(summary.businesses[0]).toMatchObject({ outcome: "paused", paused: 3 })
  })

  it("leaves the rows claimed (resendable under the same key) when marking them sent fails", async () => {
    mocks.markBatchSent.mockRejectedValueOnce(new Error("[newsletter-deliveries] markBatchSent: timeout"))
    const summary = await runNewsletterRetryTick(MON_10AM_NY)
    expect(mocks.releaseDeliveries).not.toHaveBeenCalled()
    expect(mocks.updateNewsletter).not.toHaveBeenCalled()
    expect(summary.businesses[0]).toMatchObject({ outcome: "failed" })
  })

  it("refuses to send at all with no RESEND_FROM_EMAIL, rather than guess a sender", async () => {
    delete process.env.RESEND_FROM_EMAIL
    await expect(runNewsletterRetryTick(MON_10AM_NY)).rejects.toThrow(/RESEND_FROM_EMAIL/)
    expect(mocks.batchSend).not.toHaveBeenCalled()
  })

  it("one business failing does not stop the next", async () => {
    mocks.businessesWithRetryWork.mockResolvedValue(["biz-bad", "biz-1"])
    mocks.getBusinessSettings.mockImplementation(async (id: unknown) => {
      if (id === "biz-bad") throw new Error("no business_settings row")
      return { timezone: "America/New_York" }
    })
    const summary = await runNewsletterRetryTick(MON_10AM_NY)
    expect(summary.businesses).toEqual([
      { businessId: "biz-bad", outcome: "failed", error: "no business_settings row" },
      { businessId: "biz-1", outcome: "sent", newsletterId: "nl-1", sent: 3, skipped: 0 },
    ])
  })
})
