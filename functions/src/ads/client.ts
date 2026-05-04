// functions/src/ads/client.ts
// Functions-side wrapper around google-ads-api. Only used by the sync
// orchestrator to build a customer-scoped client from the stored refresh
// token. Configuration comes from Firebase Secrets bound at function
// registration time (see functions/src/index.ts).

import { GoogleAdsApi, type Customer } from "google-ads-api"

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

export function getCustomerClient(
  customerId: string,
  refreshToken: string,
): Customer {
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  return getClient().Customer({
    customer_id: customerId,
    refresh_token: refreshToken,
    ...(loginCustomerId ? { login_customer_id: loginCustomerId } : {}),
  })
}
