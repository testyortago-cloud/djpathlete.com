// @vitest-environment node
//
// Two environment traps live in this file, both discovered the hard way:
//
// 1. pdf-parse drives pdf.js, which never settles under jsdom — every
//    countPdfPages case hangs to the 5s timeout instead of resolving.
//
// 2. The fixtures are REAL Chromium-printed PDFs, not hand-built minimal ones.
//    A synthetic PDF with a hand-written xref table fails pdf.js validation
//    ("bad XRef entry"), and pdf.js's recovery path then reports a
//    plausible-but-wrong page count — so a hand-rolled fixture produced a
//    green 3-page assertion and a silently-wrong 11-page one in the same run.
//    Regenerate with scripts in the plan doc if they ever need to change.
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  MAX_RECEIPT_PDF_PAGES,
  countPdfPages,
  isPdfMime,
  isPdfUpload,
  pdfRejectionReason,
  pdfRejectionReasonForBuffer,
} from "@/lib/bookkeeping/receipt-pdf"

const FIXTURES = join(process.cwd(), "__tests__/fixtures/pdf")
const pdf = (name: string) => readFileSync(join(FIXTURES, name))

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
    await expect(countPdfPages(pdf("receipt-1page.pdf"))).resolves.toBe(1)
  })
  it("counts a multi-page PDF", async () => {
    await expect(countPdfPages(pdf("receipt-3page.pdf"))).resolves.toBe(3)
  })
  it("counts an over-cap PDF", async () => {
    await expect(countPdfPages(pdf("receipt-11page.pdf"))).resolves.toBe(11)
  })
  it("rejects bytes that are not a PDF", async () => {
    await expect(countPdfPages(Buffer.from("this is not a pdf"))).rejects.toThrow()
  })
})

describe("pdfRejectionReasonForBuffer", () => {
  it("returns null for an in-cap PDF", async () => {
    await expect(pdfRejectionReasonForBuffer(pdf("receipt-3page.pdf"))).resolves.toBeNull()
  })
  it("returns the over-cap reason for an 11-page PDF", async () => {
    await expect(pdfRejectionReasonForBuffer(pdf("receipt-11page.pdf"))).resolves.toMatch(
      /import statement/i,
    )
  })
  it("turns an unreadable PDF into a reason instead of throwing", async () => {
    await expect(pdfRejectionReasonForBuffer(Buffer.from("nope"))).resolves.toMatch(
      /couldn't read/i,
    )
  })
})
