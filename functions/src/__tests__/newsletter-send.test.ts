import { describe, it, expect, vi, beforeEach } from "vitest"
import { isUndeliverableAddress } from "../lib/newsletter-recipients.js"

const mocks = vi.hoisted(() => ({
  batchSend: vi.fn(),
  jobUpdate: vi.fn(),
  rows: [] as { email: string }[],
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
          data: () => ({ status: "pending", input: { newsletterId: "n1", subject: "S", html: "<p>h</p>" } }),
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
  })

  // 2026-09-11: one @example.com row 422'd its whole batch of 100.
  it("never puts an undeliverable address into a batch, and reports it as skipped", async () => {
    mocks.rows = [{ email: "real1@gmail.com" }, { email: "jane@example.com" }, { email: "real2@gmail.com" }]
    await handleNewsletterSend("job-1")

    const recipients = mocks.batchSend.mock.calls.flatMap((c) => c[0].map((m: { to: string }) => m.to))
    expect(recipients).toEqual(["real1@gmail.com", "real2@gmail.com"])
    const done = mocks.jobUpdate.mock.calls.find((c) => c[0].status === "completed")?.[0]
    expect(done.result).toEqual({ sent: 2, failed: 0, total: 2, skipped: 1 })
  })
})
