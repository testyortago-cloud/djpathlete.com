// Read-only probe: verifies a Google Ads developer token by running a tiny GAQL
// query against the manager account. Decodes Google's response into one of:
//   LIVE       — token works for production data
//   TEST_ONLY  — token is "Setup in progress" (test accounts only)
//   INVALID    — token rejected
//   AUTH_ERROR — refresh-token / OAuth issue, can't tell about the dev token
//
// Usage:
//   npx tsx scripts/probe-google-ads-token.ts \
//     --token=F5cQmoKwpa9CpRrtVvtsBg --login=7120798092
//
// Falls back to GOOGLE_ADS_DEVELOPER_TOKEN / GOOGLE_ADS_LOGIN_CUSTOMER_ID from
// .env.local when flags are omitted.
import { config } from "dotenv"
config({ path: ".env.local" })

import { getPlatformConnection } from "@/lib/db/platform-connections"

const API_VERSION = arg("apiv") ?? "v21"

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit?.slice(prefix.length)
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "")
}

async function refreshAccessToken(
  client_id: string,
  client_secret: string,
  refresh_token: string,
): Promise<string> {
  const params = new URLSearchParams({
    client_id,
    client_secret,
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
    throw new Error(`OAuth refresh failed: HTTP ${res.status} — ${text}`)
  }
  const json = JSON.parse(text) as { access_token?: string }
  if (!json.access_token) throw new Error(`OAuth refresh missing access_token: ${text}`)
  return json.access_token
}

interface ApiResult {
  status: number
  body: string
  parsed: unknown
}

async function runGaql(args: {
  developerToken: string
  accessToken: string
  loginCustomerId: string
  customerId: string
  query: string
}): Promise<ApiResult> {
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${args.customerId}/googleAds:search`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.accessToken}`,
      "developer-token": args.developerToken,
      "login-customer-id": args.loginCustomerId,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: args.query }),
  })
  const body = await res.text()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(body)
  } catch {
    /* leave null */
  }
  return { status: res.status, body, parsed }
}

interface ErrorShape {
  error?: {
    code?: number
    status?: string
    message?: string
    details?: Array<{
      "@type"?: string
      errors?: Array<{
        errorCode?: Record<string, string>
        message?: string
      }>
    }>
  }
}

function summarizeErrors(parsed: unknown): string[] {
  const e = (parsed as ErrorShape)?.error
  if (!e) return []
  const codes: string[] = []
  for (const d of e.details ?? []) {
    for (const err of d.errors ?? []) {
      const ec = err.errorCode ?? {}
      for (const [k, v] of Object.entries(ec)) {
        codes.push(`${k}=${v}`)
      }
    }
  }
  return codes
}

async function main() {
  const developerToken = arg("token") ?? process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? ""
  const loginRaw = arg("login") ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? ""
  const loginCustomerId = digitsOnly(loginRaw)

  if (!developerToken) {
    console.error("ERROR: developer token missing. Pass --token=... or set GOOGLE_ADS_DEVELOPER_TOKEN.")
    process.exit(2)
  }
  if (!loginCustomerId || loginCustomerId.length !== 10) {
    console.error(
      `ERROR: login customer id must be 10 digits. Got "${loginRaw}" → "${loginCustomerId}". Pass --login=7120798092.`,
    )
    process.exit(2)
  }

  const client_id = process.env.GOOGLE_ADS_CLIENT_ID
  const client_secret = process.env.GOOGLE_ADS_CLIENT_SECRET
  if (!client_id || !client_secret) {
    console.error("ERROR: GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET missing in .env.local")
    process.exit(2)
  }

  const conn = await getPlatformConnection("google_ads")
  const refresh_token =
    (conn?.credentials as Record<string, unknown> | undefined)?.refresh_token
  if (typeof refresh_token !== "string" || !refresh_token) {
    console.error("ERROR: no refresh_token stored in platform_connections.google_ads.")
    console.error("→ Connect Google Ads via /admin/ads/settings first.")
    process.exit(2)
  }

  console.log("Probing Google Ads dev token")
  console.log("  api version    :", API_VERSION)
  console.log("  developer token:", developerToken.slice(0, 4) + "…" + developerToken.slice(-4))
  console.log("  login cust id  :", loginCustomerId)
  console.log("  refresh_token  :", "(loaded from platform_connections)")
  console.log("")

  let accessToken: string
  try {
    accessToken = await refreshAccessToken(client_id, client_secret, refresh_token)
  } catch (e) {
    console.error("VERDICT: AUTH_ERROR — couldn't refresh OAuth access token.")
    console.error(String(e))
    process.exit(3)
  }

  // Step 1: list customers the refresh token can see. This call ONLY needs the
  // dev token + access token, not login-customer-id. If the dev token is
  // bogus, this is the cleanest place to detect it.
  const listUrl = `https://googleads.googleapis.com/${API_VERSION}/customers:listAccessibleCustomers`
  const listRes = await fetch(listUrl, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
    },
  })
  const listBody = await listRes.text()
  console.log("listAccessibleCustomers HTTP", listRes.status)
  console.log(listBody.slice(0, 1000))
  console.log("")

  if (listRes.status !== 200) {
    const lower = listBody.toLowerCase()
    if (lower.includes("developer_token_not_approved")) {
      console.log("VERDICT: TEST_ONLY ⚠️  — token in 'Setup in progress' state.")
      process.exit(1)
    }
    if (lower.includes("invalid_developer_token") || lower.includes("missing_developer_token")) {
      console.log("VERDICT: INVALID ❌ — Google rejected the developer token.")
      process.exit(1)
    }
    console.log("VERDICT: UNKNOWN — see listAccessibleCustomers body above.")
    process.exit(1)
  }

  // Parse accessible customers from the listAccessibleCustomers response.
  let accessibleIds: string[] = []
  try {
    const j = JSON.parse(listBody) as { resourceNames?: string[] }
    accessibleIds = (j.resourceNames ?? []).map((rn) => rn.replace("customers/", ""))
  } catch {
    /* leave empty */
  }

  // Decisive check: GAQL the requested manager. If it's not accessible to this
  // OAuth user, fall back to the first accessible account so we can still
  // distinguish LIVE vs TEST_ONLY for the dev token.
  const targetCustomer = accessibleIds.includes(loginCustomerId)
    ? loginCustomerId
    : (accessibleIds[0] ?? loginCustomerId)
  const targetLogin = targetCustomer
  if (targetCustomer !== loginCustomerId) {
    console.log(
      `Note: ${loginCustomerId} not accessible to this OAuth user. Probing ${targetCustomer} instead so we can grade the dev token.`,
    )
  }

  const result = await runGaql({
    developerToken,
    accessToken,
    loginCustomerId: targetLogin,
    customerId: targetCustomer,
    query: "SELECT customer.id, customer.descriptive_name, customer.manager FROM customer LIMIT 1",
  })

  console.log("googleAds:search HTTP", result.status, "on customer", targetCustomer)
  if (result.status === 200) {
    console.log("VERDICT: LIVE ✅ — dev token is approved for production data.")
    console.log("Response:", result.body.slice(0, 500))
    if (targetCustomer !== loginCustomerId) {
      console.log(
        `\n⚠️  Manager ${loginCustomerId} (DJPAthlete) is NOT accessible to the stored refresh token.`,
      )
      console.log("→ The OAuth user that connected Google Ads doesn't have access to it.")
      console.log("   Either grant that user access in Google Ads, or re-connect using the user that owns 712-079-8092.")
    }
    return
  }

  const codes = summarizeErrors(result.parsed)
  const codeStr = codes.join(", ")
  console.log("Error codes:", codeStr || "(none parsed)")
  console.log("Body:", result.body.slice(0, 1000))

  const lower = (codeStr + " " + result.body).toLowerCase()
  if (lower.includes("developer_token_not_approved")) {
    console.log(
      "\nVERDICT: TEST_ONLY ⚠️  — token exists but is in 'Setup in progress' / test-access state.",
    )
    console.log("→ Apply for Standard or Basic Access at https://ads.google.com/aw/apicenter")
    process.exit(1)
  }
  if (
    lower.includes("invalid_developer_token") ||
    lower.includes("developer_token_prohibited") ||
    lower.includes("missing_developer_token")
  ) {
    console.log("\nVERDICT: INVALID ❌ — Google rejected the developer token.")
    process.exit(1)
  }
  if (result.status === 401) {
    console.log("\nVERDICT: AUTH_ERROR — OAuth credential rejected. Re-connect Google Ads.")
    process.exit(1)
  }
  console.log("\nVERDICT: UNKNOWN — see body above. Most likely a permission or scope issue.")
  process.exit(1)
}

main().catch((e) => {
  console.error("FAILED:", e)
  process.exit(1)
})
