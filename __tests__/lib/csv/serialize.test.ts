import { describe, it, expect } from "vitest"
import { csvCell, csvRow, csvDocument } from "@/lib/csv/serialize"

describe("csvCell", () => {
  it("passes plain text through", () => {
    expect(csvCell("hello")).toBe("hello")
  })
  it("quotes commas, quotes, newlines and doubles inner quotes", () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""')
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"')
  })
  it("neutralizes formula-injection leads with a apostrophe prefix", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)")
    expect(csvCell("+1-800")).toBe("'+1-800")
    expect(csvCell("-2")).toBe("'-2")
    expect(csvCell("@cmd")).toBe("'@cmd")
  })
  it("guards then quotes when both apply", () => {
    expect(csvCell("=danger,x")).toBe('"\'=danger,x"')
  })
  it("renders null/undefined as empty", () => {
    expect(csvCell(null)).toBe("")
    expect(csvCell(undefined)).toBe("")
  })
  it("passes numbers through untouched", () => {
    expect(csvCell(42)).toBe("42")
  })
})

describe("csvRow / csvDocument", () => {
  it("joins cells and rows", () => {
    expect(csvRow(["a", "b"])).toBe("a,b")
    expect(csvDocument([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d")
  })
})
