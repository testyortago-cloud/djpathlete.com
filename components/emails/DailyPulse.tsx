// components/emails/DailyPulse.tsx
import { Section, SECTION_BRAND } from "./_shared/Section"
import type { DailyBriefPayload } from "@/types/coach-emails"

const BRAND = {
  primary: "#0E3F50",
  accent: "#C49B7A",
  neutral: "#edece8",
  textPrimary: "#0E3F50",
  textMuted: "#6b7280",
  textSubtle: "#9ca3af",
  border: "#e8e5e0",
  warning: "#b91c1c",
} as const

function fmtDayLong(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function summaryLine(p: DailyBriefPayload): string {
  const bits: string[] = []
  if (p.bookings && p.bookings.callsToday.length > 0)
    bits.push(`${p.bookings.callsToday.length} calls today`)
  if (p.coaching?.formReviewsAwaiting && p.coaching.formReviewsAwaiting.count > 0)
    bits.push(`${p.coaching.formReviewsAwaiting.count} form reviews waiting`)
  if (p.coaching && p.coaching.atRiskClients.length > 0)
    bits.push(`${p.coaching.atRiskClients.length} clients at-risk`)
  if (p.pipeline.awaitingReview > 0) bits.push(`${p.pipeline.awaitingReview} posts awaiting review`)
  if (p.revenueFunnel && p.revenueFunnel.adSpendCents > 0)
    bits.push(`$${(p.revenueFunnel.adSpendCents / 100).toFixed(0)} ad spend yesterday`)
  if (p.anomalies && p.anomalies.flags.length > 0)
    bits.push(`${p.anomalies.flags.length} anomalies`)
  if (bits.length === 0) return "Quiet morning — nothing flagged."
  return bits.join(" · ") + "."
}

interface Props { payload: DailyBriefPayload }

export function DailyPulse({ payload }: Props) {
  const kicker = payload.isMondayEdition ? "Weekly kick-off" : "Daily Brief"
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{kicker} — DJP Athlete</title>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: BRAND.neutral }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={{ backgroundColor: BRAND.neutral }}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: "48px 16px" }}>
                <table role="presentation" width="600" cellPadding={0} cellSpacing={0} border={0} style={{ maxWidth: "600px", width: "100%", backgroundColor: "#ffffff", borderRadius: "2px", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 20px 60px rgba(14,63,80,0.06)" }}>
                  <tbody>
                    {/* Header */}
                    <tr>
                      <td style={{ backgroundColor: BRAND.primary, padding: 0 }}>
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                          <tbody>
                            <tr>
                              <td style={{ height: "3px", background: `linear-gradient(90deg, ${BRAND.accent} 0%, #d4b08e 50%, ${BRAND.accent} 100%)` }} />
                            </tr>
                            <tr>
                              <td align="center" style={{ padding: "32px 48px 24px" }}>
                                <p style={{ margin: 0, fontFamily: "'Lexend Exa', Georgia, serif", fontSize: "11px", color: BRAND.accent, letterSpacing: "4px", textTransform: "uppercase" }}>{kicker}</p>
                                <h1 style={{ margin: "10px 0 0", fontFamily: "'Lexend Exa', Georgia, serif", fontSize: "20px", fontWeight: 600, color: "#ffffff", letterSpacing: "1.5px" }}>{fmtDayLong(payload.referenceDate)}</h1>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* Today at a glance */}
                    <tr>
                      <td style={{ padding: "24px 48px 8px" }}>
                        <p style={{ margin: 0, fontFamily: "'Lexend Deca', -apple-system, sans-serif", fontSize: "15px", color: BRAND.textPrimary, lineHeight: 1.5 }}>
                          {summaryLine(payload)}
                        </p>
                      </td>
                    </tr>

                    {payload.bookings && (
                      <Section title="Today's calls & sessions">
                        {payload.bookings.callsToday.length > 0 && (
                          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                            <tbody>
                              {payload.bookings.callsToday.map((c, i) => (
                                <tr key={i}>
                                  <td style={{ padding: "8px 0", borderBottom: `1px solid ${BRAND.border}`, fontFamily: "'Lexend Deca', sans-serif", fontSize: "14px", color: BRAND.textPrimary }}>
                                    <strong>{c.time}</strong> &nbsp;·&nbsp; {c.clientName} &nbsp;·&nbsp; <span style={{ color: BRAND.textMuted }}>{c.type}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {payload.bookings.newSignupsOvernight > 0 && (
                          <p style={{ margin: "10px 0 0", fontFamily: "'Lexend Deca', sans-serif", fontSize: "13px", color: BRAND.textMuted }}>
                            {payload.bookings.newSignupsOvernight} new event/clinic signup{payload.bookings.newSignupsOvernight === 1 ? "" : "s"} overnight.
                          </p>
                        )}
                      </Section>
                    )}

                    {payload.coaching && (
                      <Section title="Coaching signal">
                        {payload.coaching.formReviewsAwaiting && (
                          <p style={{ margin: "0 0 8px", fontFamily: "'Lexend Deca', sans-serif", fontSize: "14px", color: BRAND.textPrimary }}>
                            <strong>{payload.coaching.formReviewsAwaiting.count}</strong> form reviews awaiting reply
                            {payload.coaching.formReviewsAwaiting.oldestAgeHours >= 24 && (
                              <span style={{ color: BRAND.warning }}> · oldest {payload.coaching.formReviewsAwaiting.oldestAgeHours}h</span>
                            )}
                          </p>
                        )}
                        {payload.coaching.atRiskClients.length > 0 && (
                          <p style={{ margin: "0 0 8px", fontFamily: "'Lexend Deca', sans-serif", fontSize: "14px", color: BRAND.textPrimary }}>
                            At-risk clients: {payload.coaching.atRiskClients.map((c) => `${c.name} (${c.daysSinceLastLog}d)`).join(", ")}
                          </p>
                        )}
                        {payload.coaching.lowRpeLogFlags > 0 && (
                          <p style={{ margin: "0 0 8px", fontFamily: "'Lexend Deca', sans-serif", fontSize: "14px", color: BRAND.textPrimary }}>
                            {payload.coaching.lowRpeLogFlags} low-RPE log flag{payload.coaching.lowRpeLogFlags === 1 ? "" : "s"} from yesterday
                          </p>
                        )}
                        {payload.coaching.voiceDriftFlags > 0 && (
                          <p style={{ margin: "0 0 8px", fontFamily: "'Lexend Deca', sans-serif", fontSize: "14px", color: BRAND.textPrimary }}>
                            {payload.coaching.voiceDriftFlags} voice-drift flag{payload.coaching.voiceDriftFlags === 1 ? "" : "s"} since yesterday
                          </p>
                        )}
                      </Section>
                    )}

                    {/* Pipeline (always renders) */}
                    <Section title="Content pipeline">
                      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={{ border: `1px solid ${SECTION_BRAND.border}`, borderCollapse: "collapse" }}>
                        <tbody>
                          <tr>
                            <PipelineCell label="Awaiting review" value={payload.pipeline.awaitingReview} />
                            <PipelineCell label="Ready to publish" value={payload.pipeline.readyToPublish} />
                          </tr>
                          <tr style={{ borderTop: `1px solid ${SECTION_BRAND.border}` }}>
                            <PipelineCell label="Scheduled today" value={payload.pipeline.scheduledToday} />
                            <PipelineCell label="Videos to transcribe" value={payload.pipeline.videosAwaitingTranscription} />
                          </tr>
                          <tr style={{ borderTop: `1px solid ${SECTION_BRAND.border}` }}>
                            <PipelineCell label="Blog drafts" value={payload.pipeline.blogsInDraft} />
                            <td width="50%" />
                          </tr>
                        </tbody>
                      </table>
                    </Section>

                    {payload.revenueFunnel && (
                      <Section title="Revenue & funnel — yesterday">
                        <ul style={{ margin: 0, paddingLeft: "18px", fontFamily: "'Lexend Deca', sans-serif", fontSize: "14px", color: BRAND.textPrimary, lineHeight: 1.7 }}>
                          {payload.revenueFunnel.newOrders > 0 && (
                            <li>{payload.revenueFunnel.newOrders} new order{payload.revenueFunnel.newOrders === 1 ? "" : "s"} (${(payload.revenueFunnel.orderRevenueCents / 100).toFixed(2)})</li>
                          )}
                          {(payload.revenueFunnel.newSubs > 0 || payload.revenueFunnel.cancelledSubs > 0) && (
                            <li>+{payload.revenueFunnel.newSubs} / −{payload.revenueFunnel.cancelledSubs} subs</li>
                          )}
                          {payload.revenueFunnel.newsletterNetDelta !== 0 && (
                            <li>{payload.revenueFunnel.newsletterNetDelta > 0 ? "+" : ""}{payload.revenueFunnel.newsletterNetDelta} newsletter</li>
                          )}
                          {payload.revenueFunnel.adSpendCents > 0 && (
                            <li>
                              Ads: ${(payload.revenueFunnel.adSpendCents / 100).toFixed(2)} spend ·
                              {" "}{payload.revenueFunnel.adConversions} conv
                              {payload.revenueFunnel.adCplCents != null && (
                                <> · ${(payload.revenueFunnel.adCplCents / 100).toFixed(2)} CPL</>
                              )}
                            </li>
                          )}
                        </ul>
                      </Section>
                    )}

                    {payload.anomalies && (
                      <Section title="Anomalies">
                        <ul style={{ margin: 0, paddingLeft: "18px", fontFamily: "'Lexend Deca', sans-serif", fontSize: "14px", color: BRAND.warning, lineHeight: 1.7 }}>
                          {payload.anomalies.flags.map((f, i) => (
                            <li key={i}><strong>{f.label}:</strong> <span style={{ color: BRAND.textPrimary }}>{f.detail}</span></li>
                          ))}
                        </ul>
                      </Section>
                    )}

                    {payload.isMondayEdition && payload.trendingTopics.length > 0 && (
                      <Section title="Trending this week">
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                          <tbody>
                            {payload.trendingTopics.slice(0, 5).map((topic, i) => (
                              <tr key={i}>
                                <td style={{ padding: "12px 0", borderBottom: `1px solid ${BRAND.border}` }}>
                                  <p style={{ margin: 0, fontFamily: "'Lexend Deca', sans-serif", fontSize: "14px", fontWeight: 600, color: BRAND.textPrimary }}>{topic.title}</p>
                                  <p style={{ margin: "4px 0 0", fontFamily: "'Lexend Deca', sans-serif", fontSize: "13px", color: BRAND.textMuted, lineHeight: 1.5 }}>{topic.summary}</p>
                                  {topic.sourceUrl && (
                                    <p style={{ margin: "4px 0 0", fontFamily: "'Lexend Deca', sans-serif", fontSize: "12px" }}>
                                      <a href={topic.sourceUrl} style={{ color: BRAND.accent, textDecoration: "underline" }}>source</a>
                                    </p>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Section>
                    )}

                    {/* CTA */}
                    <tr>
                      <td align="center" style={{ padding: "32px 48px 40px" }}>
                        <a href={payload.dashboardUrl} style={{ display: "inline-block", padding: "14px 32px", fontFamily: "'Lexend Exa', Georgia, serif", fontSize: "12px", fontWeight: 600, color: "#ffffff", backgroundColor: BRAND.primary, textDecoration: "none", textTransform: "uppercase", letterSpacing: "2px", borderRadius: "2px" }}>Open dashboard</a>
                      </td>
                    </tr>
                    {/* Footer */}
                    <tr>
                      <td style={{ borderTop: `1px solid ${BRAND.border}`, padding: "20px 48px", textAlign: "center", fontFamily: "'Lexend Deca', sans-serif", fontSize: "11px", color: BRAND.textSubtle }}>
                        Auto-generated weekday mornings. Pause the schedule any time.
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

function PipelineCell({ label, value }: { label: string; value: number }) {
  return (
    <td width="50%" style={{ padding: "14px 16px", verticalAlign: "top", borderRight: `1px solid ${SECTION_BRAND.border}` }}>
      <p style={{ margin: 0, fontFamily: "'Lexend Deca', sans-serif", fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "1px" }}>{label}</p>
      <p style={{ margin: "6px 0 0", fontFamily: "'Lexend Exa', Georgia, serif", fontSize: "24px", fontWeight: 600, color: SECTION_BRAND.primary }}>{value}</p>
    </td>
  )
}

export type { DailyBriefPayload as DailyPulsePayload } from "@/types/coach-emails"
