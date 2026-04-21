import type { SocialMetrics, ContentMetrics } from "@/types/analytics"

interface Props {
  social: SocialMetrics
  content: ContentMetrics
  rangeStart: Date
  rangeEnd: Date
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

function SectionHeading({ children }: { children: string }) {
  return (
    <h2
      style={{
        margin: "0 0 16px",
        fontFamily: "'Lexend Exa', Georgia, serif",
        fontSize: "14px",
        color: BRAND.primary,
        textTransform: "uppercase",
        letterSpacing: "2px",
        fontWeight: 600,
      }}
    >
      {children}
    </h2>
  )
}

export function WeeklyContentReport({ social, content, rangeStart, rangeEnd, dashboardUrl }: Props) {
  const oneLineSummary = `${social.publishedPosts} ${social.publishedPosts === 1 ? "post" : "posts"} published · ${fmtNumber(social.totalEngagement)} engagement · ${content.blogsPublished} ${content.blogsPublished === 1 ? "blog" : "blogs"} shipped`

  const flaggedBlogs = content.blogsByFactCheckStatus.filter((row) => row.label === "Flagged" || row.label === "Failed")

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Weekly Content Report — DJP Athlete</title>
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
                                  Weekly Content Report
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

                    {/* Social KPIs */}
                    <tr>
                      <td style={{ padding: "20px 48px 8px" }}>
                        <SectionHeading>Social at a glance</SectionHeading>
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
                      </td>
                    </tr>

                    {/* Top posts */}
                    <tr>
                      <td style={{ padding: "28px 48px 8px" }}>
                        <SectionHeading>Top posts by engagement</SectionHeading>
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
                      </td>
                    </tr>

                    {/* Platform breakdown */}
                    <tr>
                      <td style={{ padding: "28px 48px 8px" }}>
                        <SectionHeading>Platform breakdown</SectionHeading>
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
                      </td>
                    </tr>

                    {/* Content shipped */}
                    <tr>
                      <td style={{ padding: "28px 48px 8px" }}>
                        <SectionHeading>Content shipped</SectionHeading>
                        <p
                          style={{
                            margin: "0 0 12px",
                            fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                            fontSize: "13px",
                            color: BRAND.textPrimary,
                          }}
                        >
                          <strong>{content.blogsPublished}</strong> {content.blogsPublished === 1 ? "blog" : "blogs"}{" "}
                          published · <strong>{content.newslettersSent}</strong>{" "}
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
                                {blog.title} <span style={{ color: BRAND.textMuted }}>· {blog.category}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>

                    {/* Fact-check flags */}
                    {flaggedBlogs.length > 0 && (
                      <tr>
                        <td style={{ padding: "28px 48px 8px" }}>
                          <SectionHeading>Fact-check needs attention</SectionHeading>
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
