// lib/funnels/leads-csv.ts — leads as a spreadsheet.
//
// A pure module so the escaping can be tested without a request, a database or
// a download. CSV looks like "join with commas" right up until someone's answer
// contains a comma, which on a form that asks "anything we should know?" is
// most of them.

import type { FunnelLead } from "@/lib/db/funnel-leads"

/** Fixed columns, in the order a human reads them. */
//
// `Type` says whether a row is a form fill or a completed quiz -- the same
// distinction the inbox shows as a badge, so a spreadsheet and the screen do
// not disagree. The SCORE is deliberately not a column: it lives on
// `quiz_attempts` and the export route does not read that table, and a column
// that was empty for every row would be worse than no column at all.
const COLUMNS = ["Captured at", "Page", "Step", "Type", "Name", "Email", "Phone", "Status", "Notes"] as const

/**
 * One CSV field.
 *
 * Quotes whenever the value contains a delimiter, a quote or a newline, and
 * doubles embedded quotes — RFC 4180. A textarea answer with a line break in it
 * would otherwise end the ROW, silently shifting every remaining value into the
 * wrong column for the rest of the file.
 *
 * THE LEADING-CHARACTER GUARD IS NOT COSMETIC. A value starting with `=`, `+`,
 * `-` or `@` is executed as a formula by Excel and Sheets when the file is
 * opened, which turns "export your leads" into a way for anyone who can type
 * into a public form to run a formula on the operator's machine. Prefixing a
 * single quote is the standard mitigation and is invisible in the cell.
 */
export function csvField(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value)
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`
  return guarded
}

function row(values: unknown[]): string {
  return values.map(csvField).join(",")
}

/**
 * Every lead, plus every distinct answer key across them as its own column.
 *
 * The form on each page has its own fields, so there is no fixed set — a
 * waitlist page asks for sport and preferred days, an enquiry page asks
 * something else. Union of the keys, sorted, appended after the fixed columns:
 * a lead that has no value for another page's question gets an empty cell,
 * which is the honest representation of "was never asked".
 */
export function leadsToCsv(leads: FunnelLead[]): string {
  const answerKeys = [...new Set(leads.flatMap((lead) => Object.keys(lead.payload ?? {})))].sort()

  const lines = [row([...COLUMNS, ...answerKeys])]

  for (const lead of leads) {
    lines.push(
      row([
        lead.created_at,
        lead.funnel_name ?? "",
        lead.step_name ?? "",
        lead.kind === "quiz" ? "Quiz" : "Form",
        lead.name ?? "",
        lead.email ?? "",
        lead.phone ?? "",
        lead.status,
        lead.notes ?? "",
        ...answerKeys.map((key) => lead.payload?.[key] ?? ""),
      ]),
    )
  }

  // CRLF: RFC 4180 specifies it, and Excel on Windows — where this file is
  // going — is the one consumer that still cares.
  return lines.join("\r\n")
}

/** `funnel-leads-2026-08-11.csv`, from a timestamp the caller supplies. */
export function leadsCsvFilename(now: Date): string {
  const iso = Number.isNaN(now.getTime()) ? "export" : now.toISOString().slice(0, 10)
  return `funnel-leads-${iso}.csv`
}
