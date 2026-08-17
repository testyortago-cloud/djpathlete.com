// app/api/admin/automation/toggle-cron/route.ts
// Admin-only endpoint that flips a per-job cron toggle in system_settings.
// Called by the CronEnabledToggle component on /admin/automation.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { setSetting } from "@/lib/db/system-settings"
import { CRON_CATALOG } from "@/lib/cron-catalog"
import { isFeatureFlagKey } from "@/lib/feature-flag-catalog"
import { recordAudit } from "@/lib/audit/record"

const requestSchema = z.object({
  enabledKey: z.string().min(1).max(120),
  enabled: z.boolean(),
})

// Restrict the admin to flipping keys that are actually declared on a cron
// in the catalog. Prevents the endpoint from being repurposed as a generic
// system_settings writer.
function isCronKey(key: string): boolean {
  return CRON_CATALOG.some((c) => c.enabledKey === key)
}

function isAllowedKey(key: string): boolean {
  return isCronKey(key) || isFeatureFlagKey(key)
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
    await recordAudit({
      // ASKS THE CATALOGUES, NOT THE KEY'S SPELLING. This was
      // `startsWith("cron_") || startsWith("feature_")`, a string heuristic
      // standing in for a question the catalogues answer exactly — and it
      // misfiled the first flag whose name matched neither prefix
      // (`funnel_anonymous_checkout_enabled`, the one that moves money) as a
      // generic setting change. Anyone auditing flag flips by filtering
      // `feature_flag.toggled` would have missed precisely the flip worth
      // reviewing.
      action: isFeatureFlagKey(enabledKey) || isCronKey(enabledKey) ? "feature_flag.toggled" : "system_setting.changed",
      category: "system",
      target: { type: "system_setting", id: enabledKey, label: enabledKey },
      metadata: { key: enabledKey, new_value: enabled },
      request,
    })
    return NextResponse.json({ enabledKey, enabled })
  } catch (err) {
    console.error("[/api/admin/automation/toggle-cron]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
