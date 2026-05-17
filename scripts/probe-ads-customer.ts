// scripts/probe-ads-customer.ts
// One-shot probe: is the configured Google Ads customer a manager (MCC) or a
// client? What's its access path? Designed to disambiguate USER_PERMISSION_DENIED
// from the apply path. Run with:
//   npx tsx scripts/probe-ads-customer.ts <customer_id>
// (Reads creds from .env.local; needs GOOGLE_ADS_* env vars + a Supabase
// refresh_token row in platform_connections.)

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv() // fall through to .env if .env.local missed anything
import { createClient } from "@supabase/supabase-js"

const customerId = process.argv[2]?.trim()
if (!customerId) {
  console.error("Usage: tsx scripts/probe-ads-customer.ts <customer_id>")
  process.exit(1)
}

const GOOGLE_ADS_API_VERSION = "v21"

async function refresh(refresh_token: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
    refresh_token,
    grant_type: "refresh_token",
  })
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error(`OAuth refresh failed: ${JSON.stringify(json)}`)
  return json.access_token
}

async function gaql(
  access_token: string,
  customerId: string,
  query: string,
  loginCustomerId?: string | null,
): Promise<{ ok: boolean; rows: unknown[]; error: string | null }> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${access_token}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    "content-type": "application/json",
  }
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId
  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`,
    { method: "POST", headers, body: JSON.stringify({ query }) },
  )
  const text = await res.text()
  if (!res.ok) return { ok: false, rows: [], error: text.slice(0, 800) }
  const parsed = JSON.parse(text) as { results?: unknown[] }
  return { ok: true, rows: parsed.results ?? [], error: null }
}

async function listAccessibleCustomers(access_token: string): Promise<string[]> {
  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`,
    {
      headers: {
        authorization: `Bearer ${access_token}`,
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      },
    },
  )
  const body = (await res.json()) as { resourceNames?: string[] }
  return (body.resourceNames ?? []).map((rn) => rn.replace("customers/", ""))
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const { data: connRows, error: connErr } = await supabase.rpc(
    "fn_get_platform_connection",
    { p_plugin_name: "google_ads" },
  )
  if (connErr) {
    console.error("Failed to read platform_connections:", connErr)
    process.exit(1)
  }
  const refresh_token = (
    (connRows as Array<{ credentials?: { refresh_token?: string } }>)?.[0]
      ?.credentials as { refresh_token?: string } | undefined
  )?.refresh_token
  if (!refresh_token) {
    console.error("No refresh_token in platform_connections.google_ads")
    process.exit(1)
  }
  const access_token = await refresh(refresh_token)

  console.log("=== ENV ===")
  console.log("GOOGLE_ADS_LOGIN_CUSTOMER_ID:", process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "<unset>")
  console.log("Target customer_id:", customerId)
  console.log()

  console.log("=== Accessible customers (OAuth listAccessibleCustomers) ===")
  const accessible = await listAccessibleCustomers(access_token)
  console.log(JSON.stringify(accessible, null, 2))
  console.log()

  console.log("=== Probe 1: customer info WITHOUT login-customer-id header ===")
  const probe1 = await gaql(
    access_token,
    customerId,
    "SELECT customer.id, customer.descriptive_name, customer.manager, customer.test_account, customer.status, customer.currency_code FROM customer",
    null,
  )
  console.log(probe1.ok ? JSON.stringify(probe1.rows, null, 2) : `❌ ${probe1.error}`)
  console.log()

  console.log("=== Probe 2: customer info WITH env login-customer-id header ===")
  const probe2 = await gaql(
    access_token,
    customerId,
    "SELECT customer.id, customer.descriptive_name, customer.manager, customer.test_account, customer.status, customer.currency_code FROM customer",
  )
  console.log(probe2.ok ? JSON.stringify(probe2.rows, null, 2) : `❌ ${probe2.error}`)
  console.log()

  console.log("=== Probe 3: customer_client rows under this customer (= child accounts if MCC) ===")
  const probe3 = await gaql(
    access_token,
    customerId,
    "SELECT customer_client.client_customer, customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status, customer_client.level FROM customer_client WHERE customer_client.level <= 1",
    null,
  )
  console.log(probe3.ok ? JSON.stringify(probe3.rows, null, 2) : `❌ ${probe3.error}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
