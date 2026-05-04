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
 * One-shot account discovery used during the OAuth callback. Calls the Google
 * Ads `CustomerService.listAccessibleCustomers` RPC with the freshly-issued
 * refresh token (before it's persisted) and returns the Customer IDs the user
 * authorized us to read. Descriptive metadata is left null — Phase 1.1 only
 * needs the IDs to land in `google_ads_accounts`; the nightly sync fills in
 * descriptive_name / currency / timezone from the Customer resource.
 *
 * Requires `GOOGLE_ADS_DEVELOPER_TOKEN` to be set; without it Google rejects
 * the call. If the token is missing we fall back to returning an empty list so
 * the OAuth round-trip still completes during dev (the admin can re-discover
 * accounts after the token is provisioned).
 */
export async function listAccessibleCustomers(
  refresh_token: string,
): Promise<AccessibleCustomerSummary[]> {
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    return []
  }
  const api = new GoogleAdsApi(getConfig())
  const response = await api.listAccessibleCustomers(refresh_token)
  const resourceNames = response.resource_names ?? []
  return resourceNames.map((rn: string) => ({
    customer_id: rn.replace("customers/", ""),
    descriptive_name: null,
    currency_code: null,
    time_zone: null,
  }))
}
