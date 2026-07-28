# PDF Receipts + Real Dropzone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the `/admin/books` receipt uploader accept PDF invoices (read by Claude as an Anthropic document block) and make its dashed drop area actually accept dropped files.

**Architecture:** PDFs bypass `sharp` entirely — `functions/src/receipt-scan.ts` branches on `input.mimeType` and sends a `document` content block instead of a resized JPEG. A shared `lib/bookkeeping/receipt-pdf.ts` enforces a 10-page cap on both Next.js-side ingest paths (upload button, Gmail poller). Nothing downstream of `ReceiptScanResult` changes.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Vitest + Testing Library, Firebase Functions (`functions/`, separate `rootDir`), Anthropic SDK (raw `tool_use`), `pdf-parse` (already a root dependency), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-28-receipt-pdf-and-dropzone-design.md`

## Global Constraints

- **No migration, no feature flag, no new job field.** `ReceiptScanJobInput.mimeType` already exists and is already populated.
- **`functions/` cannot import from `lib/` or `types/`** (separate `rootDir: "src"`). Never add such an import — it resolves locally and breaks the Vercel build.
- **`MAX_RECEIPT_PDF_PAGES = 10`**, `MAX_SIZE = 10 * 1024 * 1024` (unchanged).
- Accepted receipt uploads: `image/jpeg`, `image/png`, `image/webp`, `application/pdf` — by mime **or** file extension (browsers send blank/wrong mime often enough to matter).
- Helper copy in the dialog reads exactly: `JPG, PNG, WEBP, or PDF. Max 10 MB each, up to {MAX_BATCH_SIZE} files.`
- `pdf-parse` is imported **only** as `require("pdf-parse/lib/pdf-parse.js")` — the inner lib, avoiding its default test-file read. Matches `statement-import/route.ts:124`.
- Tailwind semantic classes only (`text-muted-foreground`, `bg-muted/20`, …). No hardcoded hex.
- **Tests must discriminate.** A test that would pass with the feature reverted is a failed test. Where a task calls this out explicitly, honour it.
- Run tests with `npx vitest run <path>`. Never chain a build behind `npm run test:run &&` — the suite has known unrelated reds and exits non-zero.

---

### Task 1: Shared PDF page-cap module

**Files:**
- Create: `lib/bookkeeping/receipt-pdf.ts`
- Test: `__tests__/lib/bookkeeping/receipt-pdf.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MAX_RECEIPT_PDF_PAGES: number`, `isPdfMime(mime: string): boolean`, `isPdfUpload(mime: string, filename: string): boolean`, `countPdfPages(buffer: Buffer): Promise<number>`, `pdfRejectionReason(pages: number): string | null`, `pdfRejectionReasonForBuffer(buffer: Buffer): Promise<string | null>`. Tasks 2 and 5 both import from here.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/bookkeeping/receipt-pdf.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  MAX_RECEIPT_PDF_PAGES,
  countPdfPages,
  isPdfMime,
  isPdfUpload,
  pdfRejectionReason,
  pdfRejectionReasonForBuffer,
} from "@/lib/bookkeeping/receipt-pdf"

/** A syntactically complete PDF with a correct xref table, so pdf-parse
 *  reports a real page count instead of relying on pdf.js error recovery. */
function makeTestPdf(pageCount: number): Buffer {
  const kids = Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(" ")
  const objects = [
    `<</Type/Catalog/Pages 2 0 R>>`,
    `<</Type/Pages/Kids[${kids}]/Count ${pageCount}>>`,
    ...Array.from({ length: pageCount }, () => `<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>`),
  ]
  let body = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"))
    body += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(body, "latin1")
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${off.toString().padStart(10, "0")} 00000 n \n`
  xref += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body + xref, "latin1")
}

describe("MAX_RECEIPT_PDF_PAGES", () => {
  it("is 10 per the spec", () => {
    expect(MAX_RECEIPT_PDF_PAGES).toBe(10)
  })
})

describe("isPdfMime", () => {
  it("matches application/pdf case-insensitively", () => {
    expect(isPdfMime("application/pdf")).toBe(true)
    expect(isPdfMime("APPLICATION/PDF")).toBe(true)
  })
  it("rejects image mimes", () => {
    expect(isPdfMime("image/jpeg")).toBe(false)
    expect(isPdfMime("")).toBe(false)
  })
})

describe("isPdfUpload", () => {
  it("accepts a .pdf name even when the browser sends a blank or wrong mime", () => {
    expect(isPdfUpload("", "invoice.pdf")).toBe(true)
    expect(isPdfUpload("application/octet-stream", "INVOICE.PDF")).toBe(true)
  })
  it("accepts application/pdf even when the name has no extension", () => {
    expect(isPdfUpload("application/pdf", "attachment")).toBe(true)
  })
  it("rejects a jpg", () => {
    expect(isPdfUpload("image/jpeg", "r.jpg")).toBe(false)
  })
})

describe("pdfRejectionReason", () => {
  // The boundary IS the behavior — 10 accepted, 11 rejected. Testing 1 vs 100
  // would still pass if the cap drifted to 50.
  it("accepts exactly MAX_RECEIPT_PDF_PAGES", () => {
    expect(pdfRejectionReason(10)).toBeNull()
  })
  it("rejects one page over the cap and names Import statement", () => {
    const reason = pdfRejectionReason(11)
    expect(reason).toContain("11 pages")
    expect(reason).toMatch(/import statement/i)
  })
  it("rejects a zero-page PDF", () => {
    expect(pdfRejectionReason(0)).toMatch(/couldn't read/i)
  })
})

describe("countPdfPages", () => {
  it("counts a single-page PDF", async () => {
    await expect(countPdfPages(makeTestPdf(1))).resolves.toBe(1)
  })
  it("counts a multi-page PDF", async () => {
    await expect(countPdfPages(makeTestPdf(3))).resolves.toBe(3)
  })
  it("rejects bytes that are not a PDF", async () => {
    await expect(countPdfPages(Buffer.from("this is not a pdf"))).rejects.toThrow()
  })
})

describe("pdfRejectionReasonForBuffer", () => {
  it("returns null for an in-cap PDF", async () => {
    await expect(pdfRejectionReasonForBuffer(makeTestPdf(2))).resolves.toBeNull()
  })
  it("returns the over-cap reason for an 11-page PDF", async () => {
    await expect(pdfRejectionReasonForBuffer(makeTestPdf(11))).resolves.toMatch(/import statement/i)
  })
  it("turns an unreadable PDF into a reason instead of throwing", async () => {
    await expect(pdfRejectionReasonForBuffer(Buffer.from("nope"))).resolves.toMatch(/couldn't read/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/receipt-pdf.test.ts`
Expected: FAIL — cannot resolve `@/lib/bookkeeping/receipt-pdf`.

- [ ] **Step 3: Write the implementation**

Create `lib/bookkeeping/receipt-pdf.ts`:

```ts
// Shared PDF gate for the two Next.js-side receipt ingest paths (the upload
// button and the Gmail poller). Both import from here so the page cap can
// never drift between them. functions/ never counts pages — it receives an
// already-vetted buffer and hands it to Claude as a document block.
//
// pdf-parse is imported as its inner lib to avoid the package's default
// test-file read at require time (same as statement-import/route.ts:124).

/** Claude reads PDFs natively, but a receipt is one transaction. Ten pages is
 *  generous for an invoice and doubles as the cost ceiling (a PDF bills as
 *  text + one page image per page) and the "this is a statement" guard. */
export const MAX_RECEIPT_PDF_PAGES = 10

export function isPdfMime(mime: string): boolean {
  return mime.trim().toLowerCase() === "application/pdf"
}

/** Browsers send a blank or generic mime for PDFs often enough that the
 *  extension has to count too — same mime-or-extension shape the image gate
 *  in the upload route already uses. */
export function isPdfUpload(mime: string, filename: string): boolean {
  return isPdfMime(mime) || /\.pdf$/i.test(filename.trim())
}

export async function countPdfPages(buffer: Buffer): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse/lib/pdf-parse.js")
  const parsed = await pdfParse(buffer)
  return parsed.numpages
}

/** null = accept. Any string is a user-facing 400 message. */
export function pdfRejectionReason(pages: number): string | null {
  if (!Number.isFinite(pages) || pages < 1) {
    return "Couldn't read that PDF. Try re-exporting it, or upload a photo of the receipt."
  }
  if (pages > MAX_RECEIPT_PDF_PAGES) {
    return `This PDF has ${pages} pages — that looks like a statement, not a receipt. Use Import statement instead.`
  }
  return null
}

/** The form both ingest paths actually call: never throws, so a malformed PDF
 *  becomes a reportable reason rather than a 500 that strands sibling work. */
export async function pdfRejectionReasonForBuffer(buffer: Buffer): Promise<string | null> {
  let pages: number
  try {
    pages = await countPdfPages(buffer)
  } catch {
    return "Couldn't read that PDF. Try re-exporting it, or upload a photo of the receipt."
  }
  return pdfRejectionReason(pages)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/bookkeeping/receipt-pdf.test.ts`
Expected: PASS (all cases).

If `countPdfPages` rejects `makeTestPdf(1)`, the fixture's xref offsets are wrong — print `parsed` and fix the helper. Do **not** weaken the test to `resolves.toBeGreaterThan(0)`; the exact count is the behavior.

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/receipt-pdf.ts __tests__/lib/bookkeeping/receipt-pdf.test.ts
git commit -m "feat(bookkeeping): shared PDF page-cap gate for receipt ingest"
```

---

### Task 2: Upload route accepts PDF

**Files:**
- Modify: `app/api/admin/bookkeeping/receipts/upload/route.ts:22-31` (constants + mime resolver), `:62-69` (accept gate), `:78-88` (page check before ingest)
- Test: `__tests__/app/api/admin/bookkeeping/receipts-upload.test.ts` (existing — add cases)

**Interfaces:**
- Consumes: `isPdfUpload`, `isPdfMime`, `pdfRejectionReasonForBuffer` from Task 1.
- Produces: a 202 whose Firestore job payload carries `input.mimeType === "application/pdf"` for PDF uploads. Task 4 branches on exactly that value.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/app/api/admin/bookkeeping/receipts-upload.test.ts`. Add these imports/mocks at the top of the existing file (alongside the current mocks):

```ts
vi.mock("@/lib/bookkeeping/receipt-pdf", async (orig) => {
  const actual = await orig<typeof import("@/lib/bookkeeping/receipt-pdf")>()
  return { ...actual, pdfRejectionReasonForBuffer: vi.fn().mockResolvedValue(null) }
})
```

and `import { pdfRejectionReasonForBuffer } from "@/lib/bookkeeping/receipt-pdf"` with the other imports.

Then add this describe block at the end of the file:

```ts
describe("PDF receipts", () => {
  it("accepts a PDF and hands application/pdf to the scan job", async () => {
    const res = await POST(form("%PDF-1.4 fake", "application/pdf", "invoice.pdf"))
    expect(res.status).toBe(202)
    // The mime on the JOB is what drives the sharp-vs-document branch in
    // functions/src/receipt-scan.ts AND the preview iframe's content type.
    // Asserting only the 202 would pass even if the route stored it as a JPEG.
    expect(jobSet.mock.calls[0][0].input.mimeType).toBe("application/pdf")
    expect((createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      mime_type: "application/pdf",
      kind: "receipt",
    })
  })

  it("accepts a .pdf whose browser mime is blank", async () => {
    const res = await POST(form("%PDF-1.4 fake", "", "invoice.pdf"))
    expect(res.status).toBe(202)
    expect(jobSet.mock.calls[0][0].input.mimeType).toBe("application/pdf")
  })

  it("rejects an over-cap PDF before storing anything", async () => {
    ;(pdfRejectionReasonForBuffer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "This PDF has 40 pages — that looks like a statement, not a receipt. Use Import statement instead.",
    )
    const res = await POST(form("%PDF-1.4 fake", "application/pdf", "statement.pdf"))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/import statement/i)
    // No orphan bytes, no wasted scan.
    expect(createDocument).not.toHaveBeenCalled()
    expect(jobSet).not.toHaveBeenCalled()
  })

  it("still rejects a non-receipt type", async () => {
    expect((await POST(form("x", "application/zip", "r.zip"))).status).toBe(400)
  })

  it("never resolves a .pdf to an image mime", async () => {
    await POST(form("%PDF-1.4 fake", "application/octet-stream", "invoice.pdf"))
    expect(jobSet.mock.calls[0][0].input.mimeType).not.toMatch(/^image\//)
  })

  it("does not page-check image uploads", async () => {
    await POST(form())
    expect(pdfRejectionReasonForBuffer).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/receipts-upload.test.ts`
Expected: FAIL — PDF uploads 400 at the `isImage` gate.

- [ ] **Step 3: Implement**

In `app/api/admin/bookkeeping/receipts/upload/route.ts`:

Add the import:

```ts
import { isPdfMime, isPdfUpload, pdfRejectionReasonForBuffer } from "@/lib/bookkeeping/receipt-pdf"
```

Replace the `ALLOWED_TYPES` / `resolveImageMime` block (lines 22-31) with:

```ts
const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"]

/** Resolve the mime we STORE and hand to the scan job.
 *
 *  The old image-only version defaulted every unrecognized file to
 *  "image/jpeg". A PDF stored under that mime breaks twice, far from the
 *  cause: sharp cannot decode it in the vision job, and the review iframe
 *  gets an image content type from GCS and renders nothing. PDF is therefore
 *  resolved FIRST and explicitly. */
function resolveReceiptMime(file: File): string {
  if (isPdfUpload(file.type, file.name)) return "application/pdf"
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) return file.type
  const n = file.name.toLowerCase()
  if (n.endsWith(".png")) return "image/png"
  if (n.endsWith(".webp")) return "image/webp"
  return "image/jpeg"
}
```

Replace the accept gate (lines 62-69) with:

```ts
    const nameLower = file.name.toLowerCase()
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type) || /\.(jpe?g|png|webp)$/i.test(nameLower)
    const isPdf = isPdfUpload(file.type, file.name)
    if (!isImage && !isPdf) {
      return NextResponse.json(
        { error: "Invalid file type. Upload a JPG, PNG, WEBP, or PDF receipt." },
        { status: 400 },
      )
    }
```

Then, after the existing size/empty checks and after `const buffer = Buffer.from(await file.arrayBuffer())` (line 78) — but **before** `findDocumentBySha256` — insert:

```ts
    const mimeType = resolveReceiptMime(file)

    // Page-cap PDFs before anything is written: storeStatementFile runs before
    // the row that references it, so a late rejection would leave orphan bytes
    // the retention cron can never find.
    if (isPdfMime(mimeType)) {
      const reason = await pdfRejectionReasonForBuffer(buffer)
      if (reason) return NextResponse.json({ error: reason }, { status: 400 })
    }
```

Finally delete the later `const mimeType = resolveImageMime(file)` line (was line 88) — `mimeType` is now defined above.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/app/api/admin/bookkeeping/receipts-upload.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/bookkeeping/receipts/upload/route.ts __tests__/app/api/admin/bookkeeping/receipts-upload.test.ts
git commit -m "feat(bookkeeping): accept PDF receipts at the upload route"
```

---

### Task 3: `documents` support in the functions-side Anthropic client

**Files:**
- Modify: `functions/src/ai/anthropic.ts:140-161` (`buildUserContent`), `:168-189` (options type), `:211` and `:254` (both call sites)
- Test: `functions/src/ai/__tests__/call-agent-images.test.ts` (existing — add cases)

**Interfaces:**
- Consumes: nothing.
- Produces: `buildUserContent(userMessage, cachedUserPrefix, images, documents?)` and a `documents?: Array<{ media_type: string; data: string }>` option on `callAgent`. Task 4 passes `documents`.

- [ ] **Step 1: Write the failing tests**

Append to `functions/src/ai/__tests__/call-agent-images.test.ts`:

```ts
describe("buildUserContent with documents", () => {
  it("emits a base64 document block before the text", () => {
    const content = buildUserContent("read this invoice", undefined, undefined, [
      { media_type: "application/pdf", data: "JVBERi0=" },
    ]) as unknown as Array<Record<string, unknown>>
    expect(Array.isArray(content)).toBe(true)
    expect(content[0]).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" },
    })
    expect(content[content.length - 1]).toEqual({ type: "text", text: "read this invoice" })
  })

  it("orders documents, images, cached prefix, then text", () => {
    const content = buildUserContent(
      "q",
      "CACHED",
      [{ media_type: "image/png", data: "IMG" }],
      [{ media_type: "application/pdf", data: "PDF" }],
    ) as unknown as Array<Record<string, unknown>>
    expect(content.map((b) => b.type)).toEqual(["document", "image", "text", "text"])
  })

  it("still returns the bare string when documents is an empty array", () => {
    expect(buildUserContent("hello", undefined, undefined, [])).toBe("hello")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npx vitest run src/ai/__tests__/call-agent-images.test.ts`
Expected: FAIL — `buildUserContent` ignores the 4th argument, so `content[0].type` is `"text"`, not `"document"`.

- [ ] **Step 3: Implement**

In `functions/src/ai/anthropic.ts`, replace `buildUserContent` (lines 140-161) with:

```ts
export function buildUserContent(
  userMessage: string,
  cachedUserPrefix: string | undefined,
  images: Array<{ media_type: string; data: string }> | undefined,
  documents?: Array<{ media_type: string; data: string }>,
): Anthropic.Messages.ContentBlockParam[] | string {
  const hasImages = !!images && images.length > 0
  const hasDocuments = !!documents && documents.length > 0
  if (!hasImages && !hasDocuments && !cachedUserPrefix) return userMessage
  const blocks: Anthropic.Messages.ContentBlockParam[] = []
  if (hasDocuments) {
    for (const doc of documents!) {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: doc.media_type as "application/pdf", data: doc.data },
      })
    }
  }
  if (hasImages) {
    for (const img of images!) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: img.media_type as "image/jpeg", data: img.data },
      })
    }
  }
  if (cachedUserPrefix) {
    blocks.push({ type: "text", text: cachedUserPrefix, cache_control: { type: "ephemeral" } })
  }
  blocks.push({ type: "text", text: userMessage })
  return blocks
}
```

Add to the `callAgentWithModel` options type, right after the `images` field (line 183):

```ts
    /**
     * Optional base64 document blocks (currently application/pdf — receipt
     * invoices). Claude reads a PDF's text layer AND its page images, so this
     * replaces rasterizing before sharp. Sent ahead of images, the cached
     * prefix, and the user message.
     */
    documents?: Array<{ media_type: string; data: string }>
```

Update **both** call sites:

Line 211:
```ts
      const userContent = buildUserContent(userMessage, options?.cachedUserPrefix, options?.images, options?.documents)
```

Line 254:
```ts
        const fallbackUserContent = buildUserContent(fallbackUserText, options?.cachedUserPrefix, options?.images, options?.documents)
```

Also mirror the `documents` field onto the public `callAgent` options type at line ~332 (the exported wrapper's own options object), so callers can pass it through.

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npx vitest run src/ai/__tests__/call-agent-images.test.ts`
Expected: PASS, including the three pre-existing image cases.

- [ ] **Step 5: Verify the fallback path carries the document**

The schema-retry fallback at line 254 is easy to forget and fails silently — the model would answer with no document attached. Confirm by grep, not by eye:

Run: `grep -n "buildUserContent(" functions/src/ai/anthropic.ts`
Expected: three hits — the definition plus **two** call sites, and both call sites end with `options?.documents)`.

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/anthropic.ts functions/src/ai/__tests__/call-agent-images.test.ts
git commit -m "feat(ai): support base64 document blocks in the functions Anthropic client"
```

---

### Task 4: PDF branch in the receipt scan job

**Files:**
- Modify: `functions/src/receipt-scan.ts:47-58` (add pure helpers), `:186-194` (orchestration branch)
- Test: `functions/src/__tests__/receipt-scan.test.ts` (existing — add cases)

**Interfaces:**
- Consumes: `callAgent`'s `documents` option from Task 3; `input.mimeType === "application/pdf"` produced by Task 2.
- Produces: `buildReceiptVisionPayload(buffer: Buffer, mimeType: string): Promise<{ images?: Array<{media_type: string; data: string}>; documents?: Array<{media_type: string; data: string}> }>` and `receiptUserMessage(accountsBlock: string, isPdf: boolean): string`.

- [ ] **Step 1: Write the failing tests**

Append to `functions/src/__tests__/receipt-scan.test.ts` (extend the import on line 2 with the two new names):

```ts
describe("buildReceiptVisionPayload", () => {
  it("sends a PDF as a document block and never touches sharp", async () => {
    // These bytes are not a decodable image. If the implementation lost its
    // mimeType branch and fell through to resizeReceiptForVision, sharp would
    // reject with "unsupported image format" and this test would fail — which
    // is the point: it cannot pass without the branch.
    const pdf = Buffer.from("%PDF-1.4\nnot an image at all\n%%EOF")
    const payload = await buildReceiptVisionPayload(pdf, "application/pdf")
    expect(payload.images).toBeUndefined()
    expect(payload.documents).toEqual([
      { media_type: "application/pdf", data: pdf.toString("base64") },
    ])
  })

  it("still resizes images through sharp", async () => {
    const sharp = (await import("sharp")).default
    const jpeg = await sharp({
      create: { width: 2400, height: 1800, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer()
    const payload = await buildReceiptVisionPayload(jpeg, "image/jpeg")
    expect(payload.documents).toBeUndefined()
    expect(payload.images?.[0].media_type).toBe("image/jpeg")
    // Proof it went through the resizer rather than being passed through raw.
    expect(Buffer.from(payload.images![0].data, "base64").length).toBeLessThan(jpeg.length)
  })
})

describe("receiptUserMessage", () => {
  it("tells the model to find one grand total in a multi-page PDF", () => {
    const msg = receiptUserMessage("## Expense categories\nFuel", true)
    expect(msg).toMatch(/pdf/i)
    expect(msg).toMatch(/grand total/i)
    expect(msg).toContain("## Expense categories\nFuel")
  })
  it("keeps the image wording for photos", () => {
    const msg = receiptUserMessage("## Expense categories\nFuel", false)
    expect(msg).toMatch(/image/i)
    expect(msg).not.toMatch(/grand total/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npx vitest run src/__tests__/receipt-scan.test.ts`
Expected: FAIL — neither function is exported.

- [ ] **Step 3: Implement**

In `functions/src/receipt-scan.ts`, add after `resizeReceiptForVision` (line 58):

```ts
/** Vision payload for one receipt, branched on the stored mime.
 *
 *  PDFs go to Claude as a document block — it reads both the text layer and
 *  the page images, which is why this path exists instead of rasterizing
 *  page 1 before sharp. sharp cannot decode PDF at all (pinned 0.33.5 reports
 *  format.pdf.input all-false), so routing a PDF into resizeReceiptForVision
 *  fails with "unsupported image format" and leaves a blank review row. */
export async function buildReceiptVisionPayload(
  buffer: Buffer,
  mimeType: string,
): Promise<{
  images?: Array<{ media_type: string; data: string }>
  documents?: Array<{ media_type: string; data: string }>
}> {
  if (mimeType.trim().toLowerCase() === "application/pdf") {
    return { documents: [{ media_type: "application/pdf", data: buffer.toString("base64") }] }
  }
  const image = await resizeReceiptForVision(buffer)
  return { images: [image] }
}

/** Source-aware user message. The PDF wording matters: an invoice may run
 *  several pages with line items that each look like an amount, and the row
 *  wants the single grand total. */
export function receiptUserMessage(accountsBlock: string, isPdf: boolean): string {
  const instruction = isPdf
    ? "Read the attached receipt PDF and extract the fields. It may be an invoice spanning several pages — report the single grand total for the whole document, not a line item. If it is actually a multi-transaction statement rather than one receipt, set confidence to \"low\" and say so in warnings."
    : "Read the attached receipt image and extract the fields."
  return `${accountsBlock}\n\n${instruction}`
}
```

Then replace the orchestration block at lines 186-194 with:

```ts
    const payload = await buildReceiptVisionPayload(buffer, input.mimeType ?? "")

    const userMessage = receiptUserMessage(renderAccounts(input.accounts ?? []), !!payload.documents)
    const res = await callAgent<ReceiptScanResult>(
      RECEIPT_SCAN_PROMPT.replace("<name>", input.bookName),
      userMessage,
      receiptScanSchema,
      { model: MODEL_SONNET, ...payload },
    )
```

(The `const image = await resizeReceiptForVision(buffer)` line on 186 goes away — `buildReceiptVisionPayload` owns it now.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npx vitest run src/__tests__/receipt-scan.test.ts`
Expected: PASS, including the three pre-existing helper tests.

- [ ] **Step 5: Typecheck functions**

Run: `cd functions && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add functions/src/receipt-scan.ts functions/src/__tests__/receipt-scan.test.ts
git commit -m "feat(bookkeeping): read PDF receipts via an Anthropic document block"
```

---

### Task 5: Gmail poller ingests PDF attachments

**Files:**
- Modify: `lib/bookkeeping/receipt-attachments.ts:28-50` (comment + `SCANNABLE_MIMES`), `app/api/admin/internal/bookkeeping-gmail-receipts/route.ts:290-310` (page gate before ingest)
- Test: `__tests__/lib/bookkeeping/receipt-attachments.test.ts` (existing — add cases)

**Interfaces:**
- Consumes: `isPdfMime`, `pdfRejectionReasonForBuffer` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/bookkeeping/receipt-attachments.test.ts`:

```ts
describe("PDF attachments are scannable", () => {
  it("accepts application/pdf", () => {
    expect(isReceiptMime("application/pdf")).toBe(true)
  })
  it("no longer counts a PDF part as an unsupported mime", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { partId: "1", mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "a1", size: 1000 } },
      ],
    }
    expect(countUnusableReceiptAttachments(payload as never).unsupportedMime).toBe(0)
  })
  it("collects the PDF part for ingest", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { partId: "1", mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "a1", size: 1000 } },
      ],
    }
    const refs = collectReceiptAttachments(payload as never)
    expect(refs).toHaveLength(1)
    expect(refs[0].mimeType).toBe("application/pdf")
  })
  it("still rejects HEIC, which the vision path cannot read", () => {
    expect(isReceiptMime("image/heic")).toBe(false)
  })
})
```

Ensure `collectReceiptAttachments` and `countUnusableReceiptAttachments` are in the file's import list.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/receipt-attachments.test.ts`
Expected: FAIL — `isReceiptMime("application/pdf")` is false and `unsupportedMime` is 1.

- [ ] **Step 3: Implement**

In `lib/bookkeeping/receipt-attachments.ts`, replace the whole doc comment and constant at lines 28-50 with:

```ts
/** Mimes the receipt vision path can actually decode.
 *
 *  Images are resized by `sharp` (resizeReceiptForVision); PDFs bypass sharp
 *  entirely and go to Claude as a base64 document block
 *  (functions/src/receipt-scan.ts:buildReceiptVisionPayload). PDF was excluded
 *  here until that branch existed, because sharp 0.33.5 cannot decode it —
 *  an ingested PDF would burn its external_ref, queue a receipt_scan job, and
 *  fail with "unsupported image format", leaving a blank review row.
 *
 *  Still excluded: image/heic (sharp's pinned build lists heif with
 *  fileSuffix ['.avif'] only). A HEIC attachment is counted into the poller's
 *  `unsupported_attachments` and recorded as "needs manual upload" rather than
 *  ingested, so "I emailed it and nothing happened" stays observable.
 *
 *  Page-capping is NOT done here — this walk sees only Gmail part metadata,
 *  not bytes. The poller applies pdfRejectionReasonForBuffer after download
 *  (lib/bookkeeping/receipt-pdf.ts), the same gate the upload button uses.
 *
 *  Changing this array changes the poller's mime fingerprint, which re-opens
 *  every message settled only because its attachments were unreadable. That
 *  is intended: adding PDF here is what makes already-labeled PDF receipt
 *  mail get picked up. */
export const SCANNABLE_MIMES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]
```

In `app/api/admin/internal/bookkeeping-gmail-receipts/route.ts`, add the import:

```ts
import { isPdfMime, pdfRejectionReasonForBuffer } from "@/lib/bookkeeping/receipt-pdf"
```

and inside the per-attachment `try` (line 290-303), between the download and the ingest:

```ts
          try {
            const buffer = await getAttachment(accessToken, messageId, att.attachmentId)

            // Same page cap as the upload button. An over-cap or malformed PDF
            // behaves exactly like a pre-PDF-support attachment did: counted,
            // recorded as needing manual upload, never ingested — and never a
            // 500 that would strand this message's sibling attachments.
            if (isPdfMime(att.mimeType)) {
              const reason = await pdfRejectionReasonForBuffer(buffer)
              if (reason) {
                unsupportedAttachments++
                needsManualUpload++
                markUnreadable(messageId)
                continue
              }
            }

            await ingestReceiptDocument({
```

(The rest of the `ingestReceiptDocument({...})` call and its `catch` are unchanged.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/lib/bookkeeping/receipt-attachments.test.ts __tests__/api/admin/internal/bookkeeping-gmail-receipts.test.ts`
Expected: PASS. The poller suite must stay green — if a test asserted PDFs are unsupported, update it to reflect the new behavior rather than reverting the change.

- [ ] **Step 5: Confirm the review-surface copy updated itself**

`EmailReceiptsClient.readableFormatLabel()` derives its "upload these manually" text from `SCANNABLE_MIMES`. Confirm it now names PDF:

Run: `npx vitest run __tests__/components/admin/bookkeeping/EmailReceiptsClient.test.tsx`
Expected: PASS. If a test pins the old "JPG, PNG, WEBP" string, update the expectation — the copy is derived, and the derived value is now correct.

- [ ] **Step 6: Commit**

```bash
git add lib/bookkeeping/receipt-attachments.ts app/api/admin/internal/bookkeeping-gmail-receipts/route.ts __tests__/lib/bookkeeping/receipt-attachments.test.ts
git commit -m "feat(bookkeeping): let the Gmail poller ingest PDF receipts"
```

---

### Task 6: `isPdf` on the row model + drop-safe type filtering

**Files:**
- Modify: `lib/bookkeeping/receipt-batch.ts:35-61` (row type), `:101-121` (`newReceiptRow`), `lib/bookkeeping/email-receipts.ts:45`, `hooks/use-receipt-batch.ts:86-102` (`addFiles`), `:159`
- Test: `__tests__/lib/bookkeeping/receipt-batch.test.ts`, `__tests__/hooks/use-receipt-batch.test.tsx` (both existing)

**Interfaces:**
- Consumes: nothing.
- Produces: `ReceiptBatchRow.isPdf: boolean`; `newReceiptRow(clientId: string, fileName: string, thumbUrl: string | null, isPdf?: boolean)`; `ACCEPTED_RECEIPT_EXTENSIONS`/`isAcceptedReceiptFile(file: File): boolean` exported from `receipt-batch.ts`; `addFiles` now returns `{ dropped: string[]; rejected: string[] }`. Tasks 7 and 8 consume all of these.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/lib/bookkeeping/receipt-batch.test.ts`:

```ts
describe("isAcceptedReceiptFile", () => {
  const f = (name: string, type: string) => new File(["x"], name, { type })
  it("accepts the four supported types", () => {
    expect(isAcceptedReceiptFile(f("a.jpg", "image/jpeg"))).toBe(true)
    expect(isAcceptedReceiptFile(f("a.png", "image/png"))).toBe(true)
    expect(isAcceptedReceiptFile(f("a.webp", "image/webp"))).toBe(true)
    expect(isAcceptedReceiptFile(f("a.pdf", "application/pdf"))).toBe(true)
  })
  it("accepts by extension when the drop gives no mime", () => {
    expect(isAcceptedReceiptFile(f("invoice.PDF", ""))).toBe(true)
  })
  it("rejects everything else", () => {
    expect(isAcceptedReceiptFile(f("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))).toBe(false)
    expect(isAcceptedReceiptFile(f("book.csv", "text/csv"))).toBe(false)
  })
})

describe("newReceiptRow isPdf", () => {
  it("defaults to false", () => {
    expect(newReceiptRow("c1", "r.jpg", null).isPdf).toBe(false)
  })
  it("carries the flag when set", () => {
    expect(newReceiptRow("c1", "invoice.pdf", null, true).isPdf).toBe(true)
  })
})
```

Add to `__tests__/hooks/use-receipt-batch.test.tsx`:

```ts
it("accepts PDFs and reports non-receipt files separately from over-cap drops", () => {
  const { result } = renderHook(() => useReceiptBatch(hookArgs()))
  const files = [
    new File(["x"], "a.jpg", { type: "image/jpeg" }),
    new File(["x"], "invoice.pdf", { type: "application/pdf" }),
    new File(["x"], "notes.docx", { type: "application/msword" }),
  ]
  let outcome!: { dropped: string[]; rejected: string[] }
  act(() => {
    outcome = result.current.addFiles(files)
  })
  expect(result.current.files.map((f) => f.name)).toEqual(["a.jpg", "invoice.pdf"])
  expect(outcome.rejected).toEqual(["notes.docx"])
  expect(outcome.dropped).toEqual([])
})
```

(Reuse whatever `hookArgs()`/`renderHook` setup the existing file already defines.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/bookkeeping/receipt-batch.test.ts __tests__/hooks/use-receipt-batch.test.tsx`
Expected: FAIL — `isAcceptedReceiptFile` is not exported; `addFiles` has no `rejected`.

- [ ] **Step 3: Implement**

In `lib/bookkeeping/receipt-batch.ts`, add near `MAX_BATCH_SIZE`:

```ts
/** Mime-or-extension accept list. The click path is filtered by the input's
 *  `accept` attribute, but DROPPED files bypass it entirely — so the real
 *  gate has to live here, shared by both. */
const ACCEPTED_RECEIPT_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
const ACCEPTED_RECEIPT_EXTENSIONS = /\.(jpe?g|png|webp|pdf)$/i

export function isAcceptedReceiptFile(file: File): boolean {
  return ACCEPTED_RECEIPT_MIMES.includes(file.type.trim().toLowerCase()) || ACCEPTED_RECEIPT_EXTENSIONS.test(file.name)
}

export function isPdfFile(file: File): boolean {
  return file.type.trim().toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name)
}
```

Add to the `ReceiptBatchRow` interface, after `thumbUrl`:

```ts
  /** PDF rows cannot render in an <img> — the review surfaces swap in a file
   *  icon and an iframe preview instead. */
  isPdf: boolean
```

Change the signature and body of `newReceiptRow`:

```ts
export function newReceiptRow(
  clientId: string,
  fileName: string,
  thumbUrl: string | null,
  isPdf = false,
): ReceiptBatchRow {
```

and add `isPdf,` to the returned object next to `thumbUrl`.

In `hooks/use-receipt-batch.ts`, replace `addFiles` (lines 86-102):

```ts
  const addFiles = useCallback(
    (incoming: FileList | File[]): { dropped: string[]; rejected: string[] } => {
      const dropped: string[] = []
      const rejected: string[] = []
      const next = [...files]
      for (const f of Array.from(incoming)) {
        if (!isAcceptedReceiptFile(f)) {
          rejected.push(f.name)
          continue
        }
        if (next.some((e) => e.name === f.name && e.size === f.size)) continue
        if (next.length >= MAX_BATCH_SIZE) {
          dropped.push(f.name)
          continue
        }
        next.push(f)
      }
      setFiles(next)
      return { dropped, rejected }
    },
    [files],
  )
```

Update line 159 to pass the flag:

```ts
      const initial = files.map((f) => newReceiptRow(crypto.randomUUID(), f.name, makeThumbUrl(f), isPdfFile(f)))
```

Add `isAcceptedReceiptFile` and `isPdfFile` to the import from `@/lib/bookkeeping/receipt-batch`.

In `lib/bookkeeping/email-receipts.ts`, line 45:

```ts
    ...newReceiptRow(doc.id, doc.original_filename ?? "Email receipt", null, doc.mime_type === "application/pdf"),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/lib/bookkeeping/receipt-batch.test.ts __tests__/hooks/use-receipt-batch.test.tsx __tests__/lib/bookkeeping/email-receipts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/bookkeeping/receipt-batch.ts lib/bookkeeping/email-receipts.ts hooks/use-receipt-batch.ts __tests__/lib/bookkeeping/receipt-batch.test.ts __tests__/hooks/use-receipt-batch.test.tsx
git commit -m "feat(bookkeeping): track isPdf on receipt rows and filter dropped file types"
```

---

### Task 7: Real drag-and-drop in the receipt dialog

**Files:**
- Modify: `components/admin/bookkeeping/ReceiptUploadDialog.tsx:98-105` (`handleFilesPicked`), `:240-293` (select-phase markup)
- Test: `__tests__/components/receipt-upload-dialog.test.tsx` (existing)

**Interfaces:**
- Consumes: `addFiles` returning `{ dropped, rejected }` from Task 6.
- Produces: nothing.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/components/receipt-upload-dialog.test.tsx`:

```ts
function dropFiles(files: File[]) {
  const zone = screen.getByTestId("receipt-dropzone")
  fireEvent.drop(zone, { dataTransfer: { files, types: ["Files"] } })
}

describe("drag and drop", () => {
  it("adds dropped files to the batch", () => {
    renderDialog()
    dropFiles([makeFile("dropped.jpg")])
    expect(screen.getByText("dropped.jpg")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /upload & scan/i })).toBeEnabled()
  })

  it("accepts a dropped PDF", () => {
    renderDialog()
    dropFiles([new File(["x"], "invoice.pdf", { type: "application/pdf" })])
    expect(screen.getByText("invoice.pdf")).toBeInTheDocument()
  })

  it("rejects a dropped non-receipt file and adds nothing", () => {
    renderDialog()
    dropFiles([new File(["x"], "notes.docx", { type: "application/msword" })])
    expect(screen.queryByText("notes.docx")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /upload & scan/i })).toBeDisabled()
  })

  it("advertises PDF support", () => {
    renderDialog()
    expect(screen.getByText(/JPG, PNG, WEBP, or PDF/i)).toBeInTheDocument()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.getAttribute("accept")).toContain("application/pdf")
  })

  it("lets a second batch be dropped once files are staged", () => {
    renderDialog()
    pickFiles([makeFile("first.jpg")])
    dropFiles([makeFile("second.jpg")])
    expect(screen.getByText("first.jpg")).toBeInTheDocument()
    expect(screen.getByText("second.jpg")).toBeInTheDocument()
  })
})
```

Note: the existing test `expect(screen.getByText(/up to 15 photos/i))` will now fail — update it to `/up to 15 files/i` as part of this task.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/components/receipt-upload-dialog.test.tsx`
Expected: FAIL — no `receipt-dropzone` test id exists.

- [ ] **Step 3: Implement**

In `components/admin/bookkeeping/ReceiptUploadDialog.tsx`:

Add `useState` for the highlight (next to `expandedId`):

```ts
  const [dragActive, setDragActive] = useState(false)
```

Replace `handleFilesPicked` (lines 98-105):

```ts
  function handleFilesPicked(list: FileList | File[] | null) {
    if (!list || list.length === 0) return
    const { dropped, rejected } = batch.addFiles(list)
    if (rejected.length > 0) {
      toast.error(`Not a receipt file: ${rejected.join(", ")} — use JPG, PNG, WEBP, or PDF.`)
    }
    if (dropped.length > 0) {
      toast.info(`Only ${MAX_BATCH_SIZE} receipts per batch — not added: ${dropped.join(", ")}`)
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // Dropped files never pass through the input's `accept` filter, so
  // addFiles does the real type check (lib/bookkeeping/receipt-batch.ts).
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    handleFilesPicked(e.dataTransfer?.files ?? null)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(true)
  }
```

Update the hidden input's accept attribute (line 243):

```tsx
            accept="image/jpeg,image/png,image/webp,application/pdf"
```

Replace the `batch.files.length === 0 ? (…) : (…)` block (lines 249-289) with a version where the dropzone wraps both states:

```tsx
          <div
            data-testid="receipt-dropzone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={() => setDragActive(false)}
          >
            {batch.files.length === 0 ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    fileInputRef.current?.click()
                  }
                }}
                className={cn(
                  "w-full cursor-pointer rounded-xl border-2 border-dashed bg-muted/20 p-8 flex flex-col items-center gap-2 text-muted-foreground transition-colors",
                  dragActive
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border hover:border-primary/40 hover:text-foreground",
                )}
              >
                <ImagePlus className="size-6" />
                <span className="text-sm font-medium">
                  {dragActive ? "Drop to add" : "Drag receipts here or choose files"}
                </span>
              </div>
            ) : (
              <div
                className={cn(
                  "space-y-2 rounded-xl border-2 border-dashed p-2 transition-colors",
                  dragActive ? "border-primary bg-primary/5" : "border-transparent",
                )}
              >
                <div className="grid grid-cols-3 gap-2">
                  {batch.files.map((file, index) => (
                    <div key={`${file.name}-${file.size}`} className="relative rounded-lg border border-border overflow-hidden bg-muted/20">
                      <div className="aspect-square flex items-center justify-center">
                        <Camera className="size-5 text-muted-foreground/40" />
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate px-1.5 pb-1">{file.name}</p>
                      <button
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => batch.removeFile(index)}
                        className="absolute top-1 right-1 size-5 rounded-full bg-background/90 border border-border flex items-center justify-center text-muted-foreground hover:text-destructive"
                      >
                        <XCircle className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={batch.files.length >= MAX_BATCH_SIZE}
                >
                  <ImagePlus className="size-3.5 mr-1.5" />
                  Add more
                </Button>
              </div>
            )}
          </div>
```

Update the helper copy (line 292):

```tsx
            JPG, PNG, WEBP, or PDF. Max 10 MB each, up to {MAX_BATCH_SIZE} files.
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/components/receipt-upload-dialog.test.tsx`
Expected: PASS, including the pre-existing pick/remove cases.

- [ ] **Step 5: Commit**

```bash
git add components/admin/bookkeeping/ReceiptUploadDialog.tsx __tests__/components/receipt-upload-dialog.test.tsx
git commit -m "feat(bookkeeping): make the receipt dropzone actually accept drops"
```

---

### Task 8: PDF previews in the review surfaces

**Files:**
- Modify: `components/admin/bookkeeping/ReceiptBatchReview.tsx:120-135` (grid tile), `components/admin/bookkeeping/ReceiptRowEditor.tsx:60` + its preview markup
- Test: `__tests__/components/receipt-batch-review.test.tsx`, `__tests__/components/receipt-row-editor.test.tsx` (both existing)

**Interfaces:**
- Consumes: `ReceiptBatchRow.isPdf` from Task 6.
- Produces: nothing.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/components/receipt-batch-review.test.tsx`:

```ts
it("shows a file tile instead of a broken image for a PDF row", () => {
  renderReview([{ ...baseRow, clientId: "p1", fileName: "invoice.pdf", isPdf: true, thumbUrl: "blob:mock" }])
  // A blob URL of a PDF in an <img> renders as a broken-image box.
  expect(document.querySelector('img[src="blob:mock"]')).toBeNull()
  expect(screen.getByText("invoice.pdf")).toBeInTheDocument()
})

it("still renders the thumbnail for an image row", () => {
  renderReview([{ ...baseRow, clientId: "i1", fileName: "r.jpg", isPdf: false, thumbUrl: "blob:mock" }])
  expect(document.querySelector('img[src="blob:mock"]')).not.toBeNull()
})
```

(Adapt `renderReview`/`baseRow` to whatever the file already defines.)

Add to `__tests__/components/receipt-row-editor.test.tsx`:

```ts
it("renders a PDF preview in an iframe, not an img", () => {
  render(
    <ReceiptRowEditor
      row={row({ isPdf: true, previewUrl: "https://signed/doc.pdf" })}
      accounts={accounts}
      disabled={false}
      onEdit={() => {}}
      onPreviewLoaded={() => {}}
    />,
  )
  const frame = document.querySelector('iframe[src="https://signed/doc.pdf"]')
  expect(frame).not.toBeNull()
  expect(document.querySelector('img[src="https://signed/doc.pdf"]')).toBeNull()
  expect(screen.getByRole("link", { name: /open in new tab/i })).toHaveAttribute("href", "https://signed/doc.pdf")
})

it("still renders an img for a photo row", () => {
  render(
    <ReceiptRowEditor
      row={row({ isPdf: false, previewUrl: "https://signed/img" })}
      accounts={accounts}
      disabled={false}
      onEdit={() => {}}
      onPreviewLoaded={() => {}}
    />,
  )
  expect(document.querySelector('img[src="https://signed/img"]')).not.toBeNull()
  expect(document.querySelector("iframe")).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/components/receipt-batch-review.test.tsx __tests__/components/receipt-row-editor.test.tsx`
Expected: FAIL — PDF rows still render `<img>`.

- [ ] **Step 3: Implement**

In `components/admin/bookkeeping/ReceiptBatchReview.tsx`, import `FileText` from `lucide-react` and replace the thumbnail conditional at lines 126-129:

```tsx
                  {row.isPdf ? (
                    <div className="size-full flex flex-col items-center justify-center gap-1 bg-muted/40 text-muted-foreground">
                      <FileText className="size-5" />
                      <span className="text-[9px] font-medium uppercase tracking-wide">PDF</span>
                    </div>
                  ) : row.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.thumbUrl} alt="" className="size-full object-cover" />
                  ) : (
```

(Keep the existing final `) : (` fallback branch and its closing as-is.)

In `components/admin/bookkeeping/ReceiptRowEditor.tsx`, replace line 60:

```ts
  const imageSrc = row.isPdf ? null : (row.previewUrl ?? row.thumbUrl)
  // A blob object URL cannot be framed reliably, so the PDF viewer waits for
  // the signed URL that the effect above fetches once per row.
  const pdfSrc = row.isPdf ? row.previewUrl : null
```

Then, in the preview markup where `imageSrc` is rendered, add the PDF branch immediately before it:

```tsx
      {pdfSrc && (
        <div className="space-y-1.5">
          <iframe
            src={pdfSrc}
            title={`Receipt PDF — ${row.fileName}`}
            className="w-full h-64 rounded-xl border border-border bg-muted/20"
          />
          <a
            href={pdfSrc}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary underline underline-offset-2"
          >
            Open in new tab
          </a>
        </div>
      )}
      {row.isPdf && !pdfSrc && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
          {previewLoading ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
          <span>{previewLoading ? "Loading PDF…" : row.fileName}</span>
        </div>
      )}
```

Import `FileText` from `lucide-react` in this file too.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/components/receipt-batch-review.test.tsx __tests__/components/receipt-row-editor.test.tsx`
Expected: PASS, including all pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add components/admin/bookkeeping/ReceiptBatchReview.tsx components/admin/bookkeeping/ReceiptRowEditor.tsx __tests__/components/receipt-batch-review.test.tsx __tests__/components/receipt-row-editor.test.tsx
git commit -m "feat(bookkeeping): preview PDF receipts with a file tile and inline viewer"
```

---

### Task 9: Full verification

**Files:** none modified unless a failure demands it.

- [ ] **Step 1: Root typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Functions typecheck**

Run: `cd functions && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Full root suite**

Run: `npm run test:run`
Expected: green except the known-flaky Stripe webhook wall-clock timeouts documented in the project journal. Any *new* red must be traced to this change — stash-isolate with `git stash push -u -- <only paths this plan touched>` and re-run before concluding the baseline was already broken.

- [ ] **Step 4: Functions suite**

Run: `cd functions && npx vitest run`
Expected: green.

- [ ] **Step 5: Production build (separate command — never chained behind the suite)**

Run: `npm run build`
Expected: success.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "test(bookkeeping): verification fixes for PDF receipt support"
```

## Self-Review

**Spec coverage:** D1 → Tasks 3+4. D2 (10-page cap) → Task 1, enforced in Tasks 2+5. D3 (shared module) → Task 1, consumed by 2 and 5. D4 (icon + iframe) → Task 8. D5 (poller) → Task 5. D6 (no migration/flag/job field) → held throughout; no task adds any. Dropzone → Task 7. Type filtering on drop → Task 6. Error-handling table → Task 1 (page cap, unreadable), Task 2 (400s), Task 5 (poller never 500s), Task 6 (reject toast), Task 7 (mixed drop), Task 8 (iframe fallback link). Testing section → every task's Step 1, plus Task 9.

**Placeholder scan:** none — every code step carries real code.

**Type consistency:** `isPdf` is the row field name in Tasks 6, 7, 8. `isPdfFile`/`isAcceptedReceiptFile` (File-based, `receipt-batch.ts`) are deliberately distinct from `isPdfMime`/`isPdfUpload` (string-based, `receipt-pdf.ts`) — client bundle vs. server module, and `receipt-pdf.ts` must never reach the browser because it requires `pdf-parse`. `addFiles` returns `{ dropped, rejected }` in Task 6 and is destructured that way in Task 7. `buildReceiptVisionPayload` returns `{ images?, documents? }` in Task 4 and is spread into `callAgent` options matching the `documents?` field added in Task 3.
