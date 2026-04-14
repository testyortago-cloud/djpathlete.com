import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getUserById } from "@/lib/db/users"
import { createBillingPortalSession } from "@/lib/stripe"

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "You must be logged in." }, { status: 401 })
    }

    const user = await getUserById(session.user.id)

    if (!user.stripe_customer_id) {
      return NextResponse.json(
        { error: "No billing account found. You don't have any active subscriptions." },
        { status: 400 },
      )
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.NEXTAUTH_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null) ??
      "https://darrenjpaul.com"

    const portalSession = await createBillingPortalSession(user.stripe_customer_id, `${baseUrl}/client/programs`)

    return NextResponse.json({ url: portalSession.url })
  } catch (error) {
    console.error("Billing portal error:", error)
    return NextResponse.json({ error: "Failed to open billing portal. Please try again." }, { status: 500 })
  }
}
