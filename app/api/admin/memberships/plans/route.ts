import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { listAllMembershipPlans, createMembershipPlan } from "@/lib/db/membership-plans"

const planSchema = z.object({
  name: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  billingInterval: z.enum(["week", "month"]),
  sessionsPerPeriod: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

async function requireAdmin() {
  const session = await auth()
  return session?.user?.id && session.user.role === "admin" ? session : null
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  return NextResponse.json({ plans: await listAllMembershipPlans() })
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const parsed = planSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: "Invalid plan" }, { status: 400 })
  const p = parsed.data
  const plan = await createMembershipPlan({
    name: p.name,
    price_cents: p.priceCents,
    billing_interval: p.billingInterval,
    sessions_per_period: p.sessionsPerPeriod ?? null,
    stripe_price_id: null,
    is_active: p.isActive ?? true,
    sort_order: p.sortOrder ?? 0,
  })
  return NextResponse.json({ plan }, { status: 201 })
}
