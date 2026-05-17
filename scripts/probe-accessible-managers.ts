// scripts/probe-accessible-managers.ts
// Walks each accessible customer, checks if it's a manager (MCC), and lists
// the client accounts it owns. Helps you find which manager/client combo to
// use when login-customer-id is the wrong value.

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()
import { createClient } from "@supabase/supabase-js"

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
  if (!res.ok) return { ok: false, rows: [], error: text.slice(0, 400) }
  const parsed = JSON.parse(text) as { results?: unknown[] }
  return { ok: true, rows: parsed.results ?? [], error: null }
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const { data: connRows } = await supabase.rpc("fn_get_platform_connection", {
    p_plugin_name: "google_ads",
  })
  const refresh_token = (
    (connRows as Array<{ credentials?: { refresh_token?: string } }>)?.[0]
      ?.credentials as { refresh_token?: string } | undefined
  )?.refresh_token!
  const access_token = await refresh(refresh_token)

  const accessible = ["4974459872", "6371489321", "4815517878", "2654398358"]

  for (const cid of accessible) {
    console.log(`\n=== Customer ${cid} ===`)
    const info = await gaql(
      access_token,
      cid,
      "SELECT customer.id, customer.descriptive_name, customer.manager, customer.test_account, customer.status FROM customer",
      null,
    )
    if (!info.ok) {
      console.log(`  customer info: ❌ ${info.error}`)
      continue
    }
    console.log(`  customer info:`, JSON.stringify(info.rows, null, 2))

    // Try to list its clients (works for managers).
    const clients = await gaql(
      access_token,
      cid,
      "SELECT customer_client.client_customer, customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status, customer_client.level FROM customer_client WHERE customer_client.level <= 2",
      null,
    )
    if (!clients.ok) {
      console.log(`  clients query: ❌ ${clients.error}`)
      continue
    }
    console.log(`  clients (${clients.rows.length}):`, JSON.stringify(clients.rows, null, 2))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
