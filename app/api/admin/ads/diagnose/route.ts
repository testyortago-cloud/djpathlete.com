// app/api/admin/ads/diagnose/route.ts
// Diagnostic helper for the "USER_PERMISSION_DENIED" class of apply errors.
// Calls a handful of GAQL queries against the configured customer and the
// OAuth-accessible accounts list, then returns a flat JSON report the admin
// (or Claude) can read to figure out whether the failure is:
//
//   - Missing GOOGLE_ADS_LOGIN_CUSTOMER_ID env var (header is dropped → 403)
//   - LOGIN_CUSTOMER_ID points at the wrong manager (manager doesn't own the
//     customer being mutated)
//   - The customer_id stored in google_ads_accounts is itself a manager
//     (managers can't have campaigns mutated directly)
//   - The OAuth user doesn't have access to that customer at all
//
// Hit `GET /api/admin/ads/diagnose?customer_id=...` (defaults to first active
// account) — admin-only. Read-only; no mutations.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getActiveGoogleAdsAccounts,
  listGoogleAdsAccounts,
} from "@/lib/db/google-ads-accounts"
import { listAccessibleCustomers } from "@/lib/ads/google-ads-client"
import { getPlatformConnection } from "@/lib/db/platform-connections"
import { searchGoogleAdsRest } from "@/lib/ads/google-ads-rest"
import { canAccessAdminPath } from "@/lib/permissions/guard"

interface CustomerRow {
  customer?: {
    id?: string
    descriptiveName?: string
    manager?: boolean
    testAccount?: boolean
    status?: string
    currencyCode?: string
    timeZone?: string
  }
}

interface ClientLinkRow {
  customerClient?: {
    clientCustomer?: string
    id?: string
    descriptiveName?: string
    manager?: boolean
    status?: string
    level?: string
  }
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const url = new URL(request.url)
  const requestedCustomerId = url.searchParams.get("customer_id")

  // ── Stored config snapshot ────────────────────────────────────────
  const activeAccounts = await getActiveGoogleAdsAccounts().catch(() => [])
  const allAccounts = await listGoogleAdsAccounts().catch(() => [])
  const targetCustomerId =
    requestedCustomerId ??
    activeAccounts[0]?.customer_id ??
    allAccounts[0]?.customer_id ??
    null

  const env = {
    GOOGLE_ADS_DEVELOPER_TOKEN: Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
    GOOGLE_ADS_CLIENT_ID: Boolean(process.env.GOOGLE_ADS_CLIENT_ID),
    GOOGLE_ADS_CLIENT_SECRET: Boolean(process.env.GOOGLE_ADS_CLIENT_SECRET),
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? null,
  }

  const conn = await getPlatformConnection("google_ads").catch(() => null)
  const oauth = {
    connected: Boolean(conn?.credentials),
    account_handle: conn?.account_handle ?? null,
  }

  // ── OAuth-accessible accounts ─────────────────────────────────────
  let accessible: Array<{ customer_id: string }> = []
  let accessibleError: string | null = null
  const refresh_token = conn?.credentials?.refresh_token as string | undefined
  if (refresh_token) {
    try {
      accessible = await listAccessibleCustomers(refresh_token)
    } catch (err) {
      accessibleError = (err as Error).message
    }
  }

  // ── Probe the target customer with GAQL ───────────────────────────
  // Try WITHOUT login-customer-id first (works if the customer is itself a
  // direct-auth account), then WITH whatever is in the env var, then list
  // the manager's clients so we can see what manager-customer relationship
  // exists. Each probe is best-effort — we capture errors per probe.
  type Probe = { name: string; query: string; ok: boolean; error: string | null; sample: unknown }
  const probes: Probe[] = []

  async function runProbe(
    name: string,
    customerId: string,
    query: string,
    loginCustomerIdOverride?: string | null,
  ): Promise<Probe> {
    try {
      const rows = await searchGoogleAdsRest(customerId, query, {
        loginCustomerIdOverride,
      })
      return { name, query, ok: true, error: null, sample: rows.slice(0, 5) }
    } catch (err) {
      return { name, query, ok: false, error: (err as Error).message, sample: null }
    }
  }

  if (targetCustomerId) {
    const customerInfoQ = `SELECT customer.id, customer.descriptive_name, customer.manager, customer.test_account, customer.status, customer.currency_code, customer.time_zone FROM customer`

    probes.push(
      await runProbe(
        "target_customer_info_with_env_login",
        targetCustomerId,
        customerInfoQ,
        undefined, // use env var
      ),
    )
    probes.push(
      await runProbe(
        "target_customer_info_without_login_header",
        targetCustomerId,
        customerInfoQ,
        null,
      ),
    )
    probes.push(
      await runProbe(
        "target_customer_clients_under_self",
        targetCustomerId,
        `SELECT customer_client.client_customer, customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status, customer_client.level FROM customer_client WHERE customer_client.level <= 1`,
      ),
    )
  }

  // If login-customer-id env points at a manager, list the clients it owns.
  if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    const managerId = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
    probes.push(
      await runProbe(
        "env_login_manager_self",
        managerId,
        `SELECT customer.id, customer.descriptive_name, customer.manager, customer.status FROM customer`,
        null, // querying the manager itself doesn't need login-customer-id
      ),
    )
    probes.push(
      await runProbe(
        "env_login_manager_owned_clients",
        managerId,
        `SELECT customer_client.client_customer, customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status, customer_client.level FROM customer_client WHERE customer_client.level <= 1`,
        null,
      ),
    )
  }

  // ── Diagnosis ─────────────────────────────────────────────────────
  // Heuristic plain-English assessment based on the probe results.
  const diagnosis: string[] = []
  const targetSelfProbe = probes.find(
    (p) => p.name === "target_customer_info_without_login_header" && p.ok,
  )
  const targetWithLoginProbe = probes.find(
    (p) => p.name === "target_customer_info_with_env_login" && p.ok,
  )
  const isManager =
    (targetSelfProbe?.sample as CustomerRow[] | undefined)?.[0]?.customer?.manager ??
    (targetWithLoginProbe?.sample as CustomerRow[] | undefined)?.[0]?.customer?.manager ??
    null
  if (isManager === true) {
    diagnosis.push(
      `Target customer ${targetCustomerId} IS a manager (MCC). You cannot create campaigns directly on a manager — set GOOGLE_ADS_LOGIN_CUSTOMER_ID to this manager and change google_ads_accounts.customer_id to a child client account (one of customer_client.id rows).`,
    )
  }
  if (!env.GOOGLE_ADS_LOGIN_CUSTOMER_ID && targetSelfProbe?.ok === false && targetSelfProbe.error?.includes("PERMISSION_DENIED")) {
    diagnosis.push(
      `GOOGLE_ADS_LOGIN_CUSTOMER_ID is unset in env and the target customer rejects direct access — set the env var to the parent manager's customer_id (digits only, no dashes).`,
    )
  }
  if (
    env.GOOGLE_ADS_LOGIN_CUSTOMER_ID &&
    targetWithLoginProbe?.ok === false &&
    targetWithLoginProbe.error?.includes("PERMISSION_DENIED")
  ) {
    diagnosis.push(
      `GOOGLE_ADS_LOGIN_CUSTOMER_ID=${env.GOOGLE_ADS_LOGIN_CUSTOMER_ID} but it cannot access target customer ${targetCustomerId}. Check the manager-client link in Google Ads UI, OR replace the env var with the correct manager ID.`,
    )
  }
  if (diagnosis.length === 0 && probes.some((p) => p.ok)) {
    diagnosis.push("No permission issue detected by the probes — re-run the apply.")
  }

  return NextResponse.json({
    env,
    oauth,
    target_customer_id: targetCustomerId,
    stored_accounts: allAccounts.map((a) => ({
      customer_id: a.customer_id,
      manager_customer_id: a.manager_customer_id,
      descriptive_name: a.descriptive_name,
      is_active: a.is_active,
    })),
    oauth_accessible_customers: accessible,
    oauth_accessible_error: accessibleError,
    probes,
    diagnosis,
  })
}
