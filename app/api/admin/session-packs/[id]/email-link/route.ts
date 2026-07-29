import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getClientPackageByIdMaybe, updateClientPackage } from "@/lib/db/client-packages"
import { getUserById } from "@/lib/db/users"
import { resolvePackPaymentLink } from "@/lib/services/pack-payment-link"
import { sendPackPaymentLinkEmail } from "@/lib/email"
import { recordAudit } from "@/lib/audit/record"

/**
 * POST — email this pack's payment link to whoever is paying.
 *
 * Resolves the link through the same path as "Copy payment link" rather than
 * minting a second, competing session. The send is awaited, not fire-and-forget:
 * the coach is usually standing with the client and must know at once if
 * delivery failed, so they can fall back to copying the link.
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

    const client = await getUserById(pack.client_user_id).catch(() => null)
    const to = pack.bill_to_email ?? client?.email ?? null
    if (!to) {
      return NextResponse.json({ error: "No email to send this link to" }, { status: 409 })
    }

    const link = await resolvePackPaymentLink(pack)
    if (!link.ok) {
      return NextResponse.json({ error: link.error }, { status: link.status })
    }

    const clientName = `${client?.first_name ?? ""} ${client?.last_name ?? ""}`.trim() || "your athlete"
    try {
      await sendPackPaymentLinkEmail({
        to,
        ccClientEmail: client?.email ?? null,
        clientName,
        packLabel: `${pack.credits_total}× ${pack.session_type}`,
        amountCents: pack.price_cents,
        url: link.url,
      })
    } catch {
      return NextResponse.json(
        { error: "Couldn't send the email — copy the link and send it manually" },
        { status: 502 },
      )
    }

    const emailedAt = new Date().toISOString()
    await updateClientPackage(id, { bill_to_emailed_at: emailedAt })

    void recordAudit({
      action: "pack.payment_link_emailed",
      category: "commerce",
      outcome: "success",
      target: { type: "client_package", id, label: pack.session_type },
      metadata: { client_user_id: pack.client_user_id, sent_to: to, refreshed: link.refreshed },
      request,
    })

    return NextResponse.json({ ok: true, sentTo: to, emailedAt })
  } catch (error) {
    console.error("Email pack payment link error:", error)
    return NextResponse.json({ error: "Failed to email the payment link" }, { status: 500 })
  }
}
