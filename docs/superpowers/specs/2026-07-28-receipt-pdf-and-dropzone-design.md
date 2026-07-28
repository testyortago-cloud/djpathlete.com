# PDF receipts + a real dropzone — design

**Date:** 2026-07-28
**Status:** Approved, ready for planning
**Scope:** `/admin/books` receipt upload path, `receipt_scan` vision job, Gmail receipt poller

## Problem

Two independent defects surfaced from one user report ("won't let me drag and drop, and then won't
accept it when I go in and choose the pdf invoice"):

1. **Drag-and-drop has never worked.** The dashed "Choose photos" area in `ReceiptUploadDialog` is a
   plain `<button>` with no drag handlers. Dropping any file — even a JPG — falls through to the
   browser default. It *looks* like a dropzone, which is the whole problem.

2. **PDF is rejected at three layers, for one real reason.** The `accept` attribute greys PDFs out
   in the OS picker; the upload route 400s them; and underneath both, `functions/src/receipt-scan.ts`
   pipes every buffer through `sharp()`, which cannot decode PDF. The mime gate exists precisely so
   a PDF cannot reach sharp and fail with "unsupported image format" — a blank review row with no
   explanation. That reasoning is recorded at `lib/bookkeeping/receipt-attachments.ts:28-49`, which
   also names the unblock: *"a PDF branch in the vision path first (Anthropic document block, or
   rasterize page 1 before sharp)"*.

This design takes that named unblock.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | PDFs go to Claude as an **Anthropic `document` content block**, not rasterized | Handles text-layer AND scanned PDFs in one path; no PDF/native dependency added to `functions/`. Rejected: pdf-parse text-only (silently blank on scanned PDFs — the exact failure the mime gate was built to prevent); hybrid text/document switch (two prompt shapes and a threshold that is wrong at the margins, for a cost saving we do not yet need). |
| D2 | Whole PDF is sent, capped at **10 pages** | Invoice totals often sit on the last page, so page-1-only misreads them. The cap doubles as the cost ceiling (Claude bills a PDF as text + one page image per page) and as the "this is a statement, not a receipt" guard. |
| D3 | Page cap lives in a **shared module used by both ingest paths** | The upload route and the Gmail poller are both Next.js-side. One module means the cap cannot drift between the button and the mailbox. |
| D4 | PDF review rows: **icon in the grid, `<iframe>` when expanded** | A PDF in an `<img>` is a broken-image box. The iframe uses the existing signed URL and the browser's native viewer, so the document sits next to the editable fields. Rejected: pdf.js thumbnails (pulls `pdfjs-dist` into the admin bundle for a rare path). |
| D5 | Gmail poller widens `SCANNABLE_MIMES` to include PDF **in this change** | The poller was built for this: its mime-fingerprint check at `bookkeeping-gmail-receipts/route.ts:161-174` already names `application/pdf` and auto-reopens messages settled only as unreadable. `cron_bookkeeping_gmail_receipts_enabled` is **false** in production and the cron has never run, so there is no backlog and `reconsidered` will be 0. Widening now costs one line and avoids leaving a known-stale comment in the tree. |
| D6 | No migration, no feature flag, no new job field | `ReceiptScanJobInput.mimeType` already exists and is already populated by `ingestReceiptDocument`. Per project convention, flags are reserved for money/mass-email risk; this is neither. |

## Architecture

### Data flow (PDF)

```
ReceiptUploadDialog (drop or pick .pdf)
  → POST /api/admin/bookkeeping/receipts/upload  (multipart)
      · resolveReceiptMime  → "application/pdf"
      · countPdfPages(buffer) ≤ MAX_RECEIPT_PDF_PAGES  else 400
      → ingestReceiptDocument({ mimeType: "application/pdf", … })   [UNCHANGED]
          · storeStatementFile → GCS object carries contentType: application/pdf
          · bookkeeping_documents row (kind:"receipt")
          · Firestore ai_jobs { type:"receipt_scan", input.mimeType }
  → functions/src/receipt-scan.ts handleReceiptScan
      · isPdf = input.mimeType === "application/pdf"
      · PDF  → callAgent(…, { documents: [{ media_type:"application/pdf", data: base64 }] })
      · image → resizeReceiptForVision → callAgent(…, { images: [...] })   [UNCHANGED]
  → same ReceiptScanResult schema → RTDB → batch review → /receipts/commit  [ALL UNCHANGED]
```

The seam is deliberately narrow: everything from `ingestReceiptDocument` outward and everything from
`ReceiptScanResult` onward is untouched. Only mime resolution (before) and the vision call (inside)
change.

### New module — `lib/bookkeeping/receipt-pdf.ts`

Pure except `countPdfPages`. Imported by the upload route and the Gmail poller; never by `functions/`.

```ts
export const MAX_RECEIPT_PDF_PAGES = 10
export function isPdfMime(mime: string): boolean
export function isPdfUpload(mime: string, filename: string): boolean   // mime OR .pdf extension
export async function countPdfPages(buffer: Buffer): Promise<number>   // throws on unreadable PDF
export function pdfRejectionReason(pages: number): string | null       // null = accept
```

`countPdfPages` uses `require("pdf-parse/lib/pdf-parse.js")` — the inner-lib import that avoids
pdf-parse's default test-file read, matching `statement-import/route.ts:124` and
`upload/extract-text/route.ts:38`. `types/pdf-parse.d.ts` already declares `numpages`.

### Changed: `app/api/admin/bookkeeping/receipts/upload/route.ts`

- `resolveImageMime` → `resolveReceiptMime`, returning `application/pdf` for PDFs. **Its current
  unknown-type fallback is `return "image/jpeg"`** — a PDF stored under that mime would break both
  sharp and the preview iframe far from the cause, so this rename is load-bearing, not cosmetic.
- Accept gate admits `application/pdf` by mime or `.pdf` extension.
- When the resolved mime is PDF: `countPdfPages` → `pdfRejectionReason` → 400 before any storage
  write or job creation. No orphan bytes, no wasted scan.

### Changed: `functions/src/ai/anthropic.ts`

`buildUserContent(text, cachedUserPrefix, images, documents?)` gains a `documents` arm emitting
`{ type: "document", source: { type: "base64", media_type, data } }` blocks in the same leading
position as image blocks. `callAgent` options gain `documents?: Array<{ media_type: string; data: string }>`.

**Both call sites must pass it** — the primary (~line 211) and the schema-retry fallback (~line 254).
Omitting the fallback is the subtle bug: a retry would send the prompt with no document attached and
return a confident, empty-handed answer instead of an error. This gets its own test.

`functions/` uses raw `tool_use` (not the AI SDK), so the `structuredOutputMode: "jsonTool"`
constraint that binds lib-side `callAgent` does not apply here.

### Changed: `functions/src/receipt-scan.ts`

Branch on `input.mimeType`. PDFs skip `resizeReceiptForVision` entirely; images keep today's exact
path. The user message becomes source-aware — the PDF wording tells Claude the document may be a
multi-page invoice with a single grand total, and to flag low confidence with a warning if it looks
like a multi-transaction statement rather than one receipt. `RECEIPT_SCAN_PROMPT` and
`receiptScanSchema` are unchanged, so `coalesceReceiptResult`, `documentBackfillPayload`, RTDB, and
the commit path all stay as-is.

### Changed: Gmail poller

`SCANNABLE_MIMES` gains `application/pdf`. The 20-line comment above it currently explains *why PDF
is excluded* and becomes false — it is rewritten to describe the PDF branch and the page cap. The
poller applies `countPdfPages`/`pdfRejectionReason` before `ingestReceiptDocument`; an over-cap or
unreadable PDF counts into `unsupported_attachments` + `needs_manual_upload` and marks the message
unreadable, exactly as every PDF does today. A malformed PDF must never 500 the run and strand its
sibling attachments.

### Changed: UI surfaces

**Dropzone** (`ReceiptUploadDialog.tsx`) — the dashed area becomes a `div` with `onDragEnter` /
`onDragOver` (preventDefault + highlight state), `onDragLeave`, `onDrop`, retaining `onClick` plus
`role="button"`, `tabIndex={0}` and Enter/Space handling. It also renders in the has-files state so a
second batch can be dropped onto the grid.

Dropped files bypass the `accept` attribute, so **type filtering moves into `addFiles`**: accept
jpeg/png/webp/pdf by mime-or-extension, drop the rest, and toast rejects *separately* from the
existing over-`MAX_BATCH_SIZE` drop message so the two reasons stay distinguishable. `accept` gains
`application/pdf`; helper copy becomes "JPG, PNG, WEBP, or PDF. Max 10 MB each, up to 15 files."

**PDF rows** — `ReceiptBatchRow` gains `isPdf: boolean`, set from the `File` at pick time and from
`document.mime_type` in `rowFromEmailDocument`. `ReceiptBatchReview` renders a `FileText` tile +
filename instead of `<img src={thumbUrl}>`. `ReceiptRowEditor` renders `<iframe src={previewUrl}>`
instead of `<img>`, with an "Open in new tab" fallback link. The lazy signed-URL fetch is unchanged.

This reaches the email-receipts surface for free via the shared `ReceiptRowEditor`.
`EmailReceiptsClient.readableFormatLabel()` derives its "upload these manually" copy from
`SCANNABLE_MIMES` and should update itself — **confirm, do not assume**.

## Error handling

| Case | Behavior |
|---|---|
| PDF > 10 pages | 400 before storage: "This PDF has N pages — that looks like a statement. Use **Import statement** instead." |
| Corrupt / encrypted PDF | `countPdfPages` throws → 400 "Couldn't read that PDF. Try re-exporting it, or upload a photo of the receipt." |
| PDF > 10 MB / empty | Existing size gates, unchanged |
| PDF that is really a short statement (≤10 pages) | Scans as one row; prompt instructs low confidence + a warning, which the existing warnings UI surfaces. Reviewer decides. |
| Anthropic rejects the document | Cannot occur under the 10-page / 10 MB caps (limits are 100 pages / 32 MB); if it did, the job's existing catch marks `scan_failed` and the row shows the error |
| Drag of a folder / URL / non-file | `dataTransfer.files` is empty → no-op |
| Mixed drop (3 JPG + 1 DOCX) | The 3 are added; a toast names the rejected file and why |
| Drop over `MAX_BATCH_SIZE` | Existing over-cap toast, kept distinct from the type-reject toast |
| Browser refuses to frame the PDF | "Open in new tab" link on the signed URL |
| Poller hits a malformed PDF attachment | Counted as unsupported, message marked unreadable, run continues — never a 500 |

**Known pre-existing limitation (not addressed):** the signed preview URL has a 300 s TTL, so a very
long review session can outlive it. This is equally true of today's `<img>` previews.

## Testing

Unit tests must **discriminate** — several must fail if the behavior regresses, not merely run.

- **`receipt-pdf.ts`**: `pdfRejectionReason` at the 10/11 boundary (not 1 vs 100 — the boundary is
  the behavior); `isPdfUpload` for a `.pdf` with blank/wrong browser mime; `countPdfPages` on real
  1-page and multi-page PDF fixtures; corrupt buffer rejects.
- **Upload route**: PDF → 202; 11-page PDF → 400 carrying the Import-statement nudge, asserting
  `ingestReceiptDocument` was **not** called; and — critically — that the `mimeType` *passed to*
  `ingestReceiptDocument` is `application/pdf`, since that one field drives both the sharp-vs-document
  branch and the preview.
- **`anthropic.ts`**: `buildUserContent` document block shape + ordering; and a `callAgent` test that
  forces the schema-retry path and asserts the **fallback** request body still carries the document
  block.
- **`receipt-scan.ts`**: a PDF input does **not** call sharp and does send a document block; an image
  input still calls `resizeReceiptForVision`. Asserting only "callAgent was called" would pass either
  way and is not acceptable here.
- **`receipt-attachments.ts`**: `isReceiptMime("application/pdf")` is true; a PDF part no longer
  counts into `unsupportedMime`.
- **`receipt-batch.ts`**: `newReceiptRow` carries `isPdf`; `addFiles` accepts PDF, rejects `.docx`,
  and reports type-rejects separately from over-cap drops.
- **Components (RTL)**: `fireEvent.drop` with `dataTransfer.files` adds rows; dropping a `.docx` adds
  nothing and toasts; `dragOver` sets the highlight; an `isPdf` row renders no `<img>`; an `isPdf` row
  with a `previewUrl` renders an `<iframe>` with that `src` while a non-PDF row still renders `<img>`.

Full suite (`npm run test:run`) plus a production build. Note the known-flaky Stripe webhook wall-clock
timeouts in the baseline — stash-isolate before attributing any red to this change.

## Out of scope

HEIC support; pdf.js thumbnails; multi-receipt-per-PDF splitting; raising the 10 MB cap; the
signed-URL TTL.
