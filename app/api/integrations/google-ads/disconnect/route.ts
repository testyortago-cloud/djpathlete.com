// app/api/integrations/google-ads/disconnect/route.ts
// Clears the stored refresh token (vault secret) and marks every linked
// Customer ID inactive. Synced data is preserved so historical reports keep
// working; the nightly sync skips inactive accounts.
//
// Google does not require us to call a revoke endpoint to invalidate a
// refresh token from the Vercel side — the user can revoke from
// https://myaccount.google.com/permissions if they want a hard cutoff.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { disconnectPlatform } from "@/lib/db/platform-connections"
import {
  listGoogleAdsAccounts,
  deactivateGoogleAdsAccount,
} from "@/lib/db/google-ads-accounts"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  await disconnectPlatform("google_ads")

  const accounts = await listGoogleAdsAccounts()
  for (const acct of accounts) {
    await deactivateGoogleAdsAccount(acct.customer_id)
  }

  return NextResponse.json({ success: true })
}
