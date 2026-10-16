// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest"
import { fetchNewsletterEmails } from "@/lib/newsletter/resend-log"
import { stampsFromLastEvent } from "@/lib/newsletter/retry-backfill"

const SENT_AT = new Date("2026-10-09T13:00:21Z")
const email = (id: string, subject: string, created_at: string, last_event = "delivered") => ({
  id,
  to: [`${id}@gmail.com`],
  subject,
  created_at,
  last_event,
})

function stubPages(pages: { data: ReturnType<typeof email>[]; has_more: boolean }[]) {
  const calls: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url)
      const page = pages[calls.length - 1]
      return { ok: true, status: 200, json: async () => page, text: async () => "" }
    }),
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe("fetchNewsletterEmails", () => {
  it("returns only this newsletter's emails from the day of the send, across pages, newest first as Resend lists them", async () => {
    const calls = stubPages([
      {
        data: [
          email("later", "Awareness before Action", "2026-10-16 17:00:01.1+00"),
          email("other", "Daily Brief — Fri, Oct 9", "2026-10-09 14:00:00+00"),
          email("a", "Awareness before Action", "2026-10-09 13:01:22.157+00", "opened"),
        ],
        has_more: true,
      },
      {
        data: [
          email("b", "Awareness before Action", "2026-10-09 13:00:30+00", "bounced"),
          email("before", "Awareness before Action", "2026-10-08 09:00:00+00"),
        ],
        has_more: true,
      },
    ])
    const got = await fetchNewsletterEmails("re_key", "Awareness before Action", SENT_AT, { pauseMs: 0 })

    // "later" is a retry send a week on: outside the day of the blast.
    expect(got.map((e) => e.id)).toEqual(["a", "b"])
    expect(got[0]).toEqual({
      id: "a",
      to: ["a@gmail.com"],
      last_event: "opened",
      created_at: "2026-10-09 13:01:22.157+00",
    })
    // Stops once the log is older than the send, instead of walking the whole account.
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain("after=a")
  })

  it("reaches past the day of the send when asked, for the retry's later sends", async () => {
    stubPages([
      {
        data: [
          email("later", "Awareness before Action", "2026-10-16 17:00:01.1+00"),
          email("a", "Awareness before Action", "2026-10-09 13:01:22.157+00"),
          email("before", "Awareness before Action", "2026-10-08 09:00:00+00"),
        ],
        has_more: false,
      },
    ])
    const got = await fetchNewsletterEmails("re_key", "Awareness before Action", SENT_AT, {
      pauseMs: 0,
      until: new Date("2026-10-17T00:00:00Z"),
    })
    expect(got.map((e) => e.id)).toEqual(["later", "a"])
  })

  it("refuses when Resend's log starts after the send: it cannot see who got it", async () => {
    stubPages([{ data: [email("x", "Awareness before Action", "2026-10-10 09:00:00+00")], has_more: false }])
    await expect(fetchNewsletterEmails("re_key", "Awareness before Action", SENT_AT, { pauseMs: 0 })).rejects.toThrow(
      /log starts .* after this send/,
    )
  })
})

describe("stampsFromLastEvent", () => {
  const at = "2026-10-09 13:01:22.157+00"
  const iso = "2026-10-09T13:01:22.157Z"

  it.each([
    ["clicked", { delivered_at: iso, opened_at: iso, clicked_at: iso }],
    ["opened", { delivered_at: iso, opened_at: iso }],
    ["delivered", { delivered_at: iso }],
    ["complained", { delivered_at: iso, complained_at: iso }],
    ["bounced", { bounced_at: iso }],
    ["suppressed", {}],
    ["failed", {}],
    ["sent", {}],
    ["delivery_delayed", {}],
  ])("%s", (lastEvent, expected) => {
    expect(stampsFromLastEvent(lastEvent, at)).toEqual(expected)
  })
})
