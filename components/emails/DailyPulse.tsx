export interface DailyPulsePipeline {
  awaitingReview: number
  readyToPublish: number
  scheduledToday: number
  videosAwaitingTranscription: number
  blogsInDraft: number
}

export interface DailyPulseTrendingTopic {
  title: string
  summary: string
  sourceUrl: string | null
}

interface Props {
  referenceDate: Date
  pipeline: DailyPulsePipeline
  trendingTopics: DailyPulseTrendingTopic[]
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
} as const

function fmtDayLong(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function isMonday(d: Date): boolean {
  return d.getDay() === 1
}

function summaryLine(pipeline: DailyPulsePipeline): string {
  const bits: string[] = []
  if (pipeline.awaitingReview > 0) bits.push(`${pipeline.awaitingReview} awaiting review`)
  if (pipeline.readyToPublish > 0) bits.push(`${pipeline.readyToPublish} ready to publish`)
  if (pipeline.videosAwaitingTranscription > 0)
    bits.push(`${pipeline.videosAwaitingTranscription} videos need transcripts`)
  if (pipeline.blogsInDraft > 0) bits.push(`${pipeline.blogsInDraft} blog drafts`)
  if (bits.length === 0) return "Inbox zero on the content pipeline — nice."
  return bits.join(" · ")
}

function Counter({ label, value }: { label: string; value: number }) {
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
    </td>
  )
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h2
      style={{
        margin: "0 0 14px",
        fontFamily: "'Lexend Exa', Georgia, serif",
        fontSize: "13px",
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

export function DailyPulse({ referenceDate, pipeline, trendingTopics, dashboardUrl }: Props) {
  const monday = isMonday(referenceDate)
  const showTrending = monday && trendingTopics.length > 0
  const kicker = monday ? "Weekly kick-off" : "Daily Pulse"

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{kicker} — DJP Athlete</title>
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
                                  {kicker}
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
                                  {fmtDayLong(referenceDate)}
                                </h1>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* Summary line */}
                    <tr>
                      <td style={{ padding: "24px 48px 8px" }}>
                        <p
                          style={{
                            margin: 0,
                            fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                            fontSize: "15px",
                            color: BRAND.textPrimary,
                            lineHeight: 1.5,
                          }}
                        >
                          {summaryLine(pipeline)}.
                        </p>
                      </td>
                    </tr>

                    {/* Pipeline counters */}
                    <tr>
                      <td style={{ padding: "20px 48px 8px" }}>
                        <SectionHeading>Pipeline</SectionHeading>
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
                              <Counter label="Awaiting review" value={pipeline.awaitingReview} />
                              <Counter label="Ready to publish" value={pipeline.readyToPublish} />
                            </tr>
                            <tr style={{ borderTop: `1px solid ${BRAND.border}` }}>
                              <Counter label="Scheduled today" value={pipeline.scheduledToday} />
                              <Counter label="Videos to transcribe" value={pipeline.videosAwaitingTranscription} />
                            </tr>
                            <tr style={{ borderTop: `1px solid ${BRAND.border}` }}>
                              <Counter label="Blog drafts" value={pipeline.blogsInDraft} />
                              <td width="50%" />
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* Monday: trending topics */}
                    {showTrending && (
                      <tr>
                        <td style={{ padding: "28px 48px 8px" }}>
                          <SectionHeading>Trending this week</SectionHeading>
                          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                            <tbody>
                              {trendingTopics.slice(0, 5).map((topic, i) => (
                                <tr key={`${topic.title}-${i}`}>
                                  <td
                                    style={{
                                      padding: "12px 0",
                                      borderBottom: `1px solid ${BRAND.border}`,
                                    }}
                                  >
                                    <p
                                      style={{
                                        margin: 0,
                                        fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                        fontSize: "14px",
                                        fontWeight: 600,
                                        color: BRAND.textPrimary,
                                      }}
                                    >
                                      {topic.title}
                                    </p>
                                    <p
                                      style={{
                                        margin: "4px 0 0",
                                        fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                        fontSize: "13px",
                                        color: BRAND.textMuted,
                                        lineHeight: 1.5,
                                      }}
                                    >
                                      {topic.summary}
                                    </p>
                                    {topic.sourceUrl && (
                                      <p
                                        style={{
                                          margin: "4px 0 0",
                                          fontFamily: "'Lexend Deca', -apple-system, sans-serif",
                                          fontSize: "12px",
                                        }}
                                      >
                                        <a
                                          href={topic.sourceUrl}
                                          style={{
                                            color: BRAND.accent,
                                            textDecoration: "underline",
                                          }}
                                        >
                                          source
                                        </a>
                                      </p>
                                    )}
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
                          Open pipeline
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
