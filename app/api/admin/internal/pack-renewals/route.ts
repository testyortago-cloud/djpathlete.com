// POST /api/admin/internal/pack-renewals
// Hit daily (09:00 UTC) by the packRenewalScanCron Firebase function.
// Finds active packs that are low / empty / expiring and not yet nudged at that
// severity, then emails the client, drops an in-app notification, alerts the
// coach, and stamps last_reminded_threshold so each fires once.

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { listActivePackages, listDepletedAutoRenewPackages, updateClientPackage } from "@/lib/db/client-packages"
import { countStalePendingRenewalAttempts } from "@/lib/db/pack-renewal-attempts"
import { selectPacksNeedingReminder } from "@/lib/automation/pack-renewal-scanner"
import { remainingCredits } from "@/lib/services/session-credits"
import { attemptPackRenewal } from "@/lib/services/pack-renewal"
import { getUserById, getUsers } from "@/lib/db/users"
import { createNotification } from "@/lib/db/notifications"
import { sendPackRenewalEmail } from "@/lib/email"
import {
  PACK_RENEWALS_CRON_KEY,
  packReminderLowAt,
  packReminderExpiryDays,
  packAutoRenewEnabled,
  packAutoRenewMaxAgeDays,
} from "@/lib/packs/flags"

export const runtime = "nodejs"
export const maxDuration = 300

// I2: how long a renewal attempt may sit `pending` before it's treated as
// stuck (a crashed process, not an in-flight charge — a real Stripe call
// resolves in seconds, not an hour).
const STALE_PENDING_RENEWAL_MS = 60 * 60 * 1000

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const gate = await isCronSkipped({ enabledKey: PACK_RENEWALS_CRON_KEY, defaultEnabled: false })

  let scanned = 0
  let remindersCount = 0
  let emailed = 0
  let notified = 0
  let errors = 0

  // Reminder emails only — untouched by the auto-renew sweep below. Skipped
  // entirely (no listActivePackages call) when the reminder cron is off.
  if (!gate.skipped) {
    const [lowAt, expiryDays] = await Promise.all([packReminderLowAt(), packReminderExpiryDays()])

    const packs = await listActivePackages()
    scanned = packs.length
    const reminders = selectPacksNeedingReminder(packs, now, lowAt, expiryDays)
    remindersCount = reminders.length

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
  }

  // Auto-renew sweep — safety net for the inline trigger in checkInClient: a
  // serverless instance can die before its fire-and-forget renewal lands.
  // Both paths race the same unique (source_package_id) index, so the
  // duplicate simply loses.
  //
  // Deliberately gated on pack_auto_renew_enabled, NOT on gate.skipped /
  // cron_pack_renewals_enabled above. Those answer different questions —
  // "may we email clients about their balance" vs. "may we charge a saved
  // card" — and pack_auto_renew_enabled is absent from system_settings by
  // default (defaultEnabled: false), meaning cron_pack_renewals_enabled being
  // off (also the DB default) would silently disable the ENTIRE crash-recovery
  // safety net this cron exists for. Do not merge these two gates back into
  // one "if" — that reintroduces exactly that bug.
  let renewed = 0
  let renewalsFailed = 0
  try {
    if (await packAutoRenewEnabled()) {
      // I3: only packs that depleted within the last N days — otherwise the
      // first sweep run after this flag flips on charges every pack that
      // quietly depleted while it was off, all at once, regardless of age.
      // See listDepletedAutoRenewPackages's doc comment for why updated_at
      // is a safe proxy for "depleted at".
      const maxAgeDays = await packAutoRenewMaxAgeDays()
      const since = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString()
      const depleted = await listDepletedAutoRenewPackages(since)
      for (const pkg of depleted) {
        try {
          const outcome = await attemptPackRenewal(pkg, now)
          if (outcome.renewed) renewed += 1
          else if (outcome.reason !== "disabled" && outcome.reason !== "already_attempted") renewalsFailed += 1
        } catch (err) {
          // Per-pack, like the reminder loop above: one bad pack (e.g.
          // resolveBillingUserId throwing) must not abandon the rest of
          // today's sweep for every pack after it.
          renewalsFailed += 1
          console.error(`[pack-renewals] auto-renew sweep failed for pack ${pkg.id}:`, err)
        }
      }
    }
  } catch (err) {
    console.error("[pack-renewals] auto-renew sweep failed:", err)
  }

  // I2: the crash-recovery sweep above can't recover the one crash it exists
  // for — a process dying between createRenewalAttemptIfAbsent's insert and
  // the chargeSavedCard call strands the attempt at `pending` forever, and
  // listDepletedAutoRenewPackages permanently excludes any pack that already
  // has an attempt row. Auto-retrying is unsafe (Stripe's idempotency key
  // expires at 24h), so this only surfaces the count — in the response for
  // monitoring, and as an admin alert so a human reconciles against Stripe.
  // Runs unconditionally (not gated on pack_auto_renew_enabled): a stuck row
  // from before the flag was turned off is still a client who may have been
  // charged with no pack to show for it.
  let stalePendingRenewals = 0
  try {
    const staleCutoff = new Date(now.getTime() - STALE_PENDING_RENEWAL_MS).toISOString()
    stalePendingRenewals = await countStalePendingRenewalAttempts(staleCutoff)
    if (stalePendingRenewals > 0) {
      const admins = (await getUsers()).filter((u) => u.role === "admin")
      for (const admin of admins) {
        await createNotification({
          user_id: admin.id,
          title: "Pack renewal attempts stuck pending",
          message: `${stalePendingRenewals} pack renewal attempt${stalePendingRenewals === 1 ? "" : "s"} have been pending for over an hour — the charging process likely died mid-attempt. Check Stripe (by idempotency key pack_renew_<sourcePackageId>) before retrying anything.`,
          type: "warning",
          is_read: false,
          link: "/admin/clients",
        })
      }
    }
  } catch (err) {
    console.error("[pack-renewals] stale-pending-attempt check failed:", err)
  }

  return NextResponse.json(
    {
      skipped: gate.skipped ? gate.reason : undefined,
      scanned,
      reminders: remindersCount,
      emailed,
      notified,
      errors,
      renewed,
      renewalsFailed,
      stalePendingRenewals,
    },
    { status: 200 },
  )
}
