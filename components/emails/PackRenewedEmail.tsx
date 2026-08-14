// components/emails/PackRenewedEmail.tsx
// Receipt for a session pack that auto-renewed against a saved card. This is
// money that moved without the payer doing anything, so — unlike a normal
// purchase receipt — it has to explain itself completely: what was charged,
// what it bought, who it's for (household billing means the payer and the
// athlete are often different people), why it happened with no action from
// the payer, and how to make it stop before the next one.
//
// Sibling of sendPackPaymentLinkEmail in lib/email.ts, which sends the
// "pay now" link for a manual/failed renewal — this is what a SUCCESSFUL
// auto-renewal sends instead. lib/email.ts's sendPackRenewedEmail is the
// only caller; it renders this template via renderPackRenewedEmail and is
// the one and only path a renewal receipt goes out through.
//
// BRAND COLORS ARE HEX, NOT THE APP'S oklch() TOKENS. Email clients (Outlook,
// Gmail app, etc.) don't reliably support oklch() or @font-face webfonts, so
// this pins the same hex equivalents every other file in components/emails/
// already uses for Primary Green Azure (oklch(0.30 0.04 220) -> #0E3F50) and
// Accent Gray Orange (oklch(0.70 0.08 60) -> #C49B7A), and falls back to a
// web-safe font stack with the brand fonts (Lexend Exa / Lexend Deca) named
// first for the mail clients that do render them.

export interface PackRenewedEmailProps {
  /** First name of the person whose card was charged (the payer). */
  firstName: string
  /** Full name of the athlete the pack belongs to — may differ from the payer. */
  clientName: string
  /** e.g. "10× Performance training" — credits + session type, already formatted. */
  packLabel: string
  amountCents: number
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

/** `$1,500.00` from cents — the one place this receipt formats money, so the
 *  subject line built in lib/email.ts imports this too rather than
 *  re-deriving it. */
export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
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

export function PackRenewedEmail({ firstName, clientName, packLabel, amountCents }: PackRenewedEmailProps) {
  const amount = formatCurrency(amountCents)

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <title>{`Your card was charged ${amount} — DJP Athlete`}</title>
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
                                  Payment Receipt
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
                                  {clientName}&rsquo;s sessions just renewed
                                </h1>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* ===== AMOUNT HERO ===== */}
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
                          Charged to your card on file
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
                          {amount}
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
                          {clientName}&rsquo;s session pack ran out, so it renewed automatically on your saved card
                          because auto-renew is turned on for this pack. No action was needed on your end &mdash;
                          sessions keep going without a gap.
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
                                    <InfoRow label="Package" value={packLabel} />
                                    <InfoRow label="Charged" value={amount} isLast />
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
                                  Want to turn this off?
                                </p>
                                <p style={{ margin: 0, fontFamily: BODY_FONT, fontSize: "13px", color: BRAND.textBody, lineHeight: 1.7 }}>
                                  Auto-renew is on for this pack, which is why this charge happened without you doing
                                  anything. To cancel auto-renew before the next one, or to update the card on file,
                                  just reply to this email and we&rsquo;ll take care of it.
                                </p>
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
 * Renders PackRenewedEmail to an HTML string for Resend.
 *
 * `react-dom/server` is dynamically imported (not a top-level import) for the
 * same reason lib/shop/emails.ts and lib/analytics/daily-pulse.ts do it:
 * this file is reachable from app route handlers (via sendPackRenewedEmail
 * in lib/email.ts, called from the Stripe webhook / pack-renewal cron
 * routes), and a static top-level `react-dom/server` import trips Turbopack's
 * app-route static analysis.
 */
export async function renderPackRenewedEmail(props: PackRenewedEmailProps): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server")
  return renderToStaticMarkup(<PackRenewedEmail {...props} />)
}
