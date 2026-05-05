// lib/ads/google-ads-client.ts
// Thin wrapper over the `google-ads-api` SDK. Phase 1.1 (OAuth slice) only
// uses the discovery method `listAccessibleCustomers` and a customer-scoped
// client builder for later phases. GAQL queries land in Plan 1.1 sync work.

import { GoogleAdsApi, type Customer } from "google-ads-api"
import { getPlatformConnection } from "@/lib/db/platform-connections"

interface GoogleAdsConfig {
  developer_token: string
  client_id: string
  client_secret: string
}

function getConfig(): GoogleAdsConfig {
  const developer_token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  const client_id = process.env.GOOGLE_ADS_CLIENT_ID
  const client_secret = process.env.GOOGLE_ADS_CLIENT_SECRET
  if (!developer_token || !client_id || !client_secret) {
    throw new Error(
      "Google Ads env vars missing (GOOGLE_ADS_DEVELOPER_TOKEN/CLIENT_ID/CLIENT_SECRET)",
    )
  }
  return { developer_token, client_id, client_secret }
}

let _client: GoogleAdsApi | null = null

function getClient(): GoogleAdsApi {
  if (!_client) {
    _client = new GoogleAdsApi(getConfig())
  }
  return _client
}

export async function getCustomerClient(customerId: string): Promise<Customer> {
  const conn = await getPlatformConnection("google_ads")
  const refresh_token = conn?.credentials?.refresh_token as string | undefined
  if (!refresh_token) {
    throw new Error("Google Ads not connected (no refresh_token in platform_connections)")
  }
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  return getClient().Customer({
    customer_id: customerId,
    refresh_token,
    ...(loginCustomerId ? { login_customer_id: loginCustomerId } : {}),
  })
}

export interface AccessibleCustomerSummary {
  customer_id: string
  descriptive_name: string | null
  currency_code: string | null
  time_zone: string | null
}

/**
 * One-shot account discovery used during the OAuth callback. Returns the
 * Customer IDs the user authorized us to read. Descriptive metadata is left
 * null — Phase 1.1 only needs the IDs to land in `google_ads_accounts`; the
 * nightly sync fills in descriptive_name / currency / timezone separately.
 *
 * Implementation note: uses the Google Ads REST endpoint via plain fetch
 * rather than the `google-ads-api` SDK. The SDK is gRPC-based and breaks on
 * Vercel ("Channel credentials must be a ChannelCredentials object") because
 * Webpack-bundled lambdas end up with a duplicated `@grpc/grpc-js`, which
 * fails an internal `instanceof ChannelCredentials` check. REST has none of
 * that machinery.
 *
 * Requires `GOOGLE_ADS_DEVELOPER_TOKEN`; without it Google rejects the call.
 * If the token is missing we return an empty list so the OAuth round-trip
 * still completes during dev (the admin can re-discover accounts later).
 */
const GOOGLE_ADS_API_VERSION = "v21"

async function refreshAccessToken(refresh_token: string): Promise<string> {
  const cfg = getConfig()
  const params = new URLSearchParams({
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
    refresh_token,
    grant_type: "refresh_token",
  })
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`OAuth refresh failed: HTTP ${res.status} ${text.slice(0, 300)}`)
  }
  const json = JSON.parse(text) as { access_token?: string }
  if (!json.access_token) {
    throw new Error("OAuth refresh response missing access_token")
  }
  return json.access_token
}

export async function listAccessibleCustomers(
  refresh_token: string,
): Promise<AccessibleCustomerSummary[]> {
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    return []
  }
  const developer_token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  const access_token = await refreshAccessToken(refresh_token)

  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`
  const res = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${access_token}`,
      "developer-token": developer_token,
    },
  })
  const body = await res.text()
  if (!res.ok) {
    throw new Error(
      `listAccessibleCustomers failed: HTTP ${res.status} ${body.slice(0, 500)}`,
    )
  }
  let parsed: { resourceNames?: string[] }
  try {
    parsed = JSON.parse(body) as { resourceNames?: string[] }
  } catch {
    throw new Error(`listAccessibleCustomers: invalid JSON response: ${body.slice(0, 200)}`)
  }
  const resourceNames = parsed.resourceNames ?? []
  return resourceNames.map((rn: string) => ({
    customer_id: rn.replace("customers/", ""),
    descriptive_name: null,
    currency_code: null,
    time_zone: null,
  }))
}
