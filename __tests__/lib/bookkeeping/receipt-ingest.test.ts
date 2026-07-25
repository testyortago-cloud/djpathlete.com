import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Track C, Task C3 — the receipt-ingest recipe extracted out of
 * app/api/admin/bookkeeping/receipts/upload/route.ts. Mock shape mirrors
 * __tests__/app/api/admin/bookkeeping/receipts-upload.test.ts (incl. its
 * vi.hoisted jobSet trick) so the same seams are pinned on both sides of
 * the extraction.
 */

vi.mock("@/lib/db/bookkeeping", () => ({ createDocument: vi.fn().mockResolvedValue({ id: "d1" }) }))
vi.mock("@/lib/bookkeeping/documents", () => ({ storeStatementFile: vi.fn(), safeStatementName: (n: string) => n }))
vi.mock("@/lib/db/ai-generation-log", () => ({ createGenerationLog: vi.fn().mockResolvedValue({ id: "log1" }) }))
const { jobSet, rtdbSet } = vi.hoisted(() => ({ jobSet: vi.fn(), rtdbSet: vi.fn() }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ id: "job1", set: jobSet }) }) }),
  getAdminRtdb: () => ({ ref: () => ({ set: rtdbSet }) }),
}))
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "ts" } }))

import { createDocument } from "@/lib/db/bookkeeping"
import { createGenerationLog } from "@/lib/db/ai-generation-log"
import { storeStatementFile } from "@/lib/bookkeeping/documents"
import { ingestReceiptDocument } from "@/lib/bookkeeping/receipt-ingest"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ADMIN = "11111111-2222-4333-8444-555555555555"
/** sha256("PDFDATA") — pinned literally so a swapped digest algorithm or a
 *  hash of the wrong input can never ship green (findDocumentBySha256 is the
 *  only duplicate-upload defence and the poller has no second hash). */
const SHA_PDFDATA = "1ad9615552126eb88b27e3f5c20c9932a9efafe7a58a790bf8d0d92d0fdc5661"
const baseArgs = {
  bookId: BOOK,
  buffer: Buffer.from("PDFDATA"),
  mimeType: "application/pdf",
  originalFilename: "receipt.pdf",
  uploadedBy: ADMIN as string | null,
  accounts: [{ name: "Equipment", account_type: "expense" as const }],
  bookName: "Darren — DJP Athlete",
  bookKind: "business" as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(createDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "d1" })
  ;(createGenerationLog as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "log1" })
})

describe("ingestReceiptDocument", () => {
  it("stores under bookkeeping/receipts/<bookId>/<uuid>/<safeName> and creates a receipt document", async () => {
    const out = await ingestReceiptDocument(baseArgs)
    expect(out).toMatchObject({ documentId: "d1", jobId: "job1", logId: "log1", sha256: SHA_PDFDATA })
    const [path, buf, mime] = (storeStatementFile as ReturnType<typeof vi.fn>).mock.calls[0]
    const m = (path as string).match(new RegExp(`^bookkeeping/receipts/${BOOK}/([0-9a-f-]{36})/receipt\\.pdf$`))
    expect(m).not.toBeNull()
    // The middle segment must be a FRESH uuid, not the bookId reused — otherwise
    // every receipt in a book shares one prefix and same-named files overwrite.
    expect(m![1]).not.toBe(BOOK)
    expect((buf as Buffer).equals(Buffer.from("PDFDATA"))).toBe(true)
    expect(mime).toBe("application/pdf")
    expect((createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      book_id: BOOK,
      kind: "receipt",
      external_ref: null,
      uploaded_by: ADMIN,
      row_count: 1,
      file_size_bytes: 7,
      mime_type: "application/pdf",
      sha256: SHA_PDFDATA,
      // IRS 7-year retention. The daily retention cron hard-deletes the bucket
      // object AND the row once retain_until < today, so a wrong year here is
      // silent, irreversible loss — pin it.
      retain_until: `${new Date().getUTCFullYear() + 7}-12-31`,
    })
    // Job payload is the exact upload-route recipe
    const jobPayload = jobSet.mock.calls[0][0]
    expect(jobPayload.type).toBe("receipt_scan")
    expect(jobPayload.status).toBe("pending")
    expect(jobPayload.input).toMatchObject({
      mimeType: "application/pdf",
      documentId: "d1",
      logId: "log1",
      accounts: [{ name: "Equipment", account_type: "expense" }],
      bookName: "Darren — DJP Athlete",
      bookKind: "business",
      requestedBy: ADMIN,
    })
  })

  it("passes externalRef through to the document row (poller idempotency key)", async () => {
    await ingestReceiptDocument({ ...baseArgs, externalRef: "gmail:m1:0" })
    expect((createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      external_ref: "gmail:m1:0",
    })
  })

  it("null uploadedBy (cron) → uploaded_by null, requested_by omitted, system requestedBy on the job", async () => {
    await ingestReceiptDocument({ ...baseArgs, uploadedBy: null, externalRef: "gmail:m1:0" })
    expect((createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ uploaded_by: null })
    expect((createGenerationLog as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toHaveProperty("requested_by")
    expect(jobSet.mock.calls[0][0].input.requestedBy).toBe("bookkeepingGmailReceiptsCron")
    expect(jobSet.mock.calls[0][0].userId).toBe("bookkeepingGmailReceiptsCron")
  })

  it("survives an RTDB seed failure (best-effort, same as the route's try/catch)", async () => {
    rtdbSet.mockRejectedValueOnce(new Error("rtdb down"))
    await expect(ingestReceiptDocument(baseArgs)).resolves.toMatchObject({ jobId: "job1" })
  })
})
