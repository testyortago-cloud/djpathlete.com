import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { updateMembershipPlan } from "@/lib/db/membership-plans"

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  priceCents: z.number().int().nonnegative().optional(),
  billingInterval: z.enum(["week", "month"]).optional(),
  sessionsPerPeriod: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  const { id } = await ctx.params
  const parsed = patchSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: "Invalid update" }, { status: 400 })
  const p = parsed.data
  const patch: Record<string, unknown> = {}
  if (p.name !== undefined) patch.name = p.name
  if (p.priceCents !== undefined) patch.price_cents = p.priceCents
  if (p.billingInterval !== undefined) patch.billing_interval = p.billingInterval
  if (p.sessionsPerPeriod !== undefined) patch.sessions_per_period = p.sessionsPerPeriod
  if (p.isActive !== undefined) patch.is_active = p.isActive
  if (p.sortOrder !== undefined) patch.sort_order = p.sortOrder
  return NextResponse.json({ plan: await updateMembershipPlan(id, patch) })
}
