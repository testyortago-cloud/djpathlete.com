// app/api/admin/automation/toggle-cron/route.ts
// Admin-only endpoint that flips a per-job cron toggle in system_settings.
// Called by the CronEnabledToggle component on /admin/automation.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { setSetting } from "@/lib/db/system-settings"
import { CRON_CATALOG } from "@/lib/cron-catalog"

const requestSchema = z.object({
  enabledKey: z.string().min(1).max(120),
  enabled: z.boolean(),
})

// Restrict the admin to flipping keys that are actually declared on a cron
// in the catalog. Prevents the endpoint from being repurposed as a generic
// system_settings writer.
function isAllowedKey(key: string): boolean {
  return CRON_CATALOG.some((c) => c.enabledKey === key)
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  const { enabledKey, enabled } = parsed.data

  if (!isAllowedKey(enabledKey)) {
    return NextResponse.json({ error: "Unknown cron toggle key" }, { status: 400 })
  }

  try {
    await setSetting(enabledKey, enabled, session.user.id)
    return NextResponse.json({ enabledKey, enabled })
  } catch (err) {
    console.error("[/api/admin/automation/toggle-cron]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
