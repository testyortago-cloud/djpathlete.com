import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { parseWorkbookToSheet } from "@/lib/excel/parse-program-sheet"

async function makeBuffer(rows: (string | number)[][], sheetName = "Workout"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName)
  rows.forEach((r) => ws.addRow(r))
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe("parseWorkbookToSheet", () => {
  it("extracts a trimmed 2D string grid per sheet", async () => {
    const buf = await makeBuffer([
      ["Week", "Day", "Exercise", "Sets", "Reps"],
      [1, "Monday", "  Squat  ", 4, "6-8"],
    ])
    const parsed = await parseWorkbookToSheet(buf)
    const sheet = parsed.sheets.find((s) => s.name === "Workout")!
    expect(sheet.rows[0]).toEqual(["Week", "Day", "Exercise", "Sets", "Reps"])
    expect(sheet.rows[1]).toEqual(["1", "Monday", "Squat", "4", "6-8"])
  })

  it("drops fully-empty trailing rows and empty sheets", async () => {
    const buf = await makeBuffer([["A"], [""], [""]])
    const parsed = await parseWorkbookToSheet(buf)
    expect(parsed.sheets[0].rows.length).toBe(1)
  })

  it("throws a friendly error on a non-workbook buffer", async () => {
    await expect(parseWorkbookToSheet(Buffer.from("not a spreadsheet"))).rejects.toThrow()
  })
})
