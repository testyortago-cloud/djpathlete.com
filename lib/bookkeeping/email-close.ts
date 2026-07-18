// Phase-6a outbound: the books-closed statement (spec §3.5). Sibling of
// email-pack.ts — same Resend init, fail-LOUD without RESEND_API_KEY, coach-cc.
// A statement of record-keeping, never a filing (honesty guardrail §7).
import { resend, FROM_EMAIL } from "@/lib/resend"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatPeriodLabel } from "@/lib/bookkeeping/period-close"

export interface SendBooksClosedEmailInput {
  recipient: string
  bookName: string
  period: string // YYYY-MM
  income_cents: number
  expense_cents: number
  net_cents: number
  entry_count: number
  closed_at: string
}

export function booksClosedEmailHtml(input: SendBooksClosedEmailInput): string {
  return `
  <div style="font-family: sans-serif; max-width: 560px;">
    <h2>Books closed — ${input.bookName}, ${formatPeriodLabel(input.period)}</h2>
    <table style="font-size: 14px; border-collapse: collapse;">
      <tr><td style="padding: 4px 12px 4px 0;">Income</td><td><strong>${formatCents(input.income_cents)}</strong></td></tr>
      <tr><td style="padding: 4px 12px 4px 0;">Expenses</td><td><strong>${formatCents(input.expense_cents)}</strong></td></tr>
      <tr><td style="padding: 4px 12px 4px 0;">Net</td><td><strong>${formatCents(input.net_cents)}</strong></td></tr>
      <tr><td style="padding: 4px 12px 4px 0;">Entries</td><td>${input.entry_count}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0;">Closed at</td><td>${input.closed_at}</td></tr>
    </table>
    <p style="font-size: 13px; color: #444;">
      This confirms the month's record-keeping is closed in DJP Athlete's books. It is not a filing; your CPA files.
    </p>
    <p style="font-size: 12px; color: #888;">Sent from the DJP Athlete bookkeeping system.</p>
  </div>`
}

export async function sendBooksClosedEmail(input: SendBooksClosedEmailInput): Promise<{ error: string | null }> {
  if (!process.env.RESEND_API_KEY) return { error: "RESEND_API_KEY not configured" }
  const coach = process.env.COACH_EMAIL
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: input.recipient,
    ...(coach && coach !== input.recipient ? { cc: coach } : {}),
    subject: `Books closed — ${input.bookName} ${formatPeriodLabel(input.period)}`,
    html: booksClosedEmailHtml(input),
  })
  if (error) return { error: error.message ?? "Resend send failed" }
  return { error: null }
}
