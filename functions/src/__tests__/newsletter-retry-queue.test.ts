import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { enqueueNewsletterRetries } from "../lib/newsletter-retry-queue.js"

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

  it("keeps going past a chunk that failed, and does not throw", async () => {
    const { client } = fakeSupabase([
      { data: null, error: { message: 'relation "newsletter_deliveries" does not exist' } },
      { data: [{ id: "x" }], error: null },
    ])
    const emails = Array.from({ length: 501 }, (_, i) => `p${i}@gmail.com`)
    await expect(enqueueNewsletterRetries(client, "biz-1", "nl-1", emails)).resolves.toBe(1)
  })
})
