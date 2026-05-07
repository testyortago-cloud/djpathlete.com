import { Section } from "./_shared/Section"
import type { WeeklyReviewPayload } from "@/types/coach-emails"

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
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString("en-US")
}

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function fmtWeekOf(d: Date): string {
  return `Week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
}

function fmtDollars(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`
}

function fmtDollarsExact(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function pctChange(current: number, previous: number): { label: string; color: string } | null {
  if (previous === 0) return null
  const delta = ((current - previous) / previous) * 100
  const rounded = Math.round(delta * 10) / 10
  if (rounded === 0) return { label: "no change", color: BRAND.textSubtle }
  const sign = rounded > 0 ? "+" : ""
  return {
    label: `${sign}${rounded}% vs prev week`,
    color: rounded >= 0 ? BRAND.success : BRAND.error,
  }
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
      width="50%"
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
          fontSize: "28px",
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

function DeltaRow({
  label,
  current,
  previous,
  formatter = String,
}: {
  label: string
  current: number
  previous: number
  formatter?: (n: number) => string
}) {
  const trend = pctChange(current, previous)
  return (
    <tr>
      <td
        style={{
          padding: "8px 0",
          borderBottom: `1px solid ${BRAND.border}`,
          fontFamily: "'Lexend Deca', -apple-system, sans-serif",
          fontSize: "13px",
          color: BRAND.textMuted,
        }}
      >
        {label}
      </td>
      <td
        align="right"
        style={{
          padding: "8px 0",
          borderBottom: `1px solid ${BRAND.border}`,
          fontFamily: "'Lexend Deca', -apple-system, sans-serif",
          fontSize: "13px",
          color: BRAND.primary,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        {formatter(current)}
        {trend && (
          <span style={{ marginLeft: "8px", fontWeight: 400, fontSize: "11px", color: trend.color }}>
            {trend.label}
          </span>
        )}
      </td>
    </tr>
  )
}

interface Props {
  payload: WeeklyReviewPayload
}

export function WeeklyContentReport({ payload }: Props) {
  const { rangeStart, rangeEnd, topOfMind, coaching, revenue, funnel, social, content, opsHealth, dashboardUrl } = payload

  const oneLineSummary = `${social.publishedPosts} ${social.publishedPosts === 1 ? "post" : "posts"} published · ${fmtNumber(social.totalEngagement)} engagement · ${content.blogsPublished} ${content.blogsPublished === 1 ? "blog" : "blogs"} shipped`

  const flaggedBlogs = content.blogsByFactCheckStatus.filter((row) => row.label === "Flagged" || row.label === "Failed")

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Weekly Review — DJP Athlete</title>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: BRAND.neutral }}>
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          style={{ backgroundColor: BRAND.neutral }}
        >
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
                              <td align="center" style={{ padding: "36px 48px 28px" }}>
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
                                  Weekly Review
                                </p>
                                <h1
                                  style={{
                                    margin: "12px 0 0",
                                    fontFamily: "'Lexend Exa', Georgia, serif",
                                    fontSize: "22px",
                                    fontWeight: 600,
                                    color: "#ffffff",
                                    letterSpacing: "2px",
                                  }}
                                >
                                  {fmtWeekOf(rangeStart)}
                                </h1>
                                <p
                                  style={{
                                    margin: "8px 0 0",
                                    fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                    fontSize: "12px",
                                    color: "rgba(255,255,255,0.75)",
                                  }}
                                >
                                  {fmtDateShort(rangeStart)} — {fmtDateShort(rangeEnd)}
                                </p>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* Hero summary line */}
                    <tr>
                      <td style={{ padding: "28px 48px 8px" }}>
                        <p
                          style={{
                            margin: 0,
                            fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                            fontSize: "15px",
                            color: BRAND.textPrimary,
                            lineHeight: 1.5,
                          }}
                        >
                          {oneLineSummary}.
                        </p>
                      </td>
                    </tr>

                    {/* Top of mind (always renders) */}
                    <Section title="Top of mind">
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: "18px",
                          fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                          fontSize: "14px",
                          color: BRAND.textPrimary,
                          lineHeight: 1.8,
                        }}
                      >
                        {topOfMind.map((bullet, i) => (
                          <li
                            key={i}
                            style={{
                              color:
                                bullet.positive === true
                                  ? BRAND.success
                                  : bullet.positive === false
                                    ? BRAND.error
                                    : BRAND.textPrimary,
                            }}
                          >
                            {bullet.text}
                          </li>
                        ))}
                      </ul>
                    </Section>

                    {/* Coaching (conditional) */}
                    {coaching && (
                      <Section title="Coaching">
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                          <tbody>
                            <DeltaRow
                              label="Active clients"
                              current={coaching.activeClients.current}
                              previous={coaching.activeClients.previous}
                            />
                            <DeltaRow
                              label="Sessions completed"
                              current={coaching.sessionsCompleted.current}
                              previous={coaching.sessionsCompleted.previous}
                            />
                            <DeltaRow
                              label="Program completion rate"
                              current={coaching.programCompletionRatePct.current}
                              previous={coaching.programCompletionRatePct.previous}
                              formatter={(n) => `${n}%`}
                            />
                            <DeltaRow
                              label="Form reviews delivered"
                              current={coaching.formReviewsDelivered.current}
                              previous={coaching.formReviewsDelivered.previous}
                            />
                            <DeltaRow
                              label="Avg review response time"
                              current={coaching.avgFormReviewResponseHours.current}
                              previous={coaching.avgFormReviewResponseHours.previous}
                              formatter={(n) => `${n}h`}
                            />
                            {coaching.silentClients > 0 && (
                              <tr>
                                <td
                                  colSpan={2}
                                  style={{
                                    padding: "8px 0",
                                    fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                    fontSize: "13px",
                                    color: BRAND.error,
                                  }}
                                >
                                  {coaching.silentClients} client{coaching.silentClients === 1 ? "" : "s"} gone silent (14+ days without a log)
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </Section>
                    )}

                    {/* Revenue (conditional) */}
                    {revenue && (
                      <Section title="Revenue">
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                          <tbody>
                            <DeltaRow
                              label="MRR"
                              current={revenue.mrrCents.current}
                              previous={revenue.mrrCents.previous}
                              formatter={fmtDollars}
                            />
                            <DeltaRow
                              label="New subscriptions"
                              current={revenue.newSubs.current}
                              previous={revenue.newSubs.previous}
                            />
                            <DeltaRow
                              label="Cancelled subscriptions"
                              current={revenue.cancelledSubs.current}
                              previous={revenue.cancelledSubs.previous}
                            />
                            <DeltaRow
                              label="Renewals"
                              current={revenue.renewedSubs.current}
                              previous={revenue.renewedSubs.previous}
                            />
                            <DeltaRow
                              label="Shop revenue"
                              current={revenue.shopRevenueCents.current}
                              previous={revenue.shopRevenueCents.previous}
                              formatter={fmtDollars}
                            />
                            <DeltaRow
                              label="Refunds"
                              current={revenue.refundsCents.current}
                              previous={revenue.refundsCents.previous}
                              formatter={fmtDollars}
                            />
                          </tbody>
                        </table>
                      </Section>
                    )}

                    {/* Lead funnel (conditional) */}
                    {funnel && (
                      <Section title="Lead funnel">
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                          <tbody>
                            <DeltaRow
                              label="Newsletter net new"
                              current={funnel.newsletterNetDelta.current}
                              previous={funnel.newsletterNetDelta.previous}
                            />
                            <DeltaRow
                              label="Shop leads"
                              current={funnel.shopLeads.current}
                              previous={funnel.shopLeads.previous}
                            />
                            <DeltaRow
                              label="Ad spend"
                              current={funnel.adSpendCents.current}
                              previous={funnel.adSpendCents.previous}
                              formatter={fmtDollarsExact}
                            />
                            <DeltaRow
                              label="Ad conversions"
                              current={funnel.adConversions.current}
                              previous={funnel.adConversions.previous}
                            />
                            <DeltaRow
                              label="Ad CPL"
                              current={funnel.adCplCents.current}
                              previous={funnel.adCplCents.previous}
                              formatter={fmtDollarsExact}
                            />
                            {funnel.topCampaign && (
                              <tr>
                                <td
                                  colSpan={2}
                                  style={{
                                    padding: "8px 0",
                                    fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                    fontSize: "13px",
                                    color: BRAND.textMuted,
                                    fontStyle: "italic",
                                  }}
                                >
                                  Top campaign: {funnel.topCampaign.name} — {funnel.topCampaign.conversions} conv · {fmtDollarsExact(funnel.topCampaign.cpl)} CPL
                                </td>
                              </tr>
                            )}
                            {funnel.attributionBySource.length > 0 && (
                              <tr>
                                <td
                                  colSpan={2}
                                  style={{
                                    padding: "8px 0 0",
                                    fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                    fontSize: "13px",
                                    color: BRAND.textMuted,
                                  }}
                                >
                                  By source:{" "}
                                  {funnel.attributionBySource
                                    .map((s) => `${s.source} (${s.count})`)
                                    .join(" · ")}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </Section>
                    )}

                    {/* Content performance (always renders — existing social/blog/newsletter blocks) */}
                    <Section title="Social at a glance">
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
                            <Stat
                              label="Posts created"
                              value={fmtNumber(social.totalPosts)}
                              trend={pctChange(social.totalPosts, social.previousTotalPosts)}
                            />
                            <Stat
                              label="Posts published"
                              value={fmtNumber(social.publishedPosts)}
                              trend={pctChange(social.publishedPosts, social.previousPublishedPosts)}
                            />
                          </tr>
                          <tr style={{ borderTop: `1px solid ${BRAND.border}` }}>
                            <Stat label="Impressions" value={fmtNumber(social.totalImpressions)} trend={null} />
                            <Stat label="Engagement" value={fmtNumber(social.totalEngagement)} trend={null} />
                          </tr>
                        </tbody>
                      </table>
                    </Section>

                    {/* Top posts */}
                    <Section title="Top posts by engagement">
                      {social.topPostsByEngagement.length === 0 ? (
                        <p
                          style={{
                            margin: 0,
                            fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                            fontSize: "13px",
                            color: BRAND.textMuted,
                            fontStyle: "italic",
                          }}
                        >
                          No engagement data this week yet.
                        </p>
                      ) : (
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                          <tbody>
                            {social.topPostsByEngagement.slice(0, 5).map((post) => (
                              <tr key={post.social_post_id}>
                                <td
                                  style={{
                                    padding: "10px 0",
                                    borderBottom: `1px solid ${BRAND.border}`,
                                    fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                    fontSize: "13px",
                                    color: BRAND.textPrimary,
                                  }}
                                >
                                  <span
                                    style={{
                                      display: "inline-block",
                                      marginRight: "8px",
                                      fontSize: "11px",
                                      color: BRAND.accent,
                                      textTransform: "uppercase",
                                      letterSpacing: "1px",
                                    }}
                                  >
                                    {post.platform}
                                  </span>
                                  {post.content_preview}
                                </td>
                                <td
                                  align="right"
                                  style={{
                                    padding: "10px 0",
                                    borderBottom: `1px solid ${BRAND.border}`,
                                    fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                    fontSize: "13px",
                                    color: BRAND.primary,
                                    fontWeight: 600,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {fmtNumber(post.engagement)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </Section>

                    {/* Platform breakdown */}
                    <Section title="Platform breakdown">
                      {social.postsByPlatform.length === 0 ? (
                        <p
                          style={{
                            margin: 0,
                            fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                            fontSize: "13px",
                            color: BRAND.textMuted,
                            fontStyle: "italic",
                          }}
                        >
                          No posts published this week.
                        </p>
                      ) : (
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                          <tbody>
                            {social.postsByPlatform.map((row) => (
                              <tr key={row.label}>
                                <td
                                  style={{
                                    padding: "6px 0",
                                    fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                    fontSize: "13px",
                                    color: BRAND.textPrimary,
                                  }}
                                >
                                  {row.label}
                                </td>
                                <td
                                  align="right"
                                  style={{
                                    padding: "6px 0",
                                    fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                    fontSize: "13px",
                                    color: BRAND.primary,
                                    fontWeight: 600,
                                  }}
                                >
                                  {row.count}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </Section>

                    {/* Content shipped */}
                    <Section title="Content shipped">
                      <p
                        style={{
                          margin: "0 0 12px",
                          fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                          fontSize: "13px",
                          color: BRAND.textPrimary,
                        }}
                      >
                        <strong>{content.blogsPublished}</strong>{" "}
                        {content.blogsPublished === 1 ? "blog" : "blogs"} published ·{" "}
                        <strong>{content.newslettersSent}</strong>{" "}
                        {content.newslettersSent === 1 ? "newsletter" : "newsletters"} sent ·{" "}
                        <strong>{fmtNumber(content.activeSubscribers)}</strong> active subscribers
                      </p>
                      {content.recentPublishes.length > 0 && (
                        <ul
                          style={{
                            margin: 0,
                            padding: "0 0 0 18px",
                            fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                            fontSize: "13px",
                            color: BRAND.textPrimary,
                            lineHeight: 1.7,
                          }}
                        >
                          {content.recentPublishes.slice(0, 5).map((blog) => (
                            <li key={blog.id}>
                              {blog.title}{" "}
                              <span style={{ color: BRAND.textMuted }}>· {blog.category}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Section>

                    {/* Fact-check flags */}
                    {flaggedBlogs.length > 0 && (
                      <Section title="Fact-check needs attention">
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                          <tbody>
                            {flaggedBlogs.map((row) => (
                              <tr key={row.label}>
                                <td
                                  style={{
                                    padding: "6px 0",
                                    fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                    fontSize: "13px",
                                    color: BRAND.error,
                                  }}
                                >
                                  {row.label}
                                </td>
                                <td
                                  align="right"
                                  style={{
                                    padding: "6px 0",
                                    fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                    fontSize: "13px",
                                    color: BRAND.error,
                                    fontWeight: 600,
                                  }}
                                >
                                  {row.count}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Section>
                    )}

                    {/* Ops health (conditional) */}
                    {opsHealth && (
                      <Section title="Ops health">
                        <ul
                          style={{
                            margin: 0,
                            paddingLeft: "18px",
                            fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                            fontSize: "13px",
                            color: BRAND.error,
                            lineHeight: 1.8,
                          }}
                        >
                          {opsHealth.aiTokenSpendUsd != null && (
                            <li>
                              AI token spend: ${opsHealth.aiTokenSpendUsd.toFixed(2)} (above expected band)
                            </li>
                          )}
                          {opsHealth.generationFailureRatePct != null && (
                            <li>
                              Generation failure rate: {opsHealth.generationFailureRatePct.toFixed(1)}%
                            </li>
                          )}
                          {opsHealth.voiceDriftFlagCount > 0 && (
                            <li style={{ color: BRAND.textPrimary }}>
                              {opsHealth.voiceDriftFlagCount} voice-drift flag{opsHealth.voiceDriftFlagCount === 1 ? "" : "s"} this week
                            </li>
                          )}
                          {opsHealth.cronSkipCount > 0 && (
                            <li style={{ color: BRAND.textPrimary }}>
                              {opsHealth.cronSkipCount} cron skip{opsHealth.cronSkipCount === 1 ? "" : "s"} this week
                            </li>
                          )}
                        </ul>
                      </Section>
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
                          Open dashboard
                        </a>
                      </td>
                    </tr>

                    {/* Footer */}
                    <tr>
                      <td
                        style={{
                          borderTop: `1px solid ${BRAND.border}`,
                          padding: "20px 48px",
                          textAlign: "center",
                          fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                          fontSize: "11px",
                          color: BRAND.textSubtle,
                        }}
                      >
                        Auto-generated weekly — reply to this email with feedback, or tweak the schedule in the admin.
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
