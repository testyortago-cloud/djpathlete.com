import { describe, it, expect } from "vitest"
import { parsedSheetSchema, programImportOptionsSchema } from "@/lib/validators/program-import"

describe("program-import validators", () => {
  it("accepts a well-formed parsed sheet", () => {
    const ok = parsedSheetSchema.safeParse({ sheets: [{ name: "Workout", rows: [["a", "b"], ["1", "2"]] }] })
    expect(ok.success).toBe(true)
  })
  it("rejects a sheet with non-string cells", () => {
    const bad = parsedSheetSchema.safeParse({ sheets: [{ name: "x", rows: [[1, 2]] }] })
    expect(bad.success).toBe(false)
  })
  it("defaults options and coerces empty client_id to null", () => {
    const parsed = programImportOptionsSchema.parse({})
    expect(parsed.is_public).toBe(false)
    expect(parsed.client_id).toBeNull()
  })
  it("rejects a bad client_id uuid", () => {
    const bad = programImportOptionsSchema.safeParse({ client_id: "not-a-uuid" })
    expect(bad.success).toBe(false)
  })
})
