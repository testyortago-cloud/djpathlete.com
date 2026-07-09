import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { generateProgramTemplate } from "@/lib/excel-templates"

describe("generateProgramTemplate", () => {
  it("produces a workbook with Info, Workout, Instructions sheets and correct headers", async () => {
    const buf = await generateProgramTemplate()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as unknown as ArrayBuffer)

    expect(wb.getWorksheet("Info")).toBeTruthy()
    expect(wb.getWorksheet("Instructions")).toBeTruthy()
    const workout = wb.getWorksheet("Workout")
    expect(workout).toBeTruthy()

    const headers = (workout!.getRow(1).values as unknown[]).slice(1).map(String)
    expect(headers).toEqual([
      "Week", "Day", "Exercise", "Sets", "Reps", "Rest (s)", "RPE", "Tempo", "Technique", "Group/Superset", "Notes",
    ])
    expect(workout!.actualRowCount).toBeGreaterThan(2)
  })
})
