// components/emails/PackAutoRenewWarningEmail.tsx
// Advance warning for a session pack armed with auto-renew: sent when the pack
// drops to the "low" reminder threshold (pack_reminder_low_at, a couple of
// sessions left by default) — BEFORE any money moves. Until now the only
// signal a payer ever got was the receipt AFTER the charge (PackRenewedEmail),
// so the client's first word of an auto-charge was the charge itself. This
// closes that gap by naming the exact charge that's coming: the card, the
// amount, what it buys, and how to stop it before it happens.
//
// Sibling of PackRenewedEmail.tsx (that receipt fires AFTER a successful
// auto-renewal; this fires BEFORE one, while the pack still has credits left).
// Same brand shell, same "how to turn it off" box, deliberately built to read
// side-by-side with it. lib/email.ts's sendPackAutoRenewWarningEmail is the
// only caller, via renderPackAutoRenewWarningEmail.
//
// Sent only when TWO conditions hold: the pack is armed (auto_renew: true) AND
// the payer has a saved card. An armed pack with NO saved card gets the
// ordinary "get in touch to renew" reminder instead — see
// lib/automation/pack-renewal-scanner.ts's classifyPackReminders, the pure
// selector that decides which branch a pack falls into. Warning about a charge
// that cannot happen would be a lie.
//
// WORDING IS TIED TO THE EVENT, NEVER A DATE. Training cadence varies client to
// client, so "in a few days" is a promise the system cannot keep — "when you
// use your last session" is always true regardless of how often they train.
//
// BRAND COLORS ARE HEX, NOT THE APP'S oklch() TOKENS — see PackRenewedEmail's
// header comment for the full reasoning; same values, reused verbatim so the
// two receipts/notices are visually identical.

import { formatCurrency } from "./PackRenewedEmail"

export interface PackAutoRenewWarningEmailProps {
  /** First name of the person whose card WILL be charged (the payer). */
  firstName: string
  /** Full name of the athlete the pack belongs to — may differ from the payer. */
  clientName: string
  /** Sessions left on the pack right now — the count that triggered this email. */
  remaining: number
  sessionType: string
  /** Credits the renewal pack will contain — same as the current pack's credits_total. */
  credits: number
  /** e.g. "visa" — capitalized for display. */
  cardBrand: string
  cardLast4: string
  amountCents: number
  /** Client portal link to the always-visible auto-renew off switch (MyCardPanel). */
  manageUrl: string
}

const BRAND = {
  primary: "#0E3F50",
  accent: "#C49B7A",
  neutral: "#edece8",
  textPrimary: "#0E3F50",
  textBody: "#5c5750",
  textMuted: "#78736c",
  textSubtle: "#a09b94",
  border: "#e8e5e0",
  cardBg: "#faf9f7",
} as const

const HEADING_FONT = "'Lexend Exa', Georgia, 'Times New Roman', serif"
const BODY_FONT = "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s
}

function InfoRow({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
  return (
    <tr>
      <td
        style={{
          padding: isLast ? "16px 0 0" : "0 0 16px",
          borderTop: isLast ? `1px solid ${BRAND.border}` : undefined,
          paddingTop: isLast ? "16px" : "0",
        }}
      >
        <p
          style={{
            margin: "0 0 4px",
            fontFamily: BODY_FONT,
            fontSize: "10px",
            fontWeight: 600,
            color: BRAND.textSubtle,
            textTransform: "uppercase",
            letterSpacing: "2px",
          }}
        >
          {label}
        </p>
        <p style={{ margin: 0, fontFamily: BODY_FONT, fontSize: "16px", fontWeight: 600, color: BRAND.textPrimary }}>
          {value}
        </p>
      </td>
    </tr>
  )
}

export function PackAutoRenewWarningEmail({
  firstName,
  clientName,
  remaining,
  sessionType,
  credits,
  cardBrand,
  cardLast4,
  amountCents,
  manageUrl,
}: PackAutoRenewWarningEmailProps) {
  const amount = formatCurrency(amountCents)
  const sessionsLabel = `${remaining} session${remaining === 1 ? "" : "s"}`
  const cardLabel = `${capitalize(cardBrand)} ending ${cardLast4}`
  const packLabel = `${credits}× ${sessionType}`

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <title>{`${sessionsLabel} left — your card renews this pack automatically`}</title>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: BRAND.neutral }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={{ backgroundColor: BRAND.neutral }}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: "48px 16px" }}>
                <table
                  role="presentation"
                  width="600"
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                  style={{
                    maxWidth: "600px",
                    width: "100%",
                    backgroundColor: "#ffffff",
                    borderRadius: "2px",
                    overflow: "hidden",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 20px 60px rgba(14,63,80,0.06)",
                  }}
                >
                  <tbody>
                    {/* ===== HEADER ===== */}
                    <tr>
                      <td style={{ backgroundColor: BRAND.primary, padding: 0 }}>
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                          <tbody>
                            <tr>
                              <td
                                style={{
                                  height: "3px",
                                  background: `linear-gradient(90deg, ${BRAND.accent} 0%, #d4b08e 50%, ${BRAND.accent} 100%)`,
                                }}
                              />
                            </tr>
                            <tr>
                              <td align="center" style={{ padding: "36px 48px 30px" }}>
                                <p
                                  style={{
                                    margin: "0 0 10px",
                                    fontFamily: HEADING_FONT,
                                    fontSize: "11px",
                                    color: BRAND.accent,
                                    letterSpacing: "4px",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  Auto-Renew Notice
                                </p>
                                <h1
                                  style={{
                                    margin: 0,
                                    fontFamily: HEADING_FONT,
                                    fontSize: "22px",
                                    fontWeight: 400,
                                    color: "#ffffff",
                                    lineHeight: 1.4,
                                  }}
                                >
                                  {clientName}&rsquo;s pack is almost done
                                </h1>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* ===== SESSIONS-LEFT HERO ===== */}
                    <tr>
                      <td align="center" style={{ padding: "32px 48px 8px" }}>
                        <p
                          style={{
                            margin: 0,
                            fontFamily: BODY_FONT,
                            fontSize: "11px",
                            color: BRAND.textMuted,
                            textTransform: "uppercase",
                            letterSpacing: "2px",
                          }}
                        >
                          Sessions remaining
                        </p>
                        <p
                          style={{
                            margin: "8px 0 0",
                            fontFamily: HEADING_FONT,
                            fontSize: "38px",
                            fontWeight: 600,
                            color: BRAND.textPrimary,
                          }}
                        >
                          {remaining}
                        </p>
                      </td>
                    </tr>

                    {/* ===== BODY COPY ===== */}
                    <tr>
                      <td style={{ padding: "16px 48px 0" }}>
                        <p style={{ margin: "0 0 8px", fontFamily: HEADING_FONT, fontSize: "20px", fontWeight: 400, color: BRAND.textPrimary }}>
                          Hi {firstName},
                        </p>
                        <p style={{ margin: "0 0 28px", fontFamily: BODY_FONT, fontSize: "15px", color: BRAND.textBody, lineHeight: 1.8 }}>
                          {clientName} has {sessionsLabel} left on the {sessionType} pack. When the last one is used,
                          we&rsquo;ll automatically charge your {cardLabel} {amount} for another {packLabel} pack
                          &mdash; no action needed, sessions keep going without a gap.
                        </p>
                      </td>
                    </tr>

                    {/* ===== INFO CARD ===== */}
                    <tr>
                      <td style={{ padding: "0 48px 8px" }}>
                        <table
                          role="presentation"
                          width="100%"
                          cellPadding={0}
                          cellSpacing={0}
                          border={0}
                          style={{ backgroundColor: BRAND.cardBg, borderRadius: "2px", borderLeft: `3px solid ${BRAND.accent}` }}
                        >
                          <tbody>
                            <tr>
                              <td style={{ padding: "24px 28px" }}>
                                <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                                  <tbody>
                                    <InfoRow label="For" value={clientName} />
                                    <InfoRow label="Card on file" value={cardLabel} />
                                    <InfoRow label="Will renew into" value={packLabel} />
                                    <InfoRow label="Will charge" value={amount} isLast />
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* ===== HOW TO TURN IT OFF ===== */}
                    <tr>
                      <td style={{ padding: "28px 48px 8px" }}>
                        <table
                          role="presentation"
                          width="100%"
                          cellPadding={0}
                          cellSpacing={0}
                          border={0}
                          style={{ backgroundColor: "#fbf8f3", borderLeft: `3px solid ${BRAND.accent}`, borderRadius: "4px" }}
                        >
                          <tbody>
                            <tr>
                              <td style={{ padding: "18px 22px" }}>
                                <p
                                  style={{
                                    margin: "0 0 4px",
                                    fontFamily: BODY_FONT,
                                    fontSize: "10px",
                                    fontWeight: 600,
                                    color: BRAND.textSubtle,
                                    textTransform: "uppercase",
                                    letterSpacing: "2px",
                                  }}
                                >
                                  Don&rsquo;t want that?
                                </p>
                                <p style={{ margin: "0 0 14px", fontFamily: BODY_FONT, fontSize: "13px", color: BRAND.textBody, lineHeight: 1.7 }}>
                                  Turn off auto-renew &mdash; it takes one click, any time before the last session is
                                  used. Or just reply to this email and we&rsquo;ll take care of it.
                                </p>
                                <table role="presentation" cellPadding={0} cellSpacing={0} border={0}>
                                  <tbody>
                                    <tr>
                                      <td align="center" style={{ border: `2px solid ${BRAND.primary}`, borderRadius: "2px" }}>
                                        <a
                                          href={manageUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          style={{
                                            display: "inline-block",
                                            fontFamily: BODY_FONT,
                                            fontSize: "12px",
                                            fontWeight: 600,
                                            color: BRAND.primary,
                                            textDecoration: "none",
                                            padding: "10px 24px",
                                            letterSpacing: "1px",
                                            textTransform: "uppercase",
                                          }}
                                        >
                                          Manage Auto-Renew
                                        </a>
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* ===== FOOTER ===== */}
                    <tr>
                      <td style={{ padding: "32px 48px 0" }}>
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                          <tbody>
                            <tr>
                              <td style={{ borderTop: `1px solid ${BRAND.border}` }} />
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style={{ padding: "24px 48px 40px" }}>
                        <p style={{ margin: 0, fontFamily: BODY_FONT, fontSize: "11px", color: BRAND.textSubtle }}>
                          &copy; {new Date().getFullYear()} DJP Athlete. All rights reserved.
                        </p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  )
}

/**
 * Renders PackAutoRenewWarningEmail to an HTML string for Resend.
 *
 * `react-dom/server` is dynamically imported (not a top-level import) for the
 * same reason PackRenewedEmail.tsx does it: this file is reachable from app
 * route handlers (via sendPackAutoRenewWarningEmail in lib/email.ts, called
 * from the pack-renewals cron route), and a static top-level `react-dom/server`
 * import trips Turbopack's app-route static analysis.
 */
export async function renderPackAutoRenewWarningEmail(props: PackAutoRenewWarningEmailProps): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server")
  return renderToStaticMarkup(<PackAutoRenewWarningEmail {...props} />)
}
