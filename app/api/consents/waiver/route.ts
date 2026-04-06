import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { waiverConsentSchema } from "@/lib/validators/consent"
import { getActiveDocument } from "@/lib/db/legal-documents"
import { createConsent, hasActiveWaiver } from "@/lib/db/consents"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const result = waiverConsentSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid request", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { programId } = result.data
    const userId = session.user.id

    // Check if waiver already accepted for this program
    const alreadyAccepted = await hasActiveWaiver(userId, programId)
    if (alreadyAccepted) {
      return NextResponse.json({ message: "Waiver already accepted" }, { status: 200 })
    }

    // Get the active liability waiver document
    const waiverDoc = await getActiveDocument("liability_waiver")

    const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null
    const userAgent = request.headers.get("user-agent") || null

    const consent = await createConsent({
      user_id: userId,
      consent_type: "liability_waiver",
      legal_document_id: waiverDoc?.id || null,
      program_id: programId,
      ip_address: ipAddress,
      user_agent: userAgent,
    })

    return NextResponse.json(consent, { status: 201 })
  } catch (error) {
    console.error("Waiver consent error:", error)
    return NextResponse.json(
      { error: "Failed to record waiver consent" },
      { status: 500 }
    )
  }
}
