/** Phase-4b outbound: emails the accountant pack xlsx via Resend attachments
 *  (base64 — first attachment use in the repo). Shared by the manual
 *  email-pack route and the quarterly cron's internal route. Fails LOUD when
 *  Resend isn't configured — an outbound money artifact must never silently
 *  no-op. */
import { resend, FROM_EMAIL } from "@/lib/resend"

export interface SendAccountantPackInput {
  recipient: string
  from: string
  to: string
  buffer: Buffer
}

export function accountantPackEmailHtml(from: string, to: string): string {
  return `
  <div style="font-family: sans-serif; max-width: 560px;">
    <h2>DJP Athlete — Accountant Pack</h2>
    <p>Attached: the bookkeeping workbook for <strong>${from}</strong> to <strong>${to}</strong> (occurred-on dates, inclusive).</p>
    <ul style="font-size: 13px; color: #444;">
      <li>All figures are <strong>GROSS</strong> — Stripe fees and payouts are not netted.</li>
      <li>Every number is an <strong>estimate for planning; the CPA files</strong>.</li>
      <li>This pack is a <strong>candidate for the accountant's review</strong>, never a filed return.</li>
      <li>Business and personal finances live in separate books; no sheet mixes them.</li>
    </ul>
    <p style="font-size: 12px; color: #888;">Sent from the DJP Athlete bookkeeping system.</p>
  </div>`
}

export async function sendAccountantPack(input: SendAccountantPackInput): Promise<{ error: string | null }> {
  if (!process.env.RESEND_API_KEY) return { error: "RESEND_API_KEY not configured" }
  const coach = process.env.COACH_EMAIL
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: input.recipient,
    ...(coach && coach !== input.recipient ? { cc: coach } : {}),
    subject: `Accountant pack — ${input.from} to ${input.to} (gross, estimates)`,
    html: accountantPackEmailHtml(input.from, input.to),
    attachments: [
      { filename: `djp-accountant-pack-${input.from}-${input.to}.xlsx`, content: input.buffer.toString("base64") },
    ],
  })
  if (error) return { error: error.message ?? "Resend send failed" }
  return { error: null }
}
