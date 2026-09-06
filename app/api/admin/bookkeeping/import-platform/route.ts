import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listPlatformIncome } from "@/lib/db/bookkeeping"
import { buildIncomeDrafts } from "@/lib/bookkeeping/income-adapter"
import { importPreviewSchema } from "@/lib/validators/bookkeeping"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    let businessId: string
    try {
      ;({ businessId } = await resolveAdminTenantForRequest(request))
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw err
    }

    const body = await request.json().catch(() => null)
    const parsed = importPreviewSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })
    const { from, to } = parsed.data
    const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
    if (spanDays < 0 || spanDays > 800) {
      return NextResponse.json({ error: "Date range too large (max ~2 years per import) or reversed" }, { status: 400 })
    }
    const sources = await listPlatformIncome(businessId, from, to)
    const { drafts, warnings } = buildIncomeDrafts(sources, { from, to })
    return NextResponse.json({ drafts, warnings })
  } catch (error) {
    console.error("Import platform income preview error:", error)
    return NextResponse.json({ error: "Failed to load platform income" }, { status: 500 })
  }
}
