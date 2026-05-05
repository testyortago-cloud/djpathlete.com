// lib/analytics/ga4-data.ts
// Server-only wrapper around the Google Analytics Data API v1 (Beta).
// Soft-skips when creds are missing so admin pages can render an empty
// state with a setup checklist (mirrors the GOOGLE_ADS_DEVELOPER_TOKEN
// pattern in lib/ads/*).
//
// Auth: a service-account JSON, base64-encoded into GA4_SERVICE_ACCOUNT_JSON
// (single-line, Vercel-friendly). The service account email must be added
// as a Viewer on the GA4 property in Admin → Property access management.
import "server-only"
import { BetaAnalyticsDataClient } from "@google-analytics/data"

let cachedClient: BetaAnalyticsDataClient | null = null

export class Ga4NotConfiguredError extends Error {
  constructor() {
    super("GA4 Data API is not configured (GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT_JSON required).")
    this.name = "Ga4NotConfiguredError"
  }
}

export function ga4IsConfigured(): boolean {
  return Boolean(process.env.GA4_PROPERTY_ID && process.env.GA4_SERVICE_ACCOUNT_JSON)
}

export function getGa4ServiceAccountEmail(): string | null {
  const raw = process.env.GA4_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try {
    const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")
    const parsed = JSON.parse(json) as { client_email?: string }
    return parsed.client_email ?? null
  } catch {
    return null
  }
}

function getClient(): BetaAnalyticsDataClient {
  if (!ga4IsConfigured()) throw new Ga4NotConfiguredError()
  if (cachedClient) return cachedClient

  const raw = process.env.GA4_SERVICE_ACCOUNT_JSON!
  // Accept either raw JSON or base64-encoded JSON.
  const json = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8")
  const credentials = JSON.parse(json) as { client_email: string; private_key: string }

  cachedClient = new BetaAnalyticsDataClient({ credentials })
  return cachedClient
}

function propertyPath(): string {
  return `properties/${process.env.GA4_PROPERTY_ID}`
}

export interface Ga4DateRange {
  startDate: string // YYYY-MM-DD or NdaysAgo / today / yesterday
  endDate: string
}

export interface Ga4OverviewMetrics {
  sessions: number
  totalUsers: number
  newUsers: number
  engagedSessions: number
  averageSessionDurationSec: number
  conversions: number
  range: Ga4DateRange
}

export async function getOverviewMetrics(
  range: Ga4DateRange = { startDate: "28daysAgo", endDate: "today" },
): Promise<Ga4OverviewMetrics> {
  const client = getClient()
  const [resp] = await client.runReport({
    property: propertyPath(),
    dateRanges: [range],
    metrics: [
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "newUsers" },
      { name: "engagedSessions" },
      { name: "averageSessionDuration" },
      { name: "conversions" },
    ],
  })

  const row = resp.rows?.[0]
  const v = (i: number) => Number(row?.metricValues?.[i]?.value ?? 0)

  return {
    sessions: v(0),
    totalUsers: v(1),
    newUsers: v(2),
    engagedSessions: v(3),
    averageSessionDurationSec: v(4),
    conversions: v(5),
    range,
  }
}

export interface Ga4ChannelRow {
  channel: string
  sessions: number
  totalUsers: number
  conversions: number
}

export async function getTrafficByChannel(
  range: Ga4DateRange = { startDate: "28daysAgo", endDate: "today" },
  limit = 20,
): Promise<Ga4ChannelRow[]> {
  const client = getClient()
  const [resp] = await client.runReport({
    property: propertyPath(),
    dateRanges: [range],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "conversions" },
    ],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: String(limit) as unknown as number,
  })

  return (resp.rows ?? []).map((r) => ({
    channel: r.dimensionValues?.[0]?.value ?? "(not set)",
    sessions: Number(r.metricValues?.[0]?.value ?? 0),
    totalUsers: Number(r.metricValues?.[1]?.value ?? 0),
    conversions: Number(r.metricValues?.[2]?.value ?? 0),
  }))
}

export interface Ga4PageRow {
  path: string
  title: string
  views: number
  users: number
  averageEngagementTimeSec: number
}

export async function getTopPages(
  range: Ga4DateRange = { startDate: "28daysAgo", endDate: "today" },
  limit = 25,
): Promise<Ga4PageRow[]> {
  const client = getClient()
  const [resp] = await client.runReport({
    property: propertyPath(),
    dateRanges: [range],
    dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
    metrics: [
      { name: "screenPageViews" },
      { name: "totalUsers" },
      { name: "userEngagementDuration" },
    ],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit: String(limit) as unknown as number,
  })

  return (resp.rows ?? []).map((r) => {
    const users = Number(r.metricValues?.[1]?.value ?? 0)
    const engagementSec = Number(r.metricValues?.[2]?.value ?? 0)
    return {
      path: r.dimensionValues?.[0]?.value ?? "/",
      title: r.dimensionValues?.[1]?.value ?? "",
      views: Number(r.metricValues?.[0]?.value ?? 0),
      users,
      averageEngagementTimeSec: users > 0 ? engagementSec / users : 0,
    }
  })
}

export interface Ga4EventRow {
  eventName: string
  count: number
  users: number
}

export async function getTopEvents(
  range: Ga4DateRange = { startDate: "28daysAgo", endDate: "today" },
  limit = 25,
): Promise<Ga4EventRow[]> {
  const client = getClient()
  const [resp] = await client.runReport({
    property: propertyPath(),
    dateRanges: [range],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: String(limit) as unknown as number,
  })

  return (resp.rows ?? []).map((r) => ({
    eventName: r.dimensionValues?.[0]?.value ?? "(unknown)",
    count: Number(r.metricValues?.[0]?.value ?? 0),
    users: Number(r.metricValues?.[1]?.value ?? 0),
  }))
}
