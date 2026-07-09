import ExcelJS from "exceljs"

export interface ParsedSheet {
  sheets: { name: string; rows: string[][] }[]
}

export const PARSE_LIMITS = {
  maxRowsPerSheet: 1500,
  maxColsPerSheet: 30,
  maxCellChars: 500,
  maxSheets: 6,
} as const

function cellToText(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v === null || v === undefined) return ""
  if (typeof v === "object") {
    const anyV = v as { text?: string; result?: unknown; richText?: { text: string }[] }
    if (typeof anyV.text === "string") return anyV.text.trim()
    if (Array.isArray(anyV.richText)) return anyV.richText.map((r) => r.text).join("").trim()
    if (anyV.result !== undefined && anyV.result !== null) return String(anyV.result).trim()
    return ""
  }
  return String(v).trim()
}

export async function parseWorkbookToSheet(buffer: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  } catch {
    throw new Error("Could not read the Excel file. Please upload a valid .xlsx workbook.")
  }

  const sheets: ParsedSheet["sheets"] = []
  const worksheets = wb.worksheets.slice(0, PARSE_LIMITS.maxSheets)

  for (const ws of worksheets) {
    const rows: string[][] = []
    const rowCount = Math.min(ws.rowCount, PARSE_LIMITS.maxRowsPerSheet)
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r)
      const cells: string[] = []
      for (let c = 1; c <= PARSE_LIMITS.maxColsPerSheet; c++) {
        cells.push(cellToText(row.getCell(c)).slice(0, PARSE_LIMITS.maxCellChars))
      }
      while (cells.length && cells[cells.length - 1] === "") cells.pop()
      rows.push(cells)
    }
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop()
    if (rows.length === 0) continue
    sheets.push({ name: ws.name, rows })
  }

  if (sheets.length === 0) {
    throw new Error("The workbook has no readable rows.")
  }
  return { sheets }
}
