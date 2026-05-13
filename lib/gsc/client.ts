// lib/gsc/client.ts
// Thin wrapper around the Search Console API. Reads tokens from
// gsc_properties, refreshes lazily, calls searchAnalytics/query.

import { getGscProperty, updateAccessToken } from "@/lib/db/gsc-properties"
import { refreshAccessToken } from "@/lib/gsc/oauth"

export class OAuthBrokenError extends Error {
  name = "OAuthBrokenError"
}

const REFRESH_THRESHOLD_MS = 60_000 // refresh if token expires within 60s

export async function getValidAccessToken(): Promise<string> {
  const row = await getGscProperty()
  if (!row) throw new Error("Google Search Console is not connected")
  if (
    row.access_token &&
    row.access_token_expires &&
    new Date(row.access_token_expires).getTime() - Date.now() > REFRESH_THRESHOLD_MS
  ) {
    return row.access_token
  }
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing in env")
  }
  const refreshed = await refreshAccessToken({
    refresh_token: row.refresh_token,
    client_id: clientId,
    client_secret: clientSecret,
  })
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
  await updateAccessToken(row.id, refreshed.access_token, expiresAt)
  return refreshed.access_token
}

export interface SearchAnalyticsQueryInput {
  startDate: string
  endDate: string
  dimensions: Array<"query" | "page" | "country" | "device" | "date">
  rowLimit: number
  startRow?: number
}

export interface SearchAnalyticsRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface SearchAnalyticsResponse {
  rows?: SearchAnalyticsRow[]
  responseAggregationType?: string
}

export async function searchAnalyticsQuery(
  input: SearchAnalyticsQueryInput,
): Promise<SearchAnalyticsResponse> {
  const accessToken = await getValidAccessToken()
  const siteUrl = process.env.GSC_SITE_URL
  if (!siteUrl) throw new Error("GSC_SITE_URL missing in env")
  const encodedSite = encodeURIComponent(siteUrl)
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })
  if (res.status === 401) {
    throw new OAuthBrokenError("GSC returned 401 — refresh token may be revoked")
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`GSC API failed: HTTP ${res.status} ${text}`)
  }
  return (await res.json()) as SearchAnalyticsResponse
}
