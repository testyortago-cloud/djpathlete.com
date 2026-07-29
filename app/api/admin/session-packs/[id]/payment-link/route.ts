import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getClientPackageByIdMaybe } from "@/lib/db/client-packages"
import { resolvePackPaymentLink } from "@/lib/services/pack-payment-link"
import { recordAudit } from "@/lib/audit/record"

/**
 * POST — get a shareable payment link for an awaiting-payment pack.
 *
 * The reuse-or-re-mint rules (and their money-safety guards) live in
 * `resolvePackPaymentLink`, shared with the email-link route so both agree on
 * what this pack's link is — and so a re-mint keeps the pack's bill-to address.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const { id } = await ctx.params

    const pack = await getClientPackageByIdMaybe(id)
    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 })
    }

    const link = await resolvePackPaymentLink(pack)
    if (!link.ok) {
      return NextResponse.json({ error: link.error }, { status: link.status })
    }
    if (!link.refreshed) {
      return NextResponse.json({ url: link.url, refreshed: false })
    }

    void recordAudit({
      action: "pack.payment_link_refreshed",
      category: "commerce",
      outcome: "success",
      target: { type: "client_package", id, label: pack.session_type },
      metadata: { client_user_id: pack.client_user_id },
      request,
    })

    return NextResponse.json({ url: link.url, refreshed: true })
  } catch (error) {
    console.error("Pack payment link error:", error)
    return NextResponse.json({ error: "Failed to get payment link" }, { status: 500 })
  }
}
