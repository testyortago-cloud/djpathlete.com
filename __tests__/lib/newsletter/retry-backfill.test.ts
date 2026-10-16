// @vitest-environment node
import { describe, it, expect } from "vitest"
import { missedRecipients, unsafeToQueue } from "@/lib/newsletter/retry-backfill"
import { retryStatusLine } from "@/lib/newsletter/retry-status"

const SEND = new Date("2026-10-09T13:00:27Z")
const sub = (email: string, subscribed_at: string, unsubscribed_at: string | null = null) => ({
  email,
  subscribed_at,
  unsubscribed_at,
})
const isUndeliverable = (e: string) => e.endsWith("@example.com")

describe("missedRecipients", () => {
  const subscribers = [
    sub("reached@gmail.com", "2026-06-16T00:00:00Z"),
    sub("Missed@Gmail.com", "2026-06-16T00:00:00Z"),
    sub("left-later@gmail.com", "2026-06-16T00:00:00Z", "2026-10-12T00:00:00Z"),
    sub("left-before@gmail.com", "2026-06-16T00:00:00Z", "2026-10-01T00:00:00Z"),
    sub("joined-after@gmail.com", "2026-10-10T00:00:00Z"),
    sub("jane@example.com", "2026-06-16T00:00:00Z"),
  ]
  const result = missedRecipients({
    subscribers,
    sendStartedAt: SEND,
    reachedAddresses: ["REACHED@gmail.com "],
    isUndeliverable,
  })

  it("counts the list as it stood when the send started", () => {
    // reached, Missed, left-later, jane. Not left-before (gone already), not joined-after (not yet).
    expect(result.listed).toBe(4)
  })

  it("matches Resend's log case-insensitively, and never counts an undeliverable address as missed", () => {
    expect(result.reached).toBe(1)
    expect(result.missed).toEqual(["Missed@Gmail.com", "left-later@gmail.com"])
  })

  it("does not queue anyone who has unsubscribed since", () => {
    expect(result.unsubscribedSince).toEqual(["left-later@gmail.com"])
    expect(result.toQueue).toEqual(["Missed@Gmail.com"])
  })
})

describe("unsafeToQueue", () => {
  const result = (reached: number) => ({ listed: 10, reached, missed: [], unsubscribedSince: [], toQueue: [] })

  it("allows a rebuild whose log saw everyone the send recorded", () => {
    expect(unsafeToQueue(result(1100), 1100)).toBeNull()
  })

  // 2026-09-25 went out on the other Resend account: this key's log saw none of the 1,300.
  it("refuses a rebuild whose log is missing people the send reached", () => {
    expect(unsafeToQueue(result(0), 1300)).toMatch(/shows 0 sends but the newsletter recorded 1300/)
    expect(unsafeToQueue(result(1099), 1100)).not.toBeNull()
  })
})

describe("retryStatusLine", () => {
  const base = {
    newsletter_id: "nl-1",
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    paused: 0,
    bounced: 0,
    complained: 0,
    pause_reason: null,
  }

  it("says nothing for a newsletter with no retry", () => {
    expect(retryStatusLine(undefined)).toBeNull()
    expect(retryStatusLine(base)).toBeNull()
  })

  it("explains the schedule while rows are waiting", () => {
    expect(retryStatusLine({ ...base, pending: 4783 })).toEqual({
      tone: "info",
      text: "Resending to people who missed it: 4,783 to go. 100 an hour, weekdays 9am to 5pm.",
    })
    expect(retryStatusLine({ ...base, pending: 3583, sent: 1200 })?.text).toBe(
      "Resending to people who missed it: 1,200 done, 3,583 to go. 100 an hour, weekdays 9am to 5pm.",
    )
  })

  it("counts a batch still waiting on Resend's answer as still to go", () => {
    expect(retryStatusLine({ ...base, pending: 3483, sending: 100, sent: 1200 })?.text).toContain("3,583 to go")
  })

  it("says why it stopped, in the words the pause was recorded with", () => {
    const pause_reason = "11 of 200 resent emails bounced (5.5%, the limit is 4%)."
    expect(retryStatusLine({ ...base, sent: 200, bounced: 11, paused: 4583, pause_reason })).toEqual({
      tone: "danger",
      text: "Resending paused. 11 of 200 resent emails bounced (5.5%, the limit is 4%). 4,583 people still to go.",
    })
  })

  it("still says it is paused when no reason was recorded", () => {
    expect(retryStatusLine({ ...base, paused: 3 })?.text).toBe("Resending paused. 3 people still to go.")
  })

  it("reports the end result once the queue is empty", () => {
    expect(retryStatusLine({ ...base, sent: 4700, failed: 3, skipped: 80 })).toEqual({
      tone: "muted",
      text: "Resent to 4,700 people who missed it. 3 could not be sent.",
    })
  })
})
