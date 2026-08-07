// The phase's ONLY write: a coach-entered %, stored in system_settings, audited.
// The product never derives the % — the CPA validates it (spec §3.2).
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { getSetting, setSetting } from "@/lib/db/system-settings"
import { homeOfficePercentSchema } from "@/lib/validators/bookkeeping"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const SETTING_KEY = "bookkeeping_home_office_percent"

export async function PATCH(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const parsed = homeOfficePercentSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    }
    const value = parsed.data.percent === null ? null : Math.round(parsed.data.percent * 100) / 100
    const previous = await getSetting<number | null>(SETTING_KEY, null)
    await setSetting(SETTING_KEY, value, session.user.id)
    void recordAudit({
      action: "bookkeeping.home_office_percent_set",
      category: "commerce",
      target: { type: "system_setting", id: SETTING_KEY },
      metadata: { previous_value: previous, new_value: value },
      request,
    })
    return NextResponse.json({ percent: value })
  } catch (error) {
    console.error("bookkeeping home-office percent:", error)
    return NextResponse.json({ error: "Failed to save the office share" }, { status: 500 })
  }
}
