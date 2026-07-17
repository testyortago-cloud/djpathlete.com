// lib/csv/serialize.ts
// Shared CSV serializer. Promoted from lib/ads/campaign-blueprint-csv.ts's
// escape/row helpers, hardened with CSV formula-injection defense (a cell
// beginning = + - @ tab or CR is prefixed with ' so spreadsheet apps do not
// execute it). Use this for every export in the app.

const INJECTION_LEAD = /^[=+\-@\t\r]/

/** Escape one cell: neutralize formula leads, then CSV-quote if needed. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return String(value)
  let s = value
  if (INJECTION_LEAD.test(s)) s = `'${s}`
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function csvRow(values: Array<string | number | null | undefined>): string {
  return values.map(csvCell).join(",")
}

export function csvDocument(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map(csvRow).join("\r\n")
}
