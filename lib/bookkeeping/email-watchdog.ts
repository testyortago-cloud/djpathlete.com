// Phase-6b outbound: the weekly missing-receipt chore list, emailed to the COACH only
// (D-10 — a chore list, not a filing artifact; no accountant recipient, no cc).
// Fails LOUD when Resend/coach aren't configured — outbound must never silently no-op.
import { resend, FROM_EMAIL } from "@/lib/resend"
import { formatCents } from "./money"
import type { WatchdogFinding } from "./receipt-watchdog"

/** Top-N rows rendered in the email (spec §4.2, pinned). */
export const WATCHDOG_EMAIL_ROW_CAP = 25

// Hardcoded prod origin — the accountant-pack DOWNLOAD_BASE precedent.
const INSIGHTS_URL = "https://www.darrenjpaul.com/admin/books/insights"

const REASON_LABELS: Record<string, string> = {
  no_document: "no receipt",
  no_purpose: "no purpose",
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export function receiptWatchdogEmailHtml(findings: WatchdogFinding[]): string {
  const totalCents = findings.reduce((sum, f) => sum + f.amount_cents, 0)
  const rows = findings
    .slice(0, WATCHDOG_EMAIL_ROW_CAP)
    .map(
      (f) => `
      <tr>
        <td style="padding:2px 8px;">${f.occurred_on}</td>
        <td style="padding:2px 8px;">${formatCents(f.amount_cents)}</td>
        <td style="padding:2px 8px;">${escapeHtml(f.counterparty ?? "—")}</td>
        <td style="padding:2px 8px;">${escapeHtml(f.account_name)}</td>
        <td style="padding:2px 8px;">${f.reasons.map((r) => REASON_LABELS[r] ?? r).join(", ")}</td>
      </tr>`,
    )
    .join("")
  return `
  <div style="font-family: sans-serif; max-width: 640px;">
    <h2>DJP Athlete — Missing receipts &amp; purposes</h2>
    <p><strong>${findings.length}</strong> expense ${findings.length === 1 ? "entry" : "entries"} totaling <strong>${formatCents(totalCents)}</strong> ${findings.length === 1 ? "is" : "are"} missing a receipt or business purpose (14+ days old, trailing year).</p>
    <table style="font-size: 13px; border-collapse: collapse;">
      <tr style="text-align: left; color: #444;">
        <th style="padding:2px 8px;">Date</th><th style="padding:2px 8px;">Amount</th><th style="padding:2px 8px;">Counterparty</th><th style="padding:2px 8px;">Category</th><th style="padding:2px 8px;">Missing</th>
      </tr>
      ${rows}
    </table>
    ${
      findings.length > WATCHDOG_EMAIL_ROW_CAP
        ? `<p style="font-size:12px;color:#888;">…and ${findings.length - WATCHDOG_EMAIL_ROW_CAP} more.</p>`
        : ""
    }
    <p><a href="${INSIGHTS_URL}">Open the insights page</a> to work through the list.</p>
    <p style="font-size: 12px; color: #888;">A chore list for record-keeping — not tax advice; your CPA files.</p>
  </div>`
}

export async function sendReceiptWatchdogEmail(input: {
  findings: WatchdogFinding[]
}): Promise<{ error: string | null }> {
  if (!process.env.RESEND_API_KEY) return { error: "RESEND_API_KEY not configured" }
  const coach = process.env.COACH_EMAIL
  if (!coach) return { error: "COACH_EMAIL not configured" }
  const totalCents = input.findings.reduce((sum, f) => sum + f.amount_cents, 0)
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: coach,
    subject: `Missing receipts — ${input.findings.length} ${input.findings.length === 1 ? "entry" : "entries"}, ${formatCents(totalCents)}`,
    html: receiptWatchdogEmailHtml(input.findings),
  })
  if (error) return { error: error.message ?? "Resend send failed" }
  return { error: null }
}
