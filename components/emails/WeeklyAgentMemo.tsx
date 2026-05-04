// components/emails/WeeklyAgentMemo.tsx
// React Email template for the senior-marketer agent's Wednesday memo.
// Renders the structured sections (executive summary, what's working,
// what's not, recommended actions, watch list) into a brand-styled email.

import type {
  GoogleAdsAgentMemoSections,
  GoogleAdsAgentRecommendedAction,
} from "@/types/database"

interface Props {
  subject: string
  weekOf: string
  sections: GoogleAdsAgentMemoSections
  dashboardUrl: string
  baseUrl: string
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
  warning: "#b45309",
} as const

const PRIORITY_TONE: Record<GoogleAdsAgentRecommendedAction["priority"], string> = {
  high: BRAND.error,
  medium: BRAND.warning,
  low: BRAND.textMuted,
}

function fmtWeekOf(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: "11px",
        color: BRAND.textMuted,
        textTransform: "uppercase",
        letterSpacing: "1px",
      }}
    >
      ─ {children}
    </p>
  )
}

export function WeeklyAgentMemo({ subject, weekOf, sections, dashboardUrl, baseUrl }: Props) {
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
                            fontSize: "11px",
                            color: BRAND.textMuted,
                            textTransform: "uppercase",
                            letterSpacing: "2px",
                          }}
                        >
                          AI Ads Agent · Strategist Memo
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
                          {subject}
                        </p>
                        <p
                          style={{
                            margin: "4px 0 0",
                            fontSize: "12px",
                            color: BRAND.textMuted,
                          }}
                        >
                          Week of {fmtWeekOf(weekOf)}
                        </p>
                      </td>
                    </tr>

                    <tr>
                      <td style={{ padding: "20px 32px", borderBottom: `1px solid ${BRAND.border}` }}>
                        <SectionHeader>Executive summary</SectionHeader>
                        <p
                          style={{
                            margin: "10px 0 0",
                            fontSize: "14px",
                            lineHeight: "22px",
                            color: BRAND.textPrimary,
                          }}
                        >
                          {sections.executive_summary}
                        </p>
                      </td>
                    </tr>

                    {sections.whats_working.length > 0 && (
                      <tr>
                        <td style={{ padding: "20px 32px", borderBottom: `1px solid ${BRAND.border}` }}>
                          <SectionHeader>What&rsquo;s working</SectionHeader>
                          {sections.whats_working.map((p, i) => (
                            <p
                              key={i}
                              style={{
                                margin: "10px 0 0",
                                fontSize: "13px",
                                lineHeight: "20px",
                                color: BRAND.textPrimary,
                              }}
                            >
                              {p}
                            </p>
                          ))}
                        </td>
                      </tr>
                    )}

                    {sections.whats_not.length > 0 && (
                      <tr>
                        <td style={{ padding: "20px 32px", borderBottom: `1px solid ${BRAND.border}` }}>
                          <SectionHeader>What&rsquo;s not</SectionHeader>
                          {sections.whats_not.map((p, i) => (
                            <p
                              key={i}
                              style={{
                                margin: "10px 0 0",
                                fontSize: "13px",
                                lineHeight: "20px",
                                color: BRAND.textPrimary,
                              }}
                            >
                              {p}
                            </p>
                          ))}
                        </td>
                      </tr>
                    )}

                    {sections.recommended_actions.length > 0 && (
                      <tr>
                        <td style={{ padding: "20px 32px", borderBottom: `1px solid ${BRAND.border}` }}>
                          <SectionHeader>Recommended actions</SectionHeader>
                          <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginTop: "10px" }}>
                            <tbody>
                              {sections.recommended_actions.map((a, i) => (
                                <tr key={i} style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                                  <td style={{ padding: "10px 0" }}>
                                    <span
                                      style={{
                                        display: "inline-block",
                                        padding: "1px 6px",
                                        borderRadius: "4px",
                                        fontSize: "10px",
                                        fontWeight: 600,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.5px",
                                        backgroundColor: PRIORITY_TONE[a.priority] + "1A",
                                        color: PRIORITY_TONE[a.priority],
                                        marginRight: "8px",
                                        verticalAlign: "middle",
                                      }}
                                    >
                                      {a.priority}
                                    </span>
                                    <strong style={{ fontSize: "13px", color: BRAND.textPrimary }}>
                                      {a.link ? (
                                        <a
                                          href={`${baseUrl}${a.link}`}
                                          style={{ color: BRAND.textPrimary, textDecoration: "underline" }}
                                        >
                                          {a.title}
                                        </a>
                                      ) : (
                                        a.title
                                      )}
                                    </strong>
                                    <p
                                      style={{
                                        margin: "4px 0 0",
                                        fontSize: "12px",
                                        lineHeight: "18px",
                                        color: BRAND.textMuted,
                                      }}
                                    >
                                      {a.reasoning}
                                    </p>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}

                    <tr>
                      <td style={{ padding: "20px 32px", borderBottom: `1px solid ${BRAND.border}` }}>
                        <SectionHeader>Watch next week</SectionHeader>
                        <p
                          style={{
                            margin: "10px 0 0",
                            fontSize: "13px",
                            lineHeight: "20px",
                            color: BRAND.textPrimary,
                          }}
                        >
                          {sections.watch_list}
                        </p>
                      </td>
                    </tr>

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
                          Open agent in dashboard →
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
