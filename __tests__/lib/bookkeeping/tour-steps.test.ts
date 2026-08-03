import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { BOOKS_TOUR_STEPS } from "@/lib/bookkeeping/tour-steps"

const PAGES = ["/admin/books", "/admin/books/accounts", "/admin/books/reports",
  "/admin/books/insights", "/admin/books/assets", "/admin/books/email-receipts"]

describe("BOOKS_TOUR_STEPS", () => {
  it("has unique ids", () => {
    expect(new Set(BOOKS_TOUR_STEPS.map((s) => s.id)).size).toBe(BOOKS_TOUR_STEPS.length)
  })
  it("only uses the six known pages", () => {
    for (const s of BOOKS_TOUR_STEPS) expect(PAGES).toContain(s.page)
  })
  it("groups steps contiguously by page — cross-page resume depends on it", () => {
    const seen = new Set<string>()
    let prev = ""
    for (const s of BOOKS_TOUR_STEPS) {
      if (s.page !== prev) {
        expect(seen.has(s.page)).toBe(false) // a page never reappears after we left it
        seen.add(s.page)
        prev = s.page
      }
    }
  })
  it("starts on the ledger page", () => {
    expect(BOOKS_TOUR_STEPS[0].page).toBe("/admin/books")
  })
  it("every step id appears as a data-tour attribute in some books client component", () => {
    const dir = join(process.cwd(), "components/admin/bookkeeping")
    const files = ["BooksClient.tsx", "AccountsManager.tsx", "ReportsClient.tsx",
      "InsightsClient.tsx", "AssetsClient.tsx", "EmailReceiptsClient.tsx"]
    const source = files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n")
    for (const s of BOOKS_TOUR_STEPS) {
      expect(source, `data-tour="${s.id}" missing from all six clients`).toContain(`data-tour="${s.id}"`)
    }
  })
})
