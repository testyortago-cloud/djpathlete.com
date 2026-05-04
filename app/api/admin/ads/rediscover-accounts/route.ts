// app/api/admin/ads/rediscover-accounts/route.ts
// Re-runs `listAccessibleCustomers` against the stored refresh token and
// upserts each accessible Customer ID into google_ads_accounts. Used when
// the OAuth handshake completed before GOOGLE_ADS_DEVELOPER_TOKEN was set
// (the original callback returns an empty list in that case and leaves the
// table empty), or after the token rotates and accounts need re-syncing —
// no consent screen needed.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getPlatformConnection, connectPlatform } from "@/lib/db/platform-connections"
import { upsertGoogleAdsAccount } from "@/lib/db/google-ads-accounts"
import { listAccessibleCustomers } from "@/lib/ads/google-ads-client"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const conn = await getPlatformConnection("google_ads")
  const refresh_token = conn?.credentials?.refresh_token as string | undefined
  if (!conn || !refresh_token) {
    return NextResponse.json(
      { error: "Google Ads not connected — run the OAuth flow first." },
      { status: 400 },
    )
  }

  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    return NextResponse.json(
      { error: "GOOGLE_ADS_DEVELOPER_TOKEN is not set in env." },
      { status: 400 },
    )
  }

  let accounts: Awaited<ReturnType<typeof listAccessibleCustomers>>
  try {
    accounts = await listAccessibleCustomers(refresh_token)
  } catch (err) {
    return NextResponse.json(
      { error: `Customer discovery failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }

  for (const acct of accounts) {
    await upsertGoogleAdsAccount({
      customer_id: acct.customer_id,
      descriptive_name: acct.descriptive_name,
      currency_code: acct.currency_code,
      time_zone: acct.time_zone,
    })
  }

  // Refresh account_handle on the platform_connections row if it was empty.
  const primaryHandle = accounts[0]?.customer_id ?? null
  if (primaryHandle && !conn.account_handle) {
    await connectPlatform("google_ads", {
      credentials: conn.credentials,
      account_handle: primaryHandle,
      connected_by: conn.connected_by,
    })
  }

  return NextResponse.json({ count: accounts.length, customer_ids: accounts.map((a) => a.customer_id) })
}
