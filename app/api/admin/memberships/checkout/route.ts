import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { sessionMembershipsEnabled } from "@/lib/packs/flags"
import { getMembershipPlanById } from "@/lib/db/membership-plans"
import { getUserById } from "@/lib/db/users"
import { getOrCreateStripeCustomer, createMembershipCheckoutSession } from "@/lib/stripe"
import { resolveBillingUserId } from "@/lib/services/billing-payer"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const bodySchema = z.object({ userId: z.string().uuid(), planId: z.string().uuid() })

/** Start a subscription-mode Checkout so a client auto-pays for a membership. */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    if (!(await sessionMembershipsEnabled())) return NextResponse.json({ error: "Not enabled" }, { status: 403 })

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: "userId and planId required" }, { status: 400 })

    const plan = await getMembershipPlanById(parsed.data.planId)
    if (!plan || !plan.is_active) return NextResponse.json({ error: "Plan not available" }, { status: 404 })

    // Household billing: the subscription bills the resolved payer's card, but the
    // membership stays "for" the trainee (metadata.userId → client_memberships.user_id).
    const billingUserId = await resolveBillingUserId(parsed.data.userId)
    const billingUser = await getUserById(billingUserId)
    const customerId = await getOrCreateStripeCustomer(billingUserId, billingUser.email)
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
