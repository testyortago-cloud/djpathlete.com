import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/system-settings", () => ({
  isCronSkipped: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: vi.fn(), logCronEnd: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listBooks: vi.fn(), listAccounts: vi.fn(), listExternalRefsWithPrefix: vi.fn(),
}))
vi.mock("@/lib/gmail/client", () => {
  class GmailNotConnectedError extends Error {
    constructor() { super("Gmail is not connected"); this.name = "GmailNotConnectedError" }
  }
  return {
    GmailNotConnectedError,
    getAccessTokenForConnection: vi.fn(),
    listLabels: vi.fn(),
    listMessages: vi.fn(),
    getMessage: vi.fn(),
    getAttachment: vi.fn(),
  }
})
vi.mock("@/lib/bookkeeping/receipt-ingest", () => ({ ingestReceiptDocument: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { isCronSkipped, getSetting, setSetting } from "@/lib/db/system-settings"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { listBooks, listAccounts, listExternalRefsWithPrefix } from "@/lib/db/bookkeeping"
import {
  GmailNotConnectedError, getAccessTokenForConnection, listLabels, listMessages, getMessage, getAttachment,
} from "@/lib/gmail/client"
import { ingestReceiptDocument } from "@/lib/bookkeeping/receipt-ingest"
import { recordAudit } from "@/lib/audit/record"
import {
  POST, MAX_MESSAGES_PER_RUN, MAX_MESSAGE_ATTEMPTS, MAX_LIST_PAGES, SETTLED_IDS_KEY,
} from "@/app/api/admin/internal/bookkeeping-gmail-receipts/route"
import {
  GMAIL_UNREADABLE_IDS_KEY, GMAIL_SCANNABLE_MIMES_KEY, GMAIL_MESSAGE_ATTEMPTS_KEY,
} from "@/lib/bookkeeping/email-receipts"
import { SCANNABLE_MIMES, MAX_ATTACHMENT_BYTES } from "@/lib/bookkeeping/receipt-attachments"

const TOKEN = "test-cron-token"
const AUTH = `Bearer ${TOKEN}`
const BOOK = "b0000000-0000-4000-8000-000000000001"

const books = [
  { id: "b0000000-0000-4000-8000-000000000003", name: "Household & Personal", book_kind: "household", is_primary: false, owner_label: "Shared", sort_order: 2, archived_at: null },
  { id: BOOK, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, owner_label: "Darren", sort_order: 0, archived_at: null },
]

// format=full payload: an inline text part (no attachmentId), an
// application/pdf the scanner cannot decode (must be counted, never ingested,
// and must NOT take the jpeg's external_ref key), the real jpeg receipt, and a
// calendar invite the mime filter must drop entirely. partIds are Gmail's real
// shape — they are the external_ref key, so 'receipt.jpg' is always
// 'gmail:<id>:2' no matter what the mime allow-list does.
// collectReceiptAttachments is REAL in this suite (separate pure module).
const fullMessage = (id: string) => ({
  id,
  threadId: `t-${id}`,
  payload: {
    mimeType: "multipart/mixed",
    parts: [
      { partId: "0", mimeType: "text/plain", body: { size: 20, data: "aGk" } },
      { partId: "1", mimeType: "application/pdf", filename: "invoice.pdf", body: { size: 4096, attachmentId: `att-${id}-pdf` } },
      { partId: "2", mimeType: "image/jpeg", filename: "receipt.jpg", body: { size: 4096, attachmentId: `att-${id}-jpg` } },
      { partId: "3", mimeType: "text/calendar", filename: "invite.ics", body: { size: 512, attachmentId: `att-${id}-ics` } },
    ],
  },
})

/** One image the scanner CAN read but that is over the size cap — dropped by
 *  collectReceiptAttachments and invisible to a mime-only unsupported count. */
const oversizedImageMessage = (id: string) => ({
  id,
  threadId: `t-${id}`,
  payload: {
    mimeType: "multipart/mixed",
    parts: [
      { partId: "0", mimeType: "text/plain", body: { size: 20, data: "aGk" } },
      {
        partId: "1", mimeType: "image/jpeg", filename: "huge.jpg",
        body: { size: MAX_ATTACHMENT_BYTES + 1, attachmentId: `att-${id}-big` },
      },
    ],
  },
})

/** Body-only HTML receipt (Uber/Amazon shape) — yields nothing (Decision C-7). */
const bodyOnlyMessage = (id: string) => ({
  id,
  threadId: `t-${id}`,
  payload: {
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/plain", body: { size: 20, data: "aGk" } },
      { mimeType: "text/html", body: { size: 900, data: "aGk" } },
    ],
  },
})

/** Two scannable attachments — exercises per-attachment isolation. */
const twoImageMessage = (id: string) => ({
  id,
  threadId: `t-${id}`,
  payload: {
    mimeType: "multipart/mixed",
    parts: [
      { partId: "0", mimeType: "image/jpeg", filename: "front.jpg", body: { size: 2048, attachmentId: `att-${id}-0` } },
      { partId: "1", mimeType: "image/png", filename: "back.png", body: { size: 2048, attachmentId: `att-${id}-1` } },
    ],
  },
})

function makeRequest(authHeader = AUTH): Request {
  return new Request("http://localhost/api/admin/internal/bookkeeping-gmail-receipts", {
    method: "POST",
    headers: { authorization: authHeader },
  })
}

/** Live system_settings stand-in so multi-run tests see the durable
 *  settled-message marker the way production would. */
let settings: Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = TOKEN
  settings = { bookkeeping_gmail_receipt_label: "DJP Receipts" }
  ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: false })
  ;(getSetting as ReturnType<typeof vi.fn>).mockImplementation(async (key: string, fallback: unknown) =>
    key in settings ? settings[key] : fallback,
  )
  ;(setSetting as ReturnType<typeof vi.fn>).mockImplementation(async (key: string, value: unknown) => {
    settings[key] = value
    return { key, value }
  })
  ;(logCronStart as ReturnType<typeof vi.fn>).mockResolvedValue("run-1")
  ;(logCronEnd as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(listBooks as ReturnType<typeof vi.fn>).mockResolvedValue(books)
  ;(listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "a0000000-0000-4000-8000-000000000001", book_id: BOOK, name: "Equipment", account_type: "expense" },
  ])
  ;(getAccessTokenForConnection as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: "tok", emailAddress: "darren@darrenjpaul.com" })
  ;(listLabels as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "INBOX", name: "INBOX" },
    { id: "L1", name: "DJP Receipts" },
  ])
  ;(listMessages as ReturnType<typeof vi.fn>).mockResolvedValue({ messages: [{ id: "m1", threadId: "t1" }] })
  ;(getMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tok: string, id: string) => fullMessage(id))
  ;(getAttachment as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("JPEGDATA"))
  ;(listExternalRefsWithPrefix as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(ingestReceiptDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ documentId: "d1", jobId: "j1", logId: "l1", sha256: "x" })
})

describe("POST /api/admin/internal/bookkeeping-gmail-receipts", () => {
  it("401 with a missing bearer token", async () => {
    expect((await POST(makeRequest("") as never)).status).toBe(401)
    expect(isCronSkipped).not.toHaveBeenCalled()
  })

  it("401 with a wrong bearer token", async () => {
    expect((await POST(makeRequest("Bearer wrong") as never)).status).toBe(401)
  })

  it("200 {skipped} with no logCronStart when the flag is off", async () => {
    ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: true, reason: "disabled" })
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.skipped).toBe("disabled")
    // typed alias so a dashboard never has to read the dual-typed `skipped`
    expect(json.skipped_reason).toBe("disabled")
    expect(logCronStart).not.toHaveBeenCalled()
  })

  it("Gmail not connected → SUCCESSFUL degraded run, no listing, no cron failure", async () => {
    ;(getAccessTokenForConnection as ReturnType<typeof vi.fn>).mockRejectedValue(new GmailNotConnectedError())
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, fetch_status: "degraded", fetch_detail: "gmail_not_connected" })
    expect(listLabels).not.toHaveBeenCalled()
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ fetch_status: "degraded" }),
    )
  })

  it("configured label missing from the mailbox → degraded success naming the label", async () => {
    ;(listLabels as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "INBOX", name: "INBOX" }])
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true, fetch_status: "degraded", fetch_detail: "label_not_found", label: "DJP Receipts",
    })
    expect(listMessages).not.toHaveBeenCalled()
  })

  it("a plain token-refresh failure is a degraded success, not a 500 that pages the watchdog", async () => {
    // getAccessTokenForConnection writes platform_connections.status='error' on
    // ANY refresh throw. Failing the run on top of that turns one transient
    // Google blip into a cron_runs failure + an automation-health page, for a
    // condition that self-heals on the next hourly refresh.
    ;(getAccessTokenForConnection as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Token refresh failed: HTTP 503"),
    )
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true, fetch_status: "degraded", fetch_detail: "gmail_auth_failed",
      message: "Token refresh failed: HTTP 503",
    })
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ fetch_detail: "gmail_auth_failed" }),
    )
    expect(listLabels).not.toHaveBeenCalled()
  })

  it("happy path: jpeg ingested as gmail:<id>:<partId>, pdf reported unsupported, ics filtered, audit recorded", async () => {
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true, fetch_status: "ok", processed: 1, ingested: 1, failed: 0,
      unsupported_attachments: 1, oversized_attachments: 0, needs_manual_upload: 0,
      poisoned: 0, more_pending: false,
    })
    expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "bookkeepingGmailReceiptsCron")
    expect((listMessages as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ labelIds: ["L1"] })
    expect(getAttachment).toHaveBeenCalledWith("tok", "m1", "att-m1-jpg")
    expect(getAttachment).not.toHaveBeenCalledWith("tok", "m1", "att-m1-pdf")
    expect(ingestReceiptDocument).toHaveBeenCalledTimes(1)
    expect((ingestReceiptDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      bookId: BOOK, externalRef: "gmail:m1:2", uploadedBy: null,
      mimeType: "image/jpeg", originalFilename: "receipt.jpg",
      bookName: "Darren — DJP Athlete", bookKind: "business",
      accounts: [{ name: "Equipment", account_type: "expense" }],
    })
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.gmail_receipt_ingested", category: "commerce", outcome: "success",
      actor: expect.objectContaining({ role: "system" }),
    }))
  })

  it("follows nextPageToken across listMessages pages", async () => {
    ;(listMessages as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "p2" })
      .mockResolvedValueOnce({ messages: [{ id: "m2", threadId: "t2" }] })
    const res = await POST(makeRequest() as never)
    const json = await res.json()
    expect(json.processed).toBe(2)
    expect(json.listed).toBe(2)
    expect((listMessages as ReturnType<typeof vi.fn>).mock.calls[1][1]).toMatchObject({ pageToken: "p2" })
  })

  it("a settled message is skipped without any Gmail fetch or DB probe, no audit", async () => {
    settings[SETTLED_IDS_KEY] = ["m1"]
    const res = await POST(makeRequest() as never)
    expect(await res.json()).toMatchObject({ ok: true, skipped: 1, processed: 0, ingested: 0 })
    expect(getMessage).not.toHaveBeenCalled()
    expect(listExternalRefsWithPrefix).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("caps at MAX_MESSAGES_PER_RUN new messages and reports more_pending", async () => {
    const many = Array.from({ length: MAX_MESSAGES_PER_RUN + 1 }, (_, i) => ({ id: `m${i}`, threadId: `t${i}` }))
    ;(listMessages as ReturnType<typeof vi.fn>).mockResolvedValue({ messages: many })
    const res = await POST(makeRequest() as never)
    const json = await res.json()
    expect(json.processed).toBe(MAX_MESSAGES_PER_RUN)
    expect(json.more_pending).toBe(true)
    expect(getMessage).toHaveBeenCalledTimes(MAX_MESSAGES_PER_RUN)
  })

  // ── Review finding 1 (Critical): nothing-usable messages must not starve ──
  it("body-only messages settle durably so an older attachment message is not starved forever", async () => {
    // 26 body-only HTML receipts (newest-first, Gmail's list order) sitting in
    // front of ONE older email that actually carries the receipt image.
    const bodyOnlyIds = Array.from({ length: MAX_MESSAGES_PER_RUN + 1 }, (_, i) => `b${i}`)
    const ids = [...bodyOnlyIds, "withImage"]
    ;(listMessages as ReturnType<typeof vi.fn>).mockResolvedValue({ messages: ids.map((id) => ({ id, threadId: `t-${id}` })) })
    ;(getMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tok: string, id: string) =>
      id === "withImage" ? fullMessage(id) : bodyOnlyMessage(id),
    )

    const first = await (await POST(makeRequest() as never)).json()
    expect(first.processed).toBe(MAX_MESSAGES_PER_RUN)
    expect(first.attachmentless).toBe(MAX_MESSAGES_PER_RUN)
    expect(first.ingested).toBe(0)
    // The whole first batch is now durably settled — it must never be fetched again.
    expect(settings[SETTLED_IDS_KEY]).toEqual(bodyOnlyIds.slice(0, MAX_MESSAGES_PER_RUN))

    ;(getMessage as ReturnType<typeof vi.fn>).mockClear()
    ;(ingestReceiptDocument as ReturnType<typeof vi.fn>).mockClear()

    const second = await (await POST(makeRequest() as never)).json()
    expect(second.skipped).toBe(MAX_MESSAGES_PER_RUN)
    expect(second.ingested).toBe(1)
    expect(second.more_pending).toBe(false)
    expect((ingestReceiptDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      externalRef: "gmail:withImage:2",
    })
    // The settled set never re-fetches what it already answered for.
    expect((getMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])).toEqual(["b25", "withImage"])
  })

  // ── Review finding: a message we could not read must never just vanish ──
  it("a pdf-only email is recorded as NEEDS MANUAL UPLOAD, not counted as attachmentless", async () => {
    ;(getMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "m1", threadId: "t1",
      payload: { mimeType: "multipart/mixed", parts: [
        { partId: "0", mimeType: "application/pdf", filename: "invoice.pdf", body: { size: 4096, attachmentId: "att-m1-pdf" } },
      ] },
    })
    const json = await (await POST(makeRequest() as never)).json()
    expect(json).toMatchObject({
      ingested: 0, unsupported_attachments: 1, needs_manual_upload: 1, unreadable_backlog: 1,
      // "attachmentless" means body-only. This email DID carry a receipt; the
      // old count made a dropped receipt indistinguishable from a newsletter.
      attachmentless: 0,
    })
    expect(ingestReceiptDocument).not.toHaveBeenCalled()
    // Still settled (starvation protection) but durably remembered, so the
    // review surface can tell the coach to upload it by photo.
    expect(settings[SETTLED_IDS_KEY]).toEqual(["m1"])
    expect(settings[GMAIL_UNREADABLE_IDS_KEY]).toEqual(["m1"])
  })

  it("an OVERSIZED but readable image is accounted for instead of disappearing", async () => {
    // The size filter drops it from the ingest list and the mime-only
    // unsupported count cannot see it, so before `oversized` existed this run
    // reported a plain body-only email and settled the message for good.
    ;(getMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_t: string, id: string) =>
      oversizedImageMessage(id),
    )
    const json = await (await POST(makeRequest() as never)).json()
    expect(json).toMatchObject({
      ingested: 0, oversized_attachments: 1, unsupported_attachments: 0,
      needs_manual_upload: 1, attachmentless: 0,
    })
    expect(settings[GMAIL_UNREADABLE_IDS_KEY]).toEqual(["m1"])
  })

  it("widening the readable-mime list re-opens every message settled only because it was unreadable", async () => {
    ;(getMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "m1", threadId: "t1",
      payload: { mimeType: "multipart/mixed", parts: [
        { partId: "0", mimeType: "application/pdf", filename: "invoice.pdf", body: { size: 4096, attachmentId: "att-m1-pdf" } },
      ] },
    })
    await POST(makeRequest() as never)
    expect(settings[SETTLED_IDS_KEY]).toEqual(["m1"])
    expect(settings[GMAIL_SCANNABLE_MIMES_KEY]).toBe([...SCANNABLE_MIMES].join(","))

    // Simulate a future release that taught the vision path to read PDFs: the
    // fingerprint no longer matches what we settled under.
    settings[GMAIL_SCANNABLE_MIMES_KEY] = "image/jpeg"
    const second = await (await POST(makeRequest() as never)).json()
    expect(second.reconsidered).toBe(1)
    // Re-fetched, not skipped — it is no longer in the settled set on entry.
    expect((getMessage as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2)
    expect(second.processed).toBe(1)
  })

  // ── Review finding: getMessage must sit INSIDE the per-message isolation ──
  it("a message whose getMessage fails neither 500s the run nor settles, and its siblings still ingest", async () => {
    ;(listMessages as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [{ id: "bad", threadId: "t1" }, { id: "good", threadId: "t2" }],
    })
    ;(getMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_t: string, id: string) => {
      if (id === "bad") throw new Error("Gmail getMessage(full) failed: HTTP 404")
      return fullMessage(id)
    })
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ processed: 2, ingested: 1, failed: 1 })
    expect(json.failures[0]).toContain("gmail:bad getMessage")
    expect((ingestReceiptDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      externalRef: "gmail:good:2",
    })
    expect(settings[SETTLED_IDS_KEY]).toEqual(["good"])
    expect(settings[GMAIL_MESSAGE_ATTEMPTS_KEY]).toEqual({ bad: 1 })
  })

  // ── Review finding: a permanently-failing message needs a poison-pill escape ──
  it("force-settles a message after MAX_MESSAGE_ATTEMPTS failed runs instead of burning a slot forever", async () => {
    ;(getMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Gmail getMessage(full) failed: HTTP 400"))
    for (let run = 1; run < MAX_MESSAGE_ATTEMPTS; run++) {
      const json = await (await POST(makeRequest() as never)).json()
      expect(json).toMatchObject({ processed: 1, failed: 1, poisoned: 0 })
      expect(settings[GMAIL_MESSAGE_ATTEMPTS_KEY]).toEqual({ m1: run })
      expect(settings[SETTLED_IDS_KEY] ?? []).not.toContain("m1")
    }
    const last = await (await POST(makeRequest() as never)).json()
    expect(last).toMatchObject({ poisoned: 1, failed: 1 })
    expect(settings[SETTLED_IDS_KEY]).toEqual(["m1"])
    // Recorded as needing a human, and the retry counter is released.
    expect(settings[GMAIL_UNREADABLE_IDS_KEY]).toEqual(["m1"])
    expect(settings[GMAIL_MESSAGE_ATTEMPTS_KEY]).toEqual({})

    // Next run costs nothing at all.
    ;(getMessage as ReturnType<typeof vi.fn>).mockClear()
    const after = await (await POST(makeRequest() as never)).json()
    expect(after).toMatchObject({ processed: 0, skipped: 1 })
    expect(getMessage).not.toHaveBeenCalled()
  })

  it("a transient failure that later succeeds clears the retry counter without poisoning", async () => {
    ;(getMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("HTTP 503"))
    await POST(makeRequest() as never)
    expect(settings[GMAIL_MESSAGE_ATTEMPTS_KEY]).toEqual({ m1: 1 })
    const second = await (await POST(makeRequest() as never)).json()
    expect(second).toMatchObject({ ingested: 1, failed: 0, poisoned: 0 })
    expect(settings[GMAIL_MESSAGE_ATTEMPTS_KEY]).toEqual({})
  })

  // ── Review finding: the label listing loop was unbounded ──
  it("stops listing once it has more unsettled ids than one run can consume", async () => {
    ;(listMessages as ReturnType<typeof vi.fn>).mockImplementation(async (_t: string, opts: { pageToken?: string }) => ({
      messages: Array.from({ length: MAX_MESSAGES_PER_RUN + 1 }, (_, i) => ({
        id: `${opts.pageToken ?? "p1"}-${i}`, threadId: "t",
      })),
      nextPageToken: "next",
    }))
    const json = await (await POST(makeRequest() as never)).json()
    // One page was enough to fill the budget — it must not walk the rest of
    // the mailbox building an id array it can never consume.
    expect((listMessages as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
    expect(json.listed).toBe(MAX_MESSAGES_PER_RUN + 1)
    expect(json.more_pending).toBe(true)
  })

  it("hard-stops the listing loop at MAX_LIST_PAGES even when every page is already settled", async () => {
    // Pathological shape: a huge label where everything is settled, so the
    // "enough unsettled ids" brake never trips.
    settings[SETTLED_IDS_KEY] = ["s0"]
    ;(listMessages as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [{ id: "s0", threadId: "t" }], nextPageToken: "always-more",
    })
    const json = await (await POST(makeRequest() as never)).json()
    expect((listMessages as ReturnType<typeof vi.fn>).mock.calls.length).toBe(MAX_LIST_PAGES)
    expect(json.more_pending).toBe(true)
  })

  // ── Review finding 2 (Important): per-attachment isolation + exact retry ──
  it("one failing attachment neither fails the run nor orphans its siblings; the next run retries only the missing index", async () => {
    ;(getMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tok: string, id: string) => twoImageMessage(id))
    ;(getAttachment as ReturnType<typeof vi.fn>).mockImplementation(async (_tok: string, _id: string, attId: string) => {
      if (attId.endsWith("-1")) throw new Error("Gmail getAttachment failed: HTTP 503")
      return Buffer.from("JPEGDATA")
    })

    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    const first = await res.json()
    expect(first).toMatchObject({ ingested: 1, failed: 1 })
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ failed: 1 }),
    )
    // NOT settled — the message still has unfinished work.
    expect(settings[SETTLED_IDS_KEY] ?? []).not.toContain("m1")

    ;(ingestReceiptDocument as ReturnType<typeof vi.fn>).mockClear()
    ;(getAttachment as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("PNGDATA"))
    // Attachment 0 already landed last run.
    ;(listExternalRefsWithPrefix as ReturnType<typeof vi.fn>).mockResolvedValue(["gmail:m1:0"])

    const second = await (await POST(makeRequest() as never)).json()
    expect(second).toMatchObject({ ingested: 1, failed: 0 })
    expect(listExternalRefsWithPrefix).toHaveBeenCalledWith("gmail:m1:")
    expect(ingestReceiptDocument).toHaveBeenCalledTimes(1)
    expect((ingestReceiptDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      externalRef: "gmail:m1:1", mimeType: "image/png", originalFilename: "back.png",
    })
    expect(settings[SETTLED_IDS_KEY]).toContain("m1")
  })

  it("a non-connection Gmail failure (listLabels rejects) → 500 + logCronEnd failed", async () => {
    ;(listLabels as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Gmail listLabels failed: HTTP 500"))
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(500)
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "failed",
      expect.objectContaining({ message: expect.stringContaining("listLabels") }),
    )
  })
})
