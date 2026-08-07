// app/api/admin/ads/accounts/[customer_id]/toggle-active/route.ts
// Admin-only one-click activate/deactivate for a Google Ads sub-account.
// Body: { active: boolean }. Activating brings the account back into the
// sync, agent, and recommendation paths; deactivating hides it everywhere
// in the admin UI without losing historical metric rows.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const BodySchema = z.object({ active: z.boolean() })

interface RouteContext {
  params: Promise<{ customer_id: string }>
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { customer_id } = await ctx.params

  const raw = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "Body must be { active: boolean }" }, { status: 400 })
  }

  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from("google_ads_accounts")
    .update({ is_active: parsed.data.active })
    .eq("customer_id", customer_id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, customer_id, is_active: parsed.data.active })
}
