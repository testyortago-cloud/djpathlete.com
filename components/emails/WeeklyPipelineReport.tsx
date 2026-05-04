// components/emails/WeeklyPipelineReport.tsx
// React Email template for the weekly funnel digest. Mirrors the
// WeeklyAdsReport / WeeklyContentReport styling. Five sections: hero
// funnel, conversion rates, top campaigns by revenue, insights paragraph,
// CTA to dashboard.

interface PipelineCampaignSummary {
  dimension: string
  visits: number
  signups: number
  bookings: number
  payments: number
  revenue_cents: number
}

interface PipelineTotals {
  visits: number
  signups: number
  bookings: number
  payments: number
  revenue_cents: number
}

interface PipelineDelta {
  visits: number | null
  signups: number | null
  bookings: number | null
  payments: number | null
  revenue_cents: number | null
}

interface PipelineRates {
  visit_to_signup: number
  signup_to_booking: number
  booking_to_payment: number
}

interface Props {
  rangeStart: Date
  rangeEnd: Date
  totals: PipelineTotals
  delta: PipelineDelta
  rates: PipelineRates
  topCampaigns: PipelineCampaignSummary[]
  insightsParagraph: string
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
  error: "#b91c1c",
} as const

function fmtNumber(n: number): string {
  if (n === 0) return "—"
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString("en-US")
}

function fmtRevenue(cents: number): string {
  if (cents === 0) return "—"
  const dollars = cents / 100
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`
  return `$${dollars.toFixed(2)}`
}

function fmtRate(r: number): string {
  if (r === 0) return "—"
  return `${(r * 100).toFixed(1)}%`
}

function fmtPctTrend(pct: number | null, invert = false): { label: string; color: string } | null {
  if (pct === null || Number.isNaN(pct)) return null
  const rounded = Math.round(pct * 10) / 10
  if (rounded === 0) return { label: "no change", color: BRAND.textSubtle }
  const sign = rounded > 0 ? "+" : ""
  const isGood = invert ? rounded < 0 : rounded > 0
  return {
    label: `${sign}${rounded}% vs prev`,
    color: isGood ? BRAND.success : BRAND.error,
  }
}

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function FunnelStep({
  label,
  value,
  trend,
  isLast = false,
}: {
  label: string
  value: string
  trend: { label: string; color: string } | null
  isLast?: boolean
}) {
  return (
    <td
      width="20%"
      style={{
        padding: "16px 12px",
        verticalAlign: "top",
        borderRight: isLast ? "none" : `1px solid ${BRAND.border}`,
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "'Lexend Deca', -apple-system, sans-serif",
          fontSize: "10px",
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
          fontSize: "20px",
          fontWeight: 600,
          color: BRAND.primary,
        }}
      >
        {value}
      </p>
      {trend && (
        <p
          style={{
            margin: "4px 0 0",
            fontFamily: "'Lexend Deca', -apple-system, sans-serif",
            fontSize: "10px",
            color: trend.color,
          }}
        >
          {trend.label}
        </p>
      )}
    </td>
  )
}

export function WeeklyPipelineReport({
  rangeStart,
  rangeEnd,
  totals,
  delta,
  rates,
  topCampaigns,
  insightsParagraph,
  dashboardUrl,
}: Props) {
  return (
    <html>
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: BRAND.neutral,
          fontFamily: "'Lexend Deca', -apple-system, sans-serif",
        }}
      >
        <table
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ backgroundColor: BRAND.neutral, padding: "24px 0" }}
        >
          <tbody>
            <tr>
              <td align="center">
                <table
                  width="640"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{
                    backgroundColor: "#ffffff",
                    border: `1px solid ${BRAND.border}`,
                    borderRadius: "12px",
                    overflow: "hidden",
                  }}
                >
                  <tbody>
                    <tr>
                      <td style={{ padding: "24px 32px", borderBottom: `1px solid ${BRAND.border}` }}>
                        <p
                          style={{
                            margin: 0,
                            fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                            fontSize: "11px",
                            color: BRAND.textMuted,
                            textTransform: "uppercase",
                            letterSpacing: "2px",
                          }}
                        >
                          Pipeline · Weekly Funnel Report
                        </p>
                        <p
                          style={{
                            margin: "6px 0 0",
                            fontFamily: "'Lexend Exa', Georgia, serif",
                            fontSize: "22px",
                            fontWeight: 600,
                            color: BRAND.primary,
                          }}
                        >
                          Week of {fmtDateShort(rangeStart)} – {fmtDateShort(rangeEnd)}
                        </p>
                      </td>
                    </tr>

                    <tr>
                      <td>
                        <table
                          width="100%"
                          cellPadding={0}
                          cellSpacing={0}
                          style={{ borderBottom: `1px solid ${BRAND.border}` }}
                        >
                          <tbody>
                            <tr>
                              <FunnelStep label="Visits" value={fmtNumber(totals.visits)} trend={fmtPctTrend(delta.visits)} />
                              <FunnelStep label="Signups" value={fmtNumber(totals.signups)} trend={fmtPctTrend(delta.signups)} />
                              <FunnelStep label="Bookings" value={fmtNumber(totals.bookings)} trend={fmtPctTrend(delta.bookings)} />
                              <FunnelStep label="Payments" value={fmtNumber(totals.payments)} trend={fmtPctTrend(delta.payments)} />
                              <FunnelStep
                                label="Revenue"
                                value={fmtRevenue(totals.revenue_cents)}
                                trend={fmtPctTrend(delta.revenue_cents)}
                                isLast
                              />
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    <tr>
                      <td style={{ padding: "16px 32px", borderBottom: `1px solid ${BRAND.border}` }}>
                        <p style={{ margin: 0, fontSize: "11px", color: BRAND.textMuted, textTransform: "uppercase", letterSpacing: "1px" }}>
                          ─ Conversion rates
                        </p>
                        <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginTop: "10px" }}>
                          <tbody>
                            <tr>
                              <td width="33%" style={{ padding: "6px 4px" }}>
                                <p style={{ margin: 0, fontSize: "12px", color: BRAND.textMuted }}>Visit → Signup</p>
                                <p style={{ margin: "4px 0 0", fontSize: "16px", fontWeight: 600, color: BRAND.primary, fontFamily: "'Lexend Exa', Georgia, serif" }}>{fmtRate(rates.visit_to_signup)}</p>
                              </td>
                              <td width="33%" style={{ padding: "6px 4px" }}>
                                <p style={{ margin: 0, fontSize: "12px", color: BRAND.textMuted }}>Signup → Booking</p>
                                <p style={{ margin: "4px 0 0", fontSize: "16px", fontWeight: 600, color: BRAND.primary, fontFamily: "'Lexend Exa', Georgia, serif" }}>{fmtRate(rates.signup_to_booking)}</p>
                              </td>
                              <td width="34%" style={{ padding: "6px 4px" }}>
                                <p style={{ margin: 0, fontSize: "12px", color: BRAND.textMuted }}>Booking → Payment</p>
                                <p style={{ margin: "4px 0 0", fontSize: "16px", fontWeight: 600, color: BRAND.primary, fontFamily: "'Lexend Exa', Georgia, serif" }}>{fmtRate(rates.booking_to_payment)}</p>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    <tr>
                      <td style={{ padding: "20px 32px", borderBottom: `1px solid ${BRAND.border}` }}>
                        <p style={{ margin: 0, fontSize: "11px", color: BRAND.textMuted, textTransform: "uppercase", letterSpacing: "1px" }}>
                          ─ This week
                        </p>
                        <p
                          style={{
                            margin: "10px 0 0",
                            fontSize: "14px",
                            lineHeight: "22px",
                            color: BRAND.textPrimary,
                          }}
                        >
                          {insightsParagraph}
                        </p>
                      </td>
                    </tr>

                    {topCampaigns.length > 0 && (
                      <tr>
                        <td style={{ padding: "20px 32px", borderBottom: `1px solid ${BRAND.border}` }}>
                          <p style={{ margin: 0, fontSize: "11px", color: BRAND.textMuted, textTransform: "uppercase", letterSpacing: "1px" }}>
                            ─ Top campaigns by revenue
                          </p>
                          <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginTop: "10px" }}>
                            <tbody>
                              {topCampaigns.map((c, i) => (
                                <tr key={`${c.dimension}-${i}`} style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                                  <td style={{ padding: "10px 0", fontSize: "13px", color: BRAND.textPrimary }}>
                                    <strong>{c.dimension}</strong>
                                    <br />
                                    <span style={{ fontSize: "11px", color: BRAND.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                                      {fmtNumber(c.visits)} visits · {fmtNumber(c.signups)} signups · {fmtNumber(c.bookings)} bookings
                                    </span>
                                  </td>
                                  <td
                                    align="right"
                                    style={{ padding: "10px 0", fontSize: "13px", color: BRAND.textPrimary, fontFamily: "'JetBrains Mono', monospace" }}
                                  >
                                    {fmtRevenue(c.revenue_cents)}
                                    <br />
                                    <span style={{ fontSize: "11px", color: BRAND.textMuted }}>
                                      {fmtNumber(c.payments)} {c.payments === 1 ? "payment" : "payments"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}

                    <tr>
                      <td style={{ padding: "20px 32px", textAlign: "center" }}>
                        <a
                          href={dashboardUrl}
                          style={{
                            display: "inline-block",
                            padding: "10px 20px",
                            backgroundColor: BRAND.accent,
                            color: "#ffffff",
                            fontSize: "13px",
                            textDecoration: "none",
                            borderRadius: "8px",
                          }}
                        >
                          Open pipeline dashboard →
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
