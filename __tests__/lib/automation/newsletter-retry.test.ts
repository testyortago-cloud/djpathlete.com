// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
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
  businessesWithPendingRetries: vi.fn(async () => ["biz-1"]),
  oldestPendingNewsletterId: vi.fn(async (..._a: unknown[]) => "nl-1" as string | null),
  settledRetryStats: vi.fn(async (..._a: unknown[]) => ({ sent: 0, bounced: 0 })),
  pauseNewsletterRetry: vi.fn(async (..._a: unknown[]) => 3683),
  listPendingDeliveries: vi.fn(async (..._a: unknown[]) => [] as { id: string; email: string; attempts: number }[]),
  markDeliveriesSkipped: vi.fn(async (..._a: unknown[]) => undefined),
  markDeliveryRefused: vi.fn(async (..._a: unknown[]) => undefined),
  markDeliverySent: vi.fn(async (..._a: unknown[]) => undefined),
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
  businessesWithPendingRetries: mocks.businessesWithPendingRetries,
  oldestPendingNewsletterId: mocks.oldestPendingNewsletterId,
  settledRetryStats: mocks.settledRetryStats,
  pauseNewsletterRetry: mocks.pauseNewsletterRetry,
  listPendingDeliveries: mocks.listPendingDeliveries,
  markDeliveriesSkipped: mocks.markDeliveriesSkipped,
  markDeliveryRefused: mocks.markDeliveryRefused,
  markDeliverySent: mocks.markDeliverySent,
  noteDeliveryError: mocks.noteDeliveryError,
}))
vi.mock("@/lib/email", () => ({ buildNewsletterHtml: mocks.buildNewsletterHtml }))
vi.mock("@/lib/email/layout", () => ({ resend: { batch: { send: mocks.batchSend } } }))

import {
  BRAKE_MIN_SETTLED,
  MAX_ATTEMPTS,
  SETTLE_MS,
  brakeReason,
  isWorkingTime,
  runNewsletterRetryTick,
} from "@/lib/automation/newsletter-retry"

// Monday 2026-10-19, 14:00 UTC = 10:00 in New York (EDT, UTC-4).
const MON_10AM_NY = new Date("2026-10-19T14:00:00Z")
const rows = [
  { id: "r1", email: "a@gmail.com", attempts: 0 },
  { id: "r2", email: "b@gmail.com", attempts: 0 },
  { id: "r3", email: "c@gmail.com", attempts: 1 },
]

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
  it("does not judge on fewer settled sends than the minimum, however bad they look", () => {
    expect(brakeReason({ sent: BRAKE_MIN_SETTLED - 1, bounced: 50 }, 4)).toBeNull()
  })

  it("lets a rate AT the limit through and stops one just over it", () => {
    expect(brakeReason({ sent: 100, bounced: 4 }, 4)).toBeNull()
    expect(brakeReason({ sent: 100, bounced: 5 }, 4)).toBe("paused: 5 of 100 retried emails bounced (5.0%, limit 4%)")
  })

  it("uses the limit it is given", () => {
    expect(brakeReason({ sent: 200, bounced: 18 }, 10)).toBeNull()
    expect(brakeReason({ sent: 200, bounced: 18 }, 8)).not.toBeNull()
  })
})

describe("runNewsletterRetryTick", () => {
  const savedFrom = process.env.RESEND_FROM_EMAIL
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_FROM_EMAIL = "Darren J. Paul <noreply@send.darrenjpaul.com>"
    mocks.businessesWithPendingRetries.mockResolvedValue(["biz-1"])
    mocks.getBusinessSettings.mockResolvedValue({ timezone: "America/New_York" })
    mocks.oldestPendingNewsletterId.mockResolvedValue("nl-1")
    mocks.settledRetryStats.mockResolvedValue({ sent: 0, bounced: 0 })
    mocks.listPendingDeliveries.mockResolvedValue(rows)
    mocks.stillSubscribed.mockImplementation(async (emails: string[]) => new Set(emails))
    mocks.getSetting.mockImplementation(async (_k: string, fallback: unknown) => fallback)
    mocks.batchSend.mockResolvedValue({ data: { data: [{ id: "re_1" }, { id: "re_2" }, { id: "re_3" }] }, error: null })
  })
  afterEach(() => {
    process.env.RESEND_FROM_EMAIL = savedFrom
  })

  it("sends nothing outside the business's working hours", async () => {
    const sat = new Date("2026-10-24T16:00:00Z")
    const summary = await runNewsletterRetryTick(sat)
    expect(summary.businesses).toEqual([{ businessId: "biz-1", outcome: "outside_working_hours" }])
    expect(mocks.listPendingDeliveries).not.toHaveBeenCalled()
    expect(mocks.batchSend).not.toHaveBeenCalled()
  })

  it("in working hours, sends one batch of the oldest rows from the business's From, and marks each sent with ITS OWN Resend id", async () => {
    const summary = await runNewsletterRetryTick(MON_10AM_NY)

    expect(mocks.listPendingDeliveries).toHaveBeenCalledWith("biz-1", "nl-1", 100)
    expect(mocks.batchSend).toHaveBeenCalledTimes(1)
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
    expect(options.idempotencyKey).toMatch(/^newsletter-retry\/[0-9a-f]{64}$/)

    expect(mocks.markDeliverySent.mock.calls.map((c) => [(c[0] as { id: string }).id, c[1]])).toEqual([
      ["r1", "re_1"],
      ["r2", "re_2"],
      ["r3", "re_3"],
    ])
    expect(mocks.updateNewsletter).toHaveBeenCalledWith("nl-1", { sent_count: 1103, failed_count: 4780 })
    expect(summary.businesses).toEqual([
      { businessId: "biz-1", outcome: "sent", newsletterId: "nl-1", sent: 3, skipped: 0 },
    ])
  })

  it("the same rows always get the same idempotency key, and different rows a different one", async () => {
    await runNewsletterRetryTick(MON_10AM_NY)
    await runNewsletterRetryTick(MON_10AM_NY)
    mocks.listPendingDeliveries.mockResolvedValue(rows.slice(1))
    await runNewsletterRetryTick(MON_10AM_NY)
    const keys = mocks.batchSend.mock.calls.map((c) => (c[1] as { idempotencyKey: string }).idempotencyKey)
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[0])
  })

  it("skips anyone who unsubscribed while waiting, and never sends to them", async () => {
    mocks.stillSubscribed.mockResolvedValue(new Set(["a@gmail.com", "c@gmail.com"]))
    mocks.batchSend.mockResolvedValue({ data: { data: [{ id: "re_1" }, { id: "re_3" }] }, error: null })
    const summary = await runNewsletterRetryTick(MON_10AM_NY)

    expect(mocks.markDeliveriesSkipped).toHaveBeenCalledWith(["r2"])
    const payload = mocks.batchSend.mock.calls[0][0] as { to: string }[]
    expect(payload.map((p) => p.to)).toEqual(["a@gmail.com", "c@gmail.com"])
    expect(summary.businesses[0]).toMatchObject({ outcome: "sent", sent: 2, skipped: 1 })
  })

  it("pauses the newsletter instead of sending once its settled retries bounce over the limit", async () => {
    mocks.settledRetryStats.mockResolvedValue({ sent: 100, bounced: 9 })
    const summary = await runNewsletterRetryTick(MON_10AM_NY)

    // Only sends old enough to have bounced are judged.
    expect(mocks.settledRetryStats).toHaveBeenCalledWith("biz-1", "nl-1", new Date(MON_10AM_NY.getTime() - SETTLE_MS))
    expect(mocks.pauseNewsletterRetry).toHaveBeenCalledWith(
      "biz-1",
      "nl-1",
      "paused: 9 of 100 retried emails bounced (9.0%, limit 4%)",
    )
    expect(mocks.batchSend).not.toHaveBeenCalled()
    expect(summary.businesses[0]).toMatchObject({ outcome: "paused", paused: 3683 })
  })

  it("reads the brake's limit from system_settings", async () => {
    mocks.settledRetryStats.mockResolvedValue({ sent: 100, bounced: 9 })
    mocks.getSetting.mockImplementation(async (k: string, fallback: unknown) =>
      k === "newsletter_retry_max_bounce_pct" ? 10 : fallback,
    )
    await runNewsletterRetryTick(MON_10AM_NY)
    expect(mocks.pauseNewsletterRetry).not.toHaveBeenCalled()
    expect(mocks.batchSend).toHaveBeenCalledTimes(1)
  })

  it("on a quota or rate limit, spends no attempt and leaves the rows for next hour", async () => {
    mocks.batchSend.mockResolvedValue({
      data: null,
      error: {
        name: "daily_quota_exceeded",
        message: "You have reached your daily email sending quota.",
        statusCode: 429,
      },
    })
    const summary = await runNewsletterRetryTick(MON_10AM_NY)
    expect(mocks.markDeliveryRefused).not.toHaveBeenCalled()
    expect(mocks.markDeliverySent).not.toHaveBeenCalled()
    expect(mocks.noteDeliveryError).toHaveBeenCalledWith(
      ["r1", "r2", "r3"],
      expect.stringContaining("daily_quota_exceeded"),
    )
    expect(summary.businesses[0]).toMatchObject({ outcome: "deferred" })
  })

  it("on a 422 (what is IN the batch), spends one attempt per row", async () => {
    mocks.batchSend.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Invalid `to`", statusCode: 422 },
    })
    const summary = await runNewsletterRetryTick(MON_10AM_NY)
    expect(mocks.markDeliveryRefused).toHaveBeenCalledTimes(3)
    expect(mocks.markDeliveryRefused).toHaveBeenCalledWith(rows[2], "validation_error: Invalid `to`", MAX_ATTEMPTS)
    expect(summary.businesses[0]).toMatchObject({ outcome: "refused" })
  })

  it("on any other error (an unverified sender, an outage), spends NO attempt", async () => {
    mocks.batchSend.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "The send.darrenjpaul.com domain is not verified", statusCode: 403 },
    })
    const summary = await runNewsletterRetryTick(MON_10AM_NY)
    expect(mocks.markDeliveryRefused).not.toHaveBeenCalled()
    expect(mocks.noteDeliveryError).toHaveBeenCalledTimes(1)
    expect(summary.businesses[0]).toMatchObject({ outcome: "send_error" })
  })

  it("refuses to send at all with no RESEND_FROM_EMAIL, rather than guess a sender", async () => {
    delete process.env.RESEND_FROM_EMAIL
    await expect(runNewsletterRetryTick(MON_10AM_NY)).rejects.toThrow(/RESEND_FROM_EMAIL/)
    expect(mocks.batchSend).not.toHaveBeenCalled()
  })

  it("one business failing does not stop the next", async () => {
    mocks.businessesWithPendingRetries.mockResolvedValue(["biz-bad", "biz-1"])
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
