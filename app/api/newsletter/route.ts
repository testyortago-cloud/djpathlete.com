import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { addSubscriberWithAttribution } from "@/lib/db/newsletter"
import { ghlCreateContact } from "@/lib/ghl"
import { parseAttrCookie } from "@/lib/marketing/cookies"

const newsletterSchema = z.object({
  email: z.string().email("Invalid email address"),
  consent_marketing: z.boolean().optional().default(false),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const result = newsletterSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 })
    }

    const cookieHeader = request.headers.get("cookie")
    const sessionId = parseAttrCookie(cookieHeader) ?? undefined
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
    const userAgent = request.headers.get("user-agent")

    await addSubscriberWithAttribution({
      email: result.data.email,
      session_id: sessionId,
      consent_marketing: result.data.consent_marketing,
      ip_address: ip,
      user_agent: userAgent,
    })

    // Fire-and-forget GHL sync
    ghlCreateContact({
      email: result.data.email,
      tags: ["newsletter"],
      source: "website-newsletter",
    }).catch((error) => console.error("[Newsletter] GHL contact creation failed:", error))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[Newsletter] Subscription failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
