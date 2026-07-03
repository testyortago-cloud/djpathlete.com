import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { sessionMembershipsEnabled } from "@/lib/packs/flags"
import { getMembershipPlanById } from "@/lib/db/membership-plans"
import { getUserById } from "@/lib/db/users"
import { getOrCreateStripeCustomer, createMembershipCheckoutSession } from "@/lib/stripe"

const bodySchema = z.object({ userId: z.string().uuid(), planId: z.string().uuid() })

/** Start a subscription-mode Checkout so a client auto-pays for a membership. */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    if (!(await sessionMembershipsEnabled())) return NextResponse.json({ error: "Not enabled" }, { status: 403 })

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: "userId and planId required" }, { status: 400 })

    const plan = await getMembershipPlanById(parsed.data.planId)
    if (!plan || !plan.is_active) return NextResponse.json({ error: "Plan not available" }, { status: 404 })

    const user = await getUserById(parsed.data.userId)
    const customerId = await getOrCreateStripeCustomer(parsed.data.userId, user.email)
    const checkout = await createMembershipCheckoutSession({
      customerId,
      userId: parsed.data.userId,
      plan: {
        id: plan.id,
        name: plan.name,
        price_cents: plan.price_cents,
        billing_interval: plan.billing_interval,
        stripe_price_id: plan.stripe_price_id,
      },
    })
    return NextResponse.json({ url: checkout.url })
  } catch (error) {
    console.error("Membership checkout error:", error)
    return NextResponse.json({ error: "Failed to start membership" }, { status: 500 })
  }
}
