import { describe, it, expect, vi, beforeEach } from "vitest"
import { isUndeliverableAddress } from "../lib/newsletter-recipients.js"

const mocks = vi.hoisted(() => ({
  batchSend: vi.fn(),
  jobUpdate: vi.fn(),
  enqueue: vi.fn(),
  rows: [] as { email: string }[],
  input: {} as Record<string, unknown>,
}))

vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { batch: { send: mocks.batchSend } }
  }),
}))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({ status: "pending", input: mocks.input }),
        }),
        update: mocks.jobUpdate,
      }),
    }),
  }),
  FieldValue: { serverTimestamp: () => "TS" },
}))
vi.mock("../lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "is", "order", "update"]) chain[m] = () => chain
  chain.range = async () => ({ data: mocks.rows, error: null })
  chain.eq = async () => ({ error: null })
  return { getSupabase: () => ({ from: () => chain }) }
})

vi.mock("../lib/newsletter-retry-queue.js", () => ({ enqueueNewsletterRetries: mocks.enqueue }))

import { handleNewsletterSend } from "../newsletter-send.js"

describe("isUndeliverableAddress", () => {
  it.each(["jane@example.com", "a@EXAMPLE.org", "x@sub.example.net", "q@foo.test", "z@host.invalid", "no-at-sign", "a@b"])(
    "rejects %s",
    (e) => expect(isUndeliverableAddress(e)).toBe(true),
  )
  // The permissive side: a false positive silently drops a real subscriber.
  it.each(["coach@gmail.com", "a@test.com", "b@contest.io", "c@examples.com", "d@mail.darrenjpaul.com"])(
    "keeps %s",
    (e) => expect(isUndeliverableAddress(e)).toBe(false),
  )
})

describe("handleNewsletterSend", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.batchSend.mockResolvedValue({ data: { data: [{ id: "1" }, { id: "2" }] }, error: null })
    mocks.enqueue.mockImplementation(async (_s: unknown, _b: string, _n: string, emails: string[]) => emails.length)
    mocks.input = { newsletterId: "n1", subject: "S", html: "<p>h</p>", businessId: "biz-1" }
  })

  // 2026-09-11: one @example.com row 422'd its whole batch of 100.
  it("never puts an undeliverable address into a batch, and reports it as skipped", async () => {
    mocks.rows = [{ email: "real1@gmail.com" }, { email: "jane@example.com" }, { email: "real2@gmail.com" }]
    await handleNewsletterSend("job-1")

    const recipients = mocks.batchSend.mock.calls.flatMap((c) => c[0].map((m: { to: string }) => m.to))
    expect(recipients).toEqual(["real1@gmail.com", "real2@gmail.com"])
    const done = mocks.jobUpdate.mock.calls.find((c) => c[0].status === "completed")?.[0]
    expect(done.result).toEqual({ sent: 2, failed: 0, total: 2, skipped: 1, queued: 0 })
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  // 2026-10-09: batch 12 onward answered 429 and 4,783 people were simply lost.
  it("queues every recipient of a refused batch for the working-hours retry, under the job's business", async () => {
    mocks.rows = [{ email: "a@gmail.com" }, { email: "b@gmail.com" }]
    mocks.batchSend.mockResolvedValue({
      data: null,
      error: { name: "daily_quota_exceeded", message: "You have reached your daily email sending quota.", statusCode: 429 },
    })
    await handleNewsletterSend("job-2")

    expect(mocks.enqueue).toHaveBeenCalledTimes(1)
    expect(mocks.enqueue.mock.calls[0].slice(1)).toEqual(["biz-1", "n1", ["a@gmail.com", "b@gmail.com"]])
    const done = mocks.jobUpdate.mock.calls.find((c) => c[0].status === "completed")?.[0]
    expect(done.result).toEqual({ sent: 0, failed: 2, total: 2, skipped: 0, queued: 2 })
  })

  it("queues a batch that threw, too", async () => {
    mocks.rows = [{ email: "a@gmail.com" }]
    mocks.batchSend.mockRejectedValue(new Error("socket hang up"))
    await handleNewsletterSend("job-3")
    expect(mocks.enqueue.mock.calls[0][3]).toEqual(["a@gmail.com"])
  })

  // A job written before the queue shipped carries no tenant. Guessing one
  // would file the rows under the wrong business.
  it("does not queue anything for a job with no businessId", async () => {
    mocks.rows = [{ email: "a@gmail.com" }]
    mocks.input = { newsletterId: "n1", subject: "S", html: "<p>h</p>" }
    mocks.batchSend.mockResolvedValue({ data: null, error: { name: "x", message: "y", statusCode: 500 } })
    await handleNewsletterSend("job-4")
    expect(mocks.enqueue).not.toHaveBeenCalled()
    const done = mocks.jobUpdate.mock.calls.find((c) => c[0].status === "completed")?.[0]
    expect(done.result.queued).toBe(0)
  })
})
