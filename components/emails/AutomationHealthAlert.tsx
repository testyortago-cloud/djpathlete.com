// components/emails/AutomationHealthAlert.tsx
// Plain alert email — only sent when scanner returns alert_severity='critical'.

import type { SilentCron } from "@/lib/automation/automation-health-scanner"

interface Props {
  severity: "warning" | "critical"
  summary: string
  ai_jobs_failed_24h: Record<string, number>
  ai_jobs_pending_over_1h: number
  silent_crons: SilentCron[]
  dashboardUrl: string
}

const BRAND = {
  primary: "#0E3F50",
  warning: "#b91c1c",
  textMuted: "#6b7280",
  border: "#e8e5e0",
  neutral: "#edece8",
} as const

export function AutomationHealthAlert({
  severity,
  summary,
  ai_jobs_failed_24h,
  ai_jobs_pending_over_1h,
  silent_crons,
  dashboardUrl,
}: Props) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>{`Automation health — ${severity}`}</title>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: BRAND.neutral }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: "48px 16px" }}>
                <table role="presentation" width="600" cellPadding={0} cellSpacing={0} border={0} style={{ maxWidth: "600px", width: "100%", backgroundColor: "#ffffff" }}>
                  <tbody>
                    <tr>
                      <td style={{ backgroundColor: BRAND.warning, padding: "24px 32px" }}>
                        <p style={{ margin: 0, fontFamily: "'Lexend Exa', Georgia, serif", fontSize: "11px", color: "#fff", letterSpacing: "4px", textTransform: "uppercase" }}>
                          Automation Health — {severity.toUpperCase()}
                        </p>
                        <h1 style={{ margin: "10px 0 0", color: "#fff", fontFamily: "'Lexend Exa', Georgia, serif", fontSize: "18px" }}>{summary}</h1>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "24px 32px" }}>
                        <h2 style={{ margin: "0 0 8px", color: BRAND.primary, fontFamily: "'Lexend Exa', Georgia, serif", fontSize: "13px", textTransform: "uppercase", letterSpacing: "1.5px" }}>AI jobs</h2>
                        <p style={{ margin: 0, fontFamily: "'Lexend Deca', sans-serif", fontSize: "14px", color: BRAND.primary }}>Pending &gt;1h: <strong>{ai_jobs_pending_over_1h}</strong></p>
                        {Object.keys(ai_jobs_failed_24h).length > 0 && (
                          <ul style={{ margin: "8px 0 0 16px", padding: 0, fontFamily: "'Lexend Deca', sans-serif", fontSize: "14px", color: BRAND.primary }}>
                            {Object.entries(ai_jobs_failed_24h).map(([type, count]) => (
                              <li key={type}><code>{type}</code>: <strong>{count}</strong> failures in 24h</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                    {silent_crons.length > 0 && (
                      <tr>
                        <td style={{ padding: "0 32px 24px" }}>
                          <h2 style={{ margin: "0 0 8px", color: BRAND.primary, fontFamily: "'Lexend Exa', Georgia, serif", fontSize: "13px", textTransform: "uppercase", letterSpacing: "1.5px" }}>Silent crons</h2>
                          <ul style={{ margin: 0, paddingLeft: "16px", fontFamily: "'Lexend Deca', sans-serif", fontSize: "14px", color: BRAND.primary }}>
                            {/* "last success 800h ago" about a cron that has
                                never succeeded once reads as a cron that used
                                to work — the opposite of the truth, and the
                                wrong repair. Match the summary's wording. */}
                            {silent_crons.map((sc) => (
                              <li key={sc.cron_name}>
                                <code>{sc.cron_name}</code> ·{" "}
                                {sc.last_success_at !== null
                                  ? `last success ${Math.round(sc.hours_since)}h ago (SLA ${sc.sla_hours}h)`
                                  : sc.last_failure_at
                                    ? "has never succeeded — its last run failed"
                                    : `has never succeeded in ${Math.round(sc.hours_since)}h of watching (SLA ${sc.sla_hours}h)`}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td align="center" style={{ padding: "16px 32px 32px" }}>
                        <a href={dashboardUrl} style={{ display: "inline-block", padding: "12px 28px", fontFamily: "'Lexend Exa', Georgia, serif", fontSize: "12px", color: "#fff", backgroundColor: BRAND.primary, textDecoration: "none", textTransform: "uppercase", letterSpacing: "2px" }}>Open health board</a>
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
