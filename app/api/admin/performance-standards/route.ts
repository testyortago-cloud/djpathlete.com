import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { STANDARD_TEST_TYPES, standardOrderProblem } from "@/lib/coach-intel/test-normalization"
import { deleteStandard, listStandards, saveStandard } from "@/lib/db/performance-standards"
import type { TestType } from "@/types/database"

const age = z.number().int().min(0).max(100).nullable()
const bodySchema = z
  .object({
    id: z.string().uuid().optional(),
    test_type: z.enum(STANDARD_TEST_TYPES as [TestType, ...TestType[]]),
    age_min: age,
    age_max: age,
    floor_value: z.number().finite(),
    trained_value: z.number().finite(),
    elite_value: z.number().finite(),
  })
  .refine((b) => b.age_min == null || b.age_max == null || b.age_min <= b.age_max, {
    message: "The youngest age must not be above the oldest.",
    path: ["age_max"],
  })

/** The caller's business, or a response explaining why there is none to act on. */
async function tenantOr403(request: Request): Promise<string | NextResponse> {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user, request))) {
    return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
  }
  return (await resolveAdminTenantForRequest(request)).businessId
}

const target = async (_req: Request, _ctx: unknown, response?: Response) => {
  const body = (await response?.json().catch(() => null)) as { standard?: { id: string }; id?: string } | null
  const id = body?.standard?.id ?? body?.id
  return id ? { type: "performance_standard", id } : undefined
}

export async function GET(request: Request) {
  const businessId = await tenantOr403(request)
  if (typeof businessId !== "string") return businessId
  return NextResponse.json({ standards: await listStandards(businessId) })
}

/** Creates or updates one standard (an all-ages row, or one age group) for the caller's business. */
export const POST = withAudit(
  { action: "business.settings_updated", category: "admin_write", target },
  async (request) => {
    const businessId = await tenantOr403(request)
    if (typeof businessId !== "string") return businessId
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 })
    }
    const { id, ...row } = parsed.data
    const problem = standardOrderProblem(row.test_type, row.floor_value, row.trained_value, row.elite_value)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    const saved = await saveStandard(businessId, row, id)
    if (saved === "duplicate") {
      return NextResponse.json({ error: "This test already has standards for that age group." }, { status: 409 })
    }
    if (!saved) return NextResponse.json({ error: "Standard not found" }, { status: 404 })
    return NextResponse.json({ standard: saved })
  },
)

/** Removes one standard; the test falls back to the all-ages row, then the built-in one. */
export const DELETE = withAudit(
  { action: "business.settings_updated", category: "admin_write", target },
  async (request) => {
    const businessId = await tenantOr403(request)
    if (typeof businessId !== "string") return businessId
    const id = new URL(request.url).searchParams.get("id")
    if (!id || !z.string().uuid().safeParse(id).success) {
      return NextResponse.json({ error: "A standard id is required" }, { status: 400 })
    }
    if (!(await deleteStandard(businessId, id))) {
      return NextResponse.json({ error: "Standard not found" }, { status: 404 })
    }
    return NextResponse.json({ id })
  },
)
