import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { marketingConsentToggleBodySchema } from "@/lib/validators/marketing"
import { setMarketingConsent } from "@/lib/db/marketing-consent"
import { recordAudit } from "@/lib/audit/record"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const body = await request.json().catch(() => null)
  const parsed = marketingConsentToggleBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
  const userAgent = request.headers.get("user-agent")

  const logRow = await setMarketingConsent({
    user_id: userId,
    granted: parsed.data.granted,
    source: parsed.data.source ?? "account_settings",
    ip_address: ip,
    user_agent: userAgent,
  })

  if (logRow) {
    await recordAudit({
      action: "marketing_consent.changed",
      category: "compliance",
      target: { type: "user", id: userId },
      metadata: {
        previous: !parsed.data.granted,
        current: parsed.data.granted,
        source: parsed.data.source ?? "account_settings",
      },
      request,
    })
  }

  return NextResponse.json({ success: true })
}
