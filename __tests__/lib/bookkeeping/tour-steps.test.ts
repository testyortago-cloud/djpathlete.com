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
})
