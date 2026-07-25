import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: vi.fn(), getSetting: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: vi.fn(), logCronEnd: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listBooks: vi.fn(), listAccounts: vi.fn(), hasDocumentsForExternalRefPrefix: vi.fn(),
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

import { isCronSkipped, getSetting } from "@/lib/db/system-settings"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { listBooks, listAccounts, hasDocumentsForExternalRefPrefix } from "@/lib/db/bookkeeping"
import {
  GmailNotConnectedError, getAccessTokenForConnection, listLabels, listMessages, getMessage, getAttachment,
} from "@/lib/gmail/client"
import { ingestReceiptDocument } from "@/lib/bookkeeping/receipt-ingest"
import { recordAudit } from "@/lib/audit/record"
import { POST, MAX_MESSAGES_PER_RUN } from "@/app/api/admin/internal/bookkeeping-gmail-receipts/route"

const TOKEN = "test-cron-token"
const AUTH = `Bearer ${TOKEN}`
const BOOK = "b0000000-0000-4000-8000-000000000001"

const books = [
  { id: "b0000000-0000-4000-8000-000000000003", name: "Household & Personal", book_kind: "household", is_primary: false, owner_label: "Shared", sort_order: 2, archived_at: null },
  { id: BOOK, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, owner_label: "Darren", sort_order: 0, archived_at: null },
]

// format=full payload: inline text part (no attachmentId), a real PDF
// attachment, and a calendar invite the mime filter must drop.
// collectReceiptAttachments is REAL in this suite (separate pure module).
const fullMessage = (id: string) => ({
  id,
  threadId: `t-${id}`,
  payload: {
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "text/plain", body: { size: 20, data: "aGk" } },
      { mimeType: "application/pdf", filename: "invoice.pdf", body: { size: 4096, attachmentId: `att-${id}-pdf` } },
      { mimeType: "text/calendar", filename: "invite.ics", body: { size: 512, attachmentId: `att-${id}-ics` } },
    ],
  },
})

function makeRequest(authHeader = AUTH): Request {
  return new Request("http://localhost/api/admin/internal/bookkeeping-gmail-receipts", {
    method: "POST",
    headers: { authorization: authHeader },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = TOKEN
  ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: false })
  ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue("DJP Receipts")
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
  ;(getAttachment as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("PDFDATA"))
  ;(hasDocumentsForExternalRefPrefix as ReturnType<typeof vi.fn>).mockResolvedValue(false)
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
    expect((await res.json()).skipped).toBe("disabled")
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

  it("happy path: label-only listing, PDF ingested as gmail:<id>:0, ics filtered, audit recorded", async () => {
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, fetch_status: "ok", processed: 1, ingested: 1, more_pending: false })
    expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "bookkeepingGmailReceiptsCron")
    expect((listMessages as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ labelIds: ["L1"] })
    expect(getAttachment).toHaveBeenCalledWith("tok", "m1", "att-m1-pdf")
    expect(ingestReceiptDocument).toHaveBeenCalledTimes(1)
    expect((ingestReceiptDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      bookId: BOOK, externalRef: "gmail:m1:0", uploadedBy: null,
      mimeType: "application/pdf", originalFilename: "invoice.pdf",
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
    expect((await res.json()).processed).toBe(2)
    expect((listMessages as ReturnType<typeof vi.fn>).mock.calls[1][1]).toMatchObject({ pageToken: "p2" })
  })

  it("already-ingested message (external_ref prefix hit) → skipped without a full fetch, no audit", async () => {
    ;(hasDocumentsForExternalRefPrefix as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    const res = await POST(makeRequest() as never)
    expect(await res.json()).toMatchObject({ ok: true, skipped: 1, ingested: 0 })
    expect(hasDocumentsForExternalRefPrefix).toHaveBeenCalledWith("gmail:m1:")
    expect(getMessage).not.toHaveBeenCalled()
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
