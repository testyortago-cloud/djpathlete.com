import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { enqueueNewsletterRetries, isRefusal, recordNewsletterSends } from "../lib/newsletter-retry-queue.js"

function fakeSupabase(answers: Array<{ data: { id: string }[] | null; error: { message: string } | null }>) {
  const upsert = vi.fn()
  let call = 0
  const client = {
    from: vi.fn(() => ({
      upsert: (rows: unknown, opts: unknown) => {
        upsert(rows, opts)
        return { select: async () => answers[call++] }
      },
    })),
  }
  return { client: client as unknown as SupabaseClient, upsert }
}

describe("enqueueNewsletterRetries", () => {
  it("writes one row per address under the given business and newsletter, never overwriting an existing row", async () => {
    const { client, upsert } = fakeSupabase([{ data: [{ id: "r1" }, { id: "r2" }], error: null }])
    const queued = await enqueueNewsletterRetries(client, "biz-1", "nl-1", ["a@gmail.com", "b@gmail.com"])

    expect(queued).toBe(2)
    expect(upsert).toHaveBeenCalledWith(
      [
        { business_id: "biz-1", newsletter_id: "nl-1", email: "a@gmail.com" },
        { business_id: "biz-1", newsletter_id: "nl-1", email: "b@gmail.com" },
      ],
      // ignoreDuplicates: a row already sent must not be reset to pending.
      { onConflict: "newsletter_id,email", ignoreDuplicates: true },
    )
  })

  it("writes in chunks of 500 and counts only the rows that were new", async () => {
    const emails = Array.from({ length: 1001 }, (_, i) => `p${i}@gmail.com`)
    const { client, upsert } = fakeSupabase([
      { data: Array.from({ length: 500 }, (_, i) => ({ id: `a${i}` })), error: null },
      { data: Array.from({ length: 499 }, (_, i) => ({ id: `b${i}` })), error: null },
      { data: [{ id: "c0" }], error: null },
    ])
    expect(await enqueueNewsletterRetries(client, "biz-1", "nl-1", emails)).toBe(1000)
    expect(upsert.mock.calls.map((c) => (c[0] as unknown[]).length)).toEqual([500, 500, 1])
  })

  it("files rows PAUSED, with the reason, when asked", async () => {
    const { client, upsert } = fakeSupabase([{ data: [{ id: "r1" }], error: null }])
    await enqueueNewsletterRetries(client, "biz-1", "nl-1", ["a@gmail.com"], { paused: "check Resend" })
    expect(upsert.mock.calls[0][0]).toEqual([
      {
        business_id: "biz-1",
        newsletter_id: "nl-1",
        email: "a@gmail.com",
        status: "paused",
        last_error: "check Resend",
      },
    ])
  })

  it("keeps going past a chunk that failed, and does not throw", async () => {
    const { client } = fakeSupabase([
      { data: null, error: { message: 'relation "newsletter_deliveries" does not exist' } },
      { data: [{ id: "x" }], error: null },
    ])
    const emails = Array.from({ length: 501 }, (_, i) => `p${i}@gmail.com`)
    await expect(enqueueNewsletterRetries(client, "biz-1", "nl-1", emails)).resolves.toBe(1)
  })
})

describe("isRefusal", () => {
  it.each([
    [400, true],
    [403, true],
    [422, true],
    [429, true],
    [409, false], // an idempotency conflict: it may have been sent
    [500, false],
    [503, false],
    [null, false],
    [undefined, false],
  ])("statusCode %s -> %s", (statusCode, expected) => {
    expect(isRefusal({ statusCode })).toBe(expected)
  })
})

describe("recordNewsletterSends", () => {
  const at = new Date("2026-10-19T13:00:00Z")

  it("writes one 'send' row per person, each with ITS OWN Resend id, never overwriting an existing row", async () => {
    const { client, upsert } = fakeSupabase([{ data: [{ id: "r1" }, { id: "r2" }], error: null }])
    const n = await recordNewsletterSends(
      client,
      "biz-1",
      "nl-1",
      [
        { email: "a@gmail.com", providerMessageId: "re_a" },
        { email: "b@gmail.com", providerMessageId: null },
      ],
      at,
    )
    expect(n).toBe(2)
    expect(upsert).toHaveBeenCalledWith(
      [
        {
          business_id: "biz-1",
          newsletter_id: "nl-1",
          email: "a@gmail.com",
          origin: "send",
          status: "sent",
          provider_message_id: "re_a",
          sent_at: "2026-10-19T13:00:00.000Z",
        },
        {
          business_id: "biz-1",
          newsletter_id: "nl-1",
          email: "b@gmail.com",
          origin: "send",
          status: "sent",
          provider_message_id: null,
          sent_at: "2026-10-19T13:00:00.000Z",
        },
      ],
      { onConflict: "newsletter_id,email", ignoreDuplicates: true },
    )
  })

  it("returns 0 and does not throw when the write fails", async () => {
    const { client } = fakeSupabase([{ data: null, error: { message: "column origin does not exist" } }])
    await expect(
      recordNewsletterSends(client, "biz-1", "nl-1", [{ email: "a@gmail.com", providerMessageId: "re_a" }], at),
    ).resolves.toBe(0)
  })

  it("writes nothing for an empty batch", async () => {
    const { client, upsert } = fakeSupabase([])
    expect(await recordNewsletterSends(client, "biz-1", "nl-1", [], at)).toBe(0)
    expect(upsert).not.toHaveBeenCalled()
  })
})
