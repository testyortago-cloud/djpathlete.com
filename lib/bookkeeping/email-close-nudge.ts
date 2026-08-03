// Monthly "time to close the books" nudge, emailed to the COACH only — a chore
// prompt, not a filing artifact, so no accountant recipient and no cc (the
// receipt-watchdog precedent). Fails LOUD when Resend/coach aren't configured:
// outbound must never silently no-op.
import { resend, FROM_EMAIL } from "@/lib/resend"
import { formatCents } from "./money"
import { formatPeriodLabel } from "./period-close"
import type { BookNudge } from "./close-nudge"

// Hardcoded prod origin — the accountant-pack DOWNLOAD_BASE precedent.
const BOOKS_URL = "https://www.darrenjpaul.com/admin/books"

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** Total open months across every book — drives the subject line. */
export function totalOpenMonths(nudges: readonly BookNudge[]): number {
  return nudges.reduce((sum, n) => sum + n.total_open, 0)
}

export function closeNudgeSubject(nudges: readonly BookNudge[]): string {
  const total = totalOpenMonths(nudges)
  if (total === 1) {
    const only = nudges.find((n) => n.open_months.length > 0)
    return `Time to close ${formatPeriodLabel(only!.open_months[0].period)}`
  }
  return `${total} months waiting to be closed`
}

export function closeNudgeEmailHtml(nudges: readonly BookNudge[]): string {
  const blocks = nudges
    .map((n) => {
      const rows = n.open_months
        .map(
          (m) => `
      <tr>
        <td style="padding:2px 8px;">${escapeHtml(formatPeriodLabel(m.period))}</td>
        <td style="padding:2px 8px;">${formatCents(m.income_cents)}</td>
        <td style="padding:2px 8px;">${formatCents(m.expense_cents)}</td>
        <td style="padding:2px 8px;"><strong>${formatCents(m.net_cents)}</strong></td>
        <td style="padding:2px 8px;">${m.entry_count}</td>
      </tr>`,
        )
        .join("")
      const more =
        n.total_open > n.open_months.length
          ? `<p style="font-size:12px;color:#888;">…and ${n.total_open - n.open_months.length} more.</p>`
          : ""
      return `
    <h3 style="margin-bottom:4px;">${escapeHtml(n.book_name)}</h3>
    <table style="font-size:13px;border-collapse:collapse;">
      <tr style="text-align:left;color:#444;">
        <th style="padding:2px 8px;">Month</th><th style="padding:2px 8px;">Income</th><th style="padding:2px 8px;">Expenses</th><th style="padding:2px 8px;">Net</th><th style="padding:2px 8px;">Entries</th>
      </tr>
      ${rows}
    </table>
    ${more}`
    })
    .join("")

  return `
  <div style="font-family: sans-serif; max-width: 640px;">
    <h2>DJP Athlete — months waiting to be closed</h2>
    <p>These months are finished and still open. Closing freezes their totals so nothing can drift into them later.</p>
    ${blocks}
    <p><a href="${BOOKS_URL}">Open the books</a> — the readiness check on the close card tells you what to clear first.</p>
    <p style="font-size: 12px; color: #888;">A record-keeping reminder — not tax advice; your CPA files.</p>
  </div>`
}

export async function sendCloseNudgeEmail(input: { nudges: readonly BookNudge[] }): Promise<{ error: string | null }> {
  if (!process.env.RESEND_API_KEY) return { error: "RESEND_API_KEY not configured" }
  const coach = process.env.COACH_EMAIL
  if (!coach) return { error: "COACH_EMAIL not configured" }
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: coach,
    subject: closeNudgeSubject(input.nudges),
    html: closeNudgeEmailHtml(input.nudges),
  })
  if (error) return { error: error.message ?? "Resend send failed" }
  return { error: null }
}
