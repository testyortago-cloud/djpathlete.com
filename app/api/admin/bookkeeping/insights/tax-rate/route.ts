// The coach/CPA-entered flat effective rate for the rolling forecast (Phase 6b, D-8).
// The product never derives the rate — "ask your CPA for a safe-harbor rate".
// Clone of the home-office percent PATCH: same gate, same 2dp rounding, same audit shape.
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { getSetting, setSetting } from "@/lib/db/system-settings"
import { taxRatePercentSchema } from "@/lib/validators/bookkeeping"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const SETTING_KEY = "bookkeeping_tax_rate_percent"

export async function PATCH(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const parsed = taxRatePercentSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    }
    const value = parsed.data.percent === null ? null : Math.round(parsed.data.percent * 100) / 100
    const previous = await getSetting<number | null>(SETTING_KEY, null)
    await setSetting(SETTING_KEY, value, session.user.id)
    void recordAudit({
      action: "bookkeeping.tax_rate_percent_set",
      category: "commerce",
      target: { type: "system_setting", id: SETTING_KEY },
      metadata: { previous_value: previous, new_value: value },
      request,
    })
    return NextResponse.json({ percent: value })
  } catch (error) {
    console.error("bookkeeping tax rate percent:", error)
    return NextResponse.json({ error: "Failed to save the tax rate" }, { status: 500 })
  }
}
