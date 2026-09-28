// @vitest-environment node
//
// "Generate with AI" showed every document the owner attached as "0.0KB"
// (2026-09-29). They were PDFs with no text layer — scans, or screenshots
// saved as PDF — and pdf-parse, which reads only the text layer, returned two
// newlines for each. The route now hands those to GPT-6 Astra.
//
// pdf-parse runs for real here on real PDFs, so the
// "is this a scan" decision is exercised end to end. Only Astra is faked.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("@/lib/ai/read-document", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/read-document")>()
  return { ...actual, readPdfWithAstra: vi.fn() }
})

import { auth } from "@/lib/auth"
import { readPdfWithAstra, looksImageOnly } from "@/lib/ai/read-document"
import { POST } from "@/app/api/upload/extract-text/route"

const astra = readPdfWithAstra as ReturnType<typeof vi.fn>

// Two real PDFs of the same short article:
//   article-text.pdf — Chrome's print-to-PDF, so it carries a text layer.
//   article-scan.pdf — a screenshot of it wrapped by macOS `sips`: pixels
//                      only, which is what the owner's four "0.0KB" files were.
const FIXTURES = join(process.cwd(), "__tests__/fixtures/pdf")
const scan = () => readFileSync(join(FIXTURES, "article-scan.pdf"))
const withText = () => readFileSync(join(FIXTURES, "article-text.pdf"))

function upload(buf: Buffer, name = "example.pdf"): Promise<Response> {
  const body = new FormData()
  body.append("file", new File([new Uint8Array(buf)], name, { type: "application/pdf" }))
  return POST(new Request("http://localhost/api/upload/extract-text", { method: "POST", body }))
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "owner", role: "admin" } })
})

describe("POST /api/upload/extract-text — PDFs with no text layer", () => {
  it("reads an image-only PDF with Astra and says so", async () => {
    // MUTANT: drop the looksImageOnly branch — content comes back empty, 422.
    astra.mockResolvedValue({ text: "Why Your Hamstring Keeps Going", truncated: false })
    const res = await upload(scan(), "scan.pdf")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ name: "scan.pdf", content: "Why Your Hamstring Keeps Going", read_with: "ai" })
    expect(astra).toHaveBeenCalledTimes(1)
    expect(astra.mock.calls[0][1]).toBe("scan.pdf")
  })

  it("does not call Astra when the PDF has a real text layer", async () => {
    // Presence control for the test above: the same route, a PDF with text,
    // and the paid reader stays out of it.
    const res = await upload(withText())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.read_with).toBe("text")
    expect(body.content.replace(/\s+/g, " ")).toContain("hamstring strain too early")
    expect(astra).not.toHaveBeenCalled()
  })

  it("answers 502 with a plain reason when Astra fails on a scan", async () => {
    astra.mockRejectedValue(new Error("OpenRouter 503"))
    const res = await upload(scan(), "scan.pdf")
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/scan\.pdf looks like a scanned document/)
  })

  it("answers 422 rather than an empty document when nothing can be read", async () => {
    // MUTANT: drop the empty-text guard — a 200 with content "" is the
    // original "0.0KB" bug.
    astra.mockResolvedValue({ text: "", truncated: false })
    const res = await upload(scan(), "blank.pdf")
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe("No readable text found in blank.pdf. Paste the text into Notes instead.")
  })

  it("marks the document truncated when Astra hit its output limit", async () => {
    astra.mockResolvedValue({ text: "partial transcription", truncated: true })
    const res = await upload(scan())
    expect((await res.json()).truncated).toBe(true)
  })
})

describe("looksImageOnly", () => {
  it("treats a page with only a header's worth of text as image-only", () => {
    expect(looksImageOnly("\n\n", 1)).toBe(true)
    expect(looksImageOnly("Page 1 of 3   www.example.com", 1)).toBe(true)
  })

  it("scales with the page count", () => {
    const onePage = "x".repeat(250)
    expect(looksImageOnly(onePage, 1)).toBe(false)
    // 250 characters across ten pages is ten scanned pages with footers.
    expect(looksImageOnly(onePage, 10)).toBe(true)
  })
})
