// components/emails/WeeklyAdsReport.tsx
// React Email template for the Monday Google Ads digest. Mirrors the
// brand styling used by WeeklyContentReport (inline styles for client
// compatibility, no Tailwind). Six sections: hero stats, top campaigns,
// worst keywords, pending recs, plain-English insights, footer.

export interface AdsCampaignSummary {
  name: string
  type: string
  status: string
  cost_micros: number
  clicks: number
  conversions: number
  conversion_value: number
}

export interface AdsKeywordSummary {
  text: string
  match_type: string
  cost_micros: number
  clicks: number
  conversions: number
}

export interface AdsRecommendationSummary {
  recommendation_type: string
  scope: string
  reasoning: string
  confidence: number
}

export interface AdsTotals {
  cost_micros: number
  clicks: number
  conversions: number
  conversion_value: number
  ctr: number
  cpa_micros: number
}

export interface AdsTotalsDelta {
  cost_micros_pct: number | null
  conversions_pct: number | null
  cpa_micros_pct: number | null
}

interface Props {
  rangeStart: Date
  rangeEnd: Date
  totals: AdsTotals
  delta: AdsTotalsDelta
  topCampaigns: AdsCampaignSummary[]
  worstKeywords: AdsKeywordSummary[]
  pendingCount: number
  topPendingRecs: AdsRecommendationSummary[]
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

function fmtCurrency(micros: number): string {
  if (micros === 0) return "—"
  const dollars = micros / 1_000_000
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`
  return `$${dollars.toFixed(2)}`
}

function fmtNumber(n: number): string {
  if (n === 0) return "—"
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString("en-US")
}

function fmtPctDelta(pct: number | null, invert = false): { label: string; color: string } | null {
  if (pct === null || Number.isNaN(pct)) return null
  const rounded = Math.round(pct * 10) / 10
  if (rounded === 0) return { label: "no change", color: BRAND.textSubtle }
  const sign = rounded > 0 ? "+" : ""
  // For CPA, lower is better — invert color logic.
  const isGood = invert ? rounded < 0 : rounded > 0
  return {
    label: `${sign}${rounded}% vs prev week`,
    color: isGood ? BRAND.success : BRAND.error,
  }
}

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function Stat({
  label,
  value,
  trend,
}: {
  label: string
  value: string
  trend: { label: string; color: string } | null
}) {
  return (
    <td
      width="33%"
      style={{
        padding: "16px",
        verticalAlign: "top",
        borderRight: `1px solid ${BRAND.border}`,
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "'Lexend Deca', -apple-system, sans-serif",
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
          fontSize: "24px",
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
            fontSize: "11px",
            color: trend.color,
          }}
        >
          {trend.label}
        </p>
      )}
    </td>
  )
}

export function WeeklyAdsReport({
  rangeStart,
  rangeEnd,
  totals,
  delta,
  topCampaigns,
  worstKeywords,
  pendingCount,
  topPendingRecs,
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
                  width="600"
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
                    {/* Header */}
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
                          Google Ads · Weekly Report
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

                    {/* Hero stats */}
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
                              <Stat
                                label="Spend"
                                value={fmtCurrency(totals.cost_micros)}
                                trend={fmtPctDelta(delta.cost_micros_pct)}
                              />
                              <Stat
                                label="Conversions"
                                value={fmtNumber(Math.round(totals.conversions))}
                                trend={fmtPctDelta(delta.conversions_pct)}
                              />
                              <td
                                width="34%"
                                style={{ padding: "16px", verticalAlign: "top" }}
                              >
                                <p
                                  style={{
                                    margin: 0,
                                    fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                    fontSize: "11px",
                                    color: BRAND.textMuted,
                                    textTransform: "uppercase",
                                    letterSpacing: "1px",
                                  }}
                                >
                                  Cost / conv
                                </p>
                                <p
                                  style={{
                                    margin: "6px 0 0",
                                    fontFamily: "'Lexend Exa', Georgia, serif",
                                    fontSize: "24px",
                                    fontWeight: 600,
                                    color: BRAND.primary,
                                  }}
                                >
                                  {fmtCurrency(totals.cpa_micros)}
                                </p>
                                {(() => {
                                  const t = fmtPctDelta(delta.cpa_micros_pct, true)
                                  return t ? (
                                    <p
                                      style={{
                                        margin: "4px 0 0",
                                        fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                        fontSize: "11px",
                                        color: t.color,
                                      }}
                                    >
                                      {t.label}
                                    </p>
                                  ) : null
                                })()}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* Insights paragraph */}
                    <tr>
                      <td
                        style={{
                          padding: "20px 32px",
                          borderBottom: `1px solid ${BRAND.border}`,
                        }}
                      >
                        <p
                          style={{
                            margin: 0,
                            fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                            fontSize: "11px",
                            color: BRAND.textMuted,
                            textTransform: "uppercase",
                            letterSpacing: "1px",
                          }}
                        >
                          ─ This week
                        </p>
                        <p
                          style={{
                            margin: "10px 0 0",
                            fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                            fontSize: "14px",
                            lineHeight: "22px",
                            color: BRAND.textPrimary,
                          }}
                        >
                          {insightsParagraph}
                        </p>
                      </td>
                    </tr>

                    {/* Top campaigns */}
                    {topCampaigns.length > 0 && (
                      <tr>
                        <td
                          style={{
                            padding: "20px 32px",
                            borderBottom: `1px solid ${BRAND.border}`,
                          }}
                        >
                          <p
                            style={{
                              margin: 0,
                              fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                              fontSize: "11px",
                              color: BRAND.textMuted,
                              textTransform: "uppercase",
                              letterSpacing: "1px",
                            }}
                          >
                            ─ Top campaigns by conversion value
                          </p>
                          <table
                            width="100%"
                            cellPadding={0}
                            cellSpacing={0}
                            style={{ marginTop: "10px" }}
                          >
                            <tbody>
                              {topCampaigns.map((c, i) => (
                                <tr
                                  key={`${c.name}-${i}`}
                                  style={{ borderBottom: `1px solid ${BRAND.border}` }}
                                >
                                  <td
                                    style={{
                                      padding: "10px 0",
                                      fontSize: "13px",
                                      color: BRAND.textPrimary,
                                    }}
                                  >
                                    <strong>{c.name}</strong>
                                    <br />
                                    <span style={{ fontSize: "11px", color: BRAND.textMuted }}>
                                      {c.type} · {c.status}
                                    </span>
                                  </td>
                                  <td
                                    align="right"
                                    style={{
                                      padding: "10px 0",
                                      fontSize: "13px",
                                      color: BRAND.textPrimary,
                                      fontFamily: "'JetBrains Mono', monospace",
                                    }}
                                  >
                                    {fmtCurrency(c.cost_micros)} spend
                                    <br />
                                    <span style={{ fontSize: "11px", color: BRAND.textMuted }}>
                                      {c.conversions.toFixed(1)} conv · {fmtCurrency(c.conversion_value * 1_000_000)} value
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}

                    {/* Worst keywords */}
                    {worstKeywords.length > 0 && (
                      <tr>
                        <td
                          style={{
                            padding: "20px 32px",
                            borderBottom: `1px solid ${BRAND.border}`,
                          }}
                        >
                          <p
                            style={{
                              margin: 0,
                              fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                              fontSize: "11px",
                              color: BRAND.textMuted,
                              textTransform: "uppercase",
                              letterSpacing: "1px",
                            }}
                          >
                            ─ Worst-performing keywords (high spend, no conversions)
                          </p>
                          <table
                            width="100%"
                            cellPadding={0}
                            cellSpacing={0}
                            style={{ marginTop: "10px" }}
                          >
                            <tbody>
                              {worstKeywords.map((k, i) => (
                                <tr
                                  key={`${k.text}-${i}`}
                                  style={{ borderBottom: `1px solid ${BRAND.border}` }}
                                >
                                  <td
                                    style={{
                                      padding: "10px 0",
                                      fontSize: "13px",
                                      color: BRAND.textPrimary,
                                    }}
                                  >
                                    <code
                                      style={{
                                        fontFamily: "'JetBrains Mono', monospace",
                                        fontSize: "12px",
                                      }}
                                    >
                                      {k.text}
                                    </code>{" "}
                                    <span style={{ fontSize: "11px", color: BRAND.textMuted }}>
                                      [{k.match_type}]
                                    </span>
                                  </td>
                                  <td
                                    align="right"
                                    style={{
                                      padding: "10px 0",
                                      fontSize: "12px",
                                      color: BRAND.error,
                                      fontFamily: "'JetBrains Mono', monospace",
                                    }}
                                  >
                                    {fmtCurrency(k.cost_micros)} · {fmtNumber(k.clicks)} clk · 0 conv
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}

                    {/* Pending recs */}
                    <tr>
                      <td
                        style={{
                          padding: "20px 32px",
                          borderBottom: `1px solid ${BRAND.border}`,
                        }}
                      >
                        <p
                          style={{
                            margin: 0,
                            fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                            fontSize: "11px",
                            color: BRAND.textMuted,
                            textTransform: "uppercase",
                            letterSpacing: "1px",
                          }}
                        >
                          ─ Pending recommendations · {pendingCount} total
                        </p>
                        {topPendingRecs.length === 0 ? (
                          <p
                            style={{
                              margin: "10px 0 0",
                              fontSize: "13px",
                              color: BRAND.textMuted,
                            }}
                          >
                            No pending recommendations this week.
                          </p>
                        ) : (
                          <table
                            width="100%"
                            cellPadding={0}
                            cellSpacing={0}
                            style={{ marginTop: "10px" }}
                          >
                            <tbody>
                              {topPendingRecs.map((r, i) => (
                                <tr key={i} style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                                  <td style={{ padding: "10px 0", fontSize: "13px", color: BRAND.textPrimary }}>
                                    <strong style={{ textTransform: "capitalize" }}>
                                      {r.recommendation_type.replace(/_/g, " ")}
                                    </strong>{" "}
                                    <span style={{ fontSize: "11px", color: BRAND.textMuted }}>
                                      ({r.scope}) · conf {Math.round(r.confidence * 100)}%
                                    </span>
                                    <br />
                                    <span style={{ fontSize: "12px", color: BRAND.textMuted }}>
                                      {r.reasoning.slice(0, 200)}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>

                    {/* CTA */}
                    <tr>
                      <td style={{ padding: "20px 32px", textAlign: "center" }}>
                        <a
                          href={dashboardUrl}
                          style={{
                            display: "inline-block",
                            padding: "10px 20px",
                            backgroundColor: BRAND.accent,
                            color: "#ffffff",
                            fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                            fontSize: "13px",
                            textDecoration: "none",
                            borderRadius: "8px",
                          }}
                        >
                          Review in dashboard →
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
