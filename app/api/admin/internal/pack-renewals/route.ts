// POST /api/admin/internal/pack-renewals
// Hit daily (09:00 UTC) by the packRenewalScanCron Firebase function.
// Finds active packs that are low / empty / expiring and not yet nudged at that
// severity, then emails the client, drops an in-app notification, alerts the
// coach, and stamps last_reminded_threshold so each fires once.

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { listActivePackages, updateClientPackage } from "@/lib/db/client-packages"
import { selectPacksNeedingReminder } from "@/lib/automation/pack-renewal-scanner"
import { remainingCredits } from "@/lib/services/session-credits"
import { getUserById, getUsers } from "@/lib/db/users"
import { createNotification } from "@/lib/db/notifications"
import { sendPackRenewalEmail } from "@/lib/email"
import { PACK_RENEWALS_CRON_KEY, packReminderLowAt, packReminderExpiryDays } from "@/lib/packs/flags"

export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({ enabledKey: PACK_RENEWALS_CRON_KEY, defaultEnabled: false })
  if (gate.skipped) {
    return NextResponse.json({ skipped: gate.reason }, { status: 200 })
  }

  const now = new Date()
  const [lowAt, expiryDays] = await Promise.all([packReminderLowAt(), packReminderExpiryDays()])

  const packs = await listActivePackages()
  const reminders = selectPacksNeedingReminder(packs, now, lowAt, expiryDays)

  let emailed = 0
  let notified = 0
  let errors = 0

  for (const { pkg, threshold } of reminders) {
    try {
      const client = await getUserById(pkg.client_user_id)
      const remaining = remainingCredits(pkg)

      await sendPackRenewalEmail({
        to: client.email,
        firstName: client.first_name,
        threshold,
        remaining,
        sessionType: pkg.session_type,
        clientUserId: pkg.client_user_id,
      })
      emailed += 1

      await createNotification({
        user_id: pkg.client_user_id,
        title:
          threshold === "empty"
            ? "Your sessions have run out"
            : threshold === "expiring"
              ? "Your sessions expire soon"
              : "You're running low on sessions",
        message: `You have ${remaining} ${pkg.session_type} session${remaining === 1 ? "" : "s"} left. Get in touch to renew.`,
        type: threshold === "empty" ? "warning" : "info",
        is_read: false,
        link: "/contact",
      })
      notified += 1

      await updateClientPackage(pkg.id, { last_reminded_threshold: threshold })
    } catch (err) {
      errors += 1
      console.error(`[pack-renewals] failed for pack ${pkg.id}:`, err)
    }
  }

  // Coach summary (in-app for each admin) when there's anything to action.
  if (reminders.length > 0) {
    try {
      const admins = (await getUsers()).filter((u) => u.role === "admin")
      for (const admin of admins) {
        await createNotification({
          user_id: admin.id,
          title: "Session packs need attention",
          message: `${reminders.length} client pack${reminders.length === 1 ? "" : "s"} are low, empty, or expiring.`,
          type: "info",
          is_read: false,
          link: "/admin/clients",
        })
      }
    } catch (err) {
      console.error("[pack-renewals] coach notification failed:", err)
    }
  }

  return NextResponse.json(
    { scanned: packs.length, reminders: reminders.length, emailed, notified, errors },
    { status: 200 },
  )
}
