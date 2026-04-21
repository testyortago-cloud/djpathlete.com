// functions/src/send-daily-pulse.ts
// Weekday-morning scheduled Firebase Function. Hits the Next.js internal
// route which composes + sends the Daily Pulse email. Cron defined in
// functions/src/index.ts so this file stays unit-testable as a pure function.

export interface RunSendDailyPulseOptions {
  fetchImpl?: typeof fetch
  internalToken?: string
  appUrl?: string
}

export interface SendDailyPulseResult {
  ok: true
  sentTo: string
  subject: string
  isMondayEdition: boolean
}

export async function runSendDailyPulse(options: RunSendDailyPulseOptions = {}): Promise<SendDailyPulseResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const internalToken = options.internalToken ?? process.env.INTERNAL_CRON_TOKEN ?? ""
  const appUrl = options.appUrl ?? process.env.APP_URL ?? ""

  if (!internalToken) throw new Error("INTERNAL_CRON_TOKEN is not configured")
  if (!appUrl) throw new Error("APP_URL is not configured")

  const endpoint = `${appUrl.replace(/\/$/, "")}/api/admin/internal/send-daily-pulse`
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
    throw new Error(`Daily Pulse route returned ${res.status}: ${text.slice(0, 300)}`)
  }

  return (await res.json()) as SendDailyPulseResult
}
