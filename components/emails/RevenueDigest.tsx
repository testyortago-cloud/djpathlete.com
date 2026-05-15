// components/emails/RevenueDigest.tsx
// Weekly Monday-morning revenue digest. Reads one revenue_snapshots row.

import type { RevenueSnapshot } from "@/types/database"

interface Props {
  snapshot: RevenueSnapshot
  dashboardUrl: string
}

const BRAND = {
  primary: "#0E3F50",
  accent: "#C49B7A",
  neutral: "#edece8",
  textPrimary: "#0E3F50",
  textMuted: "#6b7280",
  textSubtle: "#9ca3af",
  border: "#e8e5e0",
  success: "#2f855a",
  warning: "#b91c1c",
} as const

function fmtMoney(cents: number): string {
  const dollars = cents / 100
  if (Math.abs(dollars) >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`
  return `$${dollars.toFixed(2)}`
}

function fmtDelta(cents: number): { label: string; color: string } {
  if (cents === 0) return { label: "no change", color: BRAND.textMuted }
  const arrow = cents > 0 ? "▲" : "▼"
  const color = cents > 0 ? BRAND.success : BRAND.warning
  return { label: `${arrow} ${fmtMoney(Math.abs(cents))}`, color }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

const REASON_LABEL: Record<string, string> = {
  cancel_at_period_end: "canceling at period end",
  failed_payment: "payment failed this week",
}

export function RevenueDigest({ snapshot, dashboardUrl }: Props) {
  const delta = fmtDelta(snapshot.mrr_delta_cents)
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Weekly revenue digest — DJP Athlete</title>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: BRAND.neutral }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
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
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 20px 60px rgba(14,63,80,0.06)",
                  }}
                >
                  <tbody>
                    {/* Header */}
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
                              <td align="center" style={{ padding: "32px 48px 24px" }}>
                                <p
                                  style={{
                                    margin: 0,
                                    fontFamily: "'Lexend Exa', Georgia, serif",
                                    fontSize: "11px",
                                    color: BRAND.accent,
                                    letterSpacing: "4px",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  Weekly Revenue Digest
                                </p>
                                <h1
                                  style={{
                                    margin: "10px 0 0",
                                    fontFamily: "'Lexend Exa', Georgia, serif",
                                    fontSize: "20px",
                                    fontWeight: 600,
                                    color: "#ffffff",
                                    letterSpacing: "1.5px",
                                  }}
                                >
                                  Week of {fmtDate(snapshot.week_of)}
                                </h1>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* MRR hero */}
                    <tr>
                      <td align="center" style={{ padding: "32px 48px 8px" }}>
                        <p
                          style={{
                            margin: 0,
                            fontFamily: "'Lexend Deca', sans-serif",
                            fontSize: "11px",
                            color: BRAND.textMuted,
                            textTransform: "uppercase",
                            letterSpacing: "2px",
                          }}
                        >
                          MRR
                        </p>
                        <p
                          style={{
                            margin: "8px 0 0",
                            fontFamily: "'Lexend Exa', Georgia, serif",
                            fontSize: "40px",
                            fontWeight: 600,
                            color: BRAND.textPrimary,
                          }}
                        >
                          {fmtMoney(snapshot.mrr_cents)}
                        </p>
                        <p
                          style={{
                            margin: "6px 0 0",
                            fontFamily: "'Lexend Deca', sans-serif",
                            fontSize: "13px",
                            color: delta.color,
                            fontWeight: 600,
                          }}
                        >
                          {delta.label} vs last week
                        </p>
                      </td>
                    </tr>

                    {/* Counters grid */}
                    <tr>
                      <td style={{ padding: "24px 48px 8px" }}>
                        <table
                          role="presentation"
                          width="100%"
                          cellPadding={0}
                          cellSpacing={0}
                          border={0}
                          style={{ border: `1px solid ${BRAND.border}`, borderCollapse: "collapse" }}
                        >
                          <tbody>
                            <tr>
                              <Counter label="New customers" value={String(snapshot.new_customers)} />
                              <Counter label="Churned" value={String(snapshot.churned_customers)} />
                            </tr>
                            <tr style={{ borderTop: `1px solid ${BRAND.border}` }}>
                              <Counter
                                label="Failed payments (7d)"
                                value={`${snapshot.failed_payments_7d} · ${fmtMoney(snapshot.failed_payment_value_cents)}`}
                                warn={snapshot.failed_payments_7d > 0}
                              />
                              <Counter
                                label="Renewals (14d)"
                                value={`${snapshot.upcoming_renewals_14d} · ${fmtMoney(snapshot.upcoming_renewals_value_cents)}`}
                              />
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* At-risk subs */}
                    {snapshot.top_at_risk_subscriptions.length > 0 && (
                      <tr>
                        <td style={{ padding: "16px 48px 0" }}>
                          <h2
                            style={{
                              margin: "8px 0 12px",
                              fontFamily: "'Lexend Exa', Georgia, serif",
                              fontSize: "13px",
                              fontWeight: 600,
                              color: BRAND.warning,
                              letterSpacing: "1.5px",
                              textTransform: "uppercase",
                            }}
                          >
                            At-risk subscriptions
                          </h2>
                          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                            <tbody>
                              {snapshot.top_at_risk_subscriptions.map((r, i) => (
                                <tr key={i}>
                                  <td
                                    style={{
                                      padding: "8px 0",
                                      borderBottom: `1px solid ${BRAND.border}`,
                                      fontFamily: "'Lexend Deca', sans-serif",
                                      fontSize: "14px",
                                      color: BRAND.textPrimary,
                                    }}
                                  >
                                    <strong>{r.customer_email || "(unknown)"}</strong> ·{" "}
                                    <span style={{ color: BRAND.textMuted }}>
                                      {fmtMoney(r.mrr_cents)} MRR · renews {fmtDate(r.renewal_at)}
                                    </span>{" "}
                                    · <span style={{ color: BRAND.warning }}>{REASON_LABEL[r.reason]}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}

                    {/* CTA */}
                    <tr>
                      <td align="center" style={{ padding: "32px 48px 40px" }}>
                        <a
                          href={dashboardUrl}
                          style={{
                            display: "inline-block",
                            padding: "14px 32px",
                            fontFamily: "'Lexend Exa', Georgia, serif",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "#ffffff",
                            backgroundColor: BRAND.primary,
                            textDecoration: "none",
                            textTransform: "uppercase",
                            letterSpacing: "2px",
                            borderRadius: "2px",
                          }}
                        >
                          Open revenue dashboard
                        </a>
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

function Counter({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <td
      width="50%"
      style={{
        padding: "14px 16px",
        verticalAlign: "top",
        borderRight: `1px solid ${BRAND.border}`,
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "'Lexend Deca', sans-serif",
          fontSize: "11px",
          color: BRAND.textMuted,
          textTransform: "uppercase",
          letterSpacing: "1px",
        }}
      >
        {label}
      </p>
      <p
        style={{
          margin: "6px 0 0",
          fontFamily: "'Lexend Exa', Georgia, serif",
          fontSize: "18px",
          fontWeight: 600,
          color: warn ? BRAND.warning : BRAND.primary,
        }}
      >
        {value}
      </p>
    </td>
  )
}
