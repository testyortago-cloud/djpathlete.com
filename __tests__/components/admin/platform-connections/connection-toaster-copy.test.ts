import { describe, it, expect } from "vitest"
import { errorCopyFor } from "@/components/admin/platform-connections/ConnectionToaster"

describe("errorCopyFor", () => {
  it("never tells a LinkedIn admin about Facebook Pages", () => {
    for (const reason of ["pages_lookup", "no_pages"]) {
      const copy = errorCopyFor("linkedin", reason)
      expect(copy).toMatch(/LinkedIn/)
      expect(copy).not.toMatch(/Facebook/)
    }
  })

  it("keeps Facebook's own wording for Facebook", () => {
    expect(errorCopyFor("facebook", "pages_lookup")).toMatch(/Facebook Pages/)
  })

  it("names the missing LinkedIn product when a scope is refused", () => {
    expect(errorCopyFor("linkedin", "unauthorized_scope_error")).toMatch(/Community Management API/)
  })

  it("falls back to the shared wording, then to the raw code", () => {
    expect(errorCopyFor("linkedin", "token_exchange")).toMatch(/rejected the authorization code/)
    expect(errorCopyFor("linkedin", "something_new")).toBe("(something_new)")
  })
})
