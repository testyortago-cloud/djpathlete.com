// functions/src/send-weekly-content-report.ts
// Weekly scheduled Firebase Function (Fri 17:00 America/Chicago). Hits the
// Next.js internal route which composes + sends the Weekly Content Report.
//
// The onSchedule wrapper lives in functions/src/index.ts so this file can be
// imported and unit-tested as a pure function.

export interface RunSendWeeklyReportOptions {
  fetchImpl?: typeof fetch
  internalToken?: string
  appUrl?: string
}

export interface SendWeeklyReportResult {
  ok: true
  sentTo: string
  subject: string
  rangeStart: string
  rangeEnd: string
}

/**
 * Fires one weekly report send. Throws on non-200 so Cloud Scheduler shows
 * the failure — the admin can re-run the route manually.
 */
export async function runSendWeeklyContentReport(
  options: RunSendWeeklyReportOptions = {},
): Promise<SendWeeklyReportResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const internalToken = options.internalToken ?? process.env.INTERNAL_CRON_TOKEN ?? ""
  const appUrl = options.appUrl ?? process.env.APP_URL ?? ""

  if (!internalToken) throw new Error("INTERNAL_CRON_TOKEN is not configured")
  if (!appUrl) throw new Error("APP_URL is not configured")

  const endpoint = `${appUrl.replace(/\/$/, "")}/api/admin/internal/send-weekly-report`
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${internalToken}`,
    },
    body: "{}",
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Weekly report route returned ${res.status}: ${text.slice(0, 300)}`)
  }

  return (await res.json()) as SendWeeklyReportResult
}
