import { NextResponse } from "next/server"
import { z } from "zod"
import { addSubscriber } from "@/lib/db/newsletter"
import { ghlCreateContact } from "@/lib/ghl"

const newsletterSchema = z.object({
  email: z.string().email("Invalid email address"),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = newsletterSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 })
    }

    // Save to Supabase (primary — this is the source of truth)
    await addSubscriber(result.data.email)

    // Also sync to GHL if configured (fire-and-forget)
    ghlCreateContact({
      email: result.data.email,
      tags: ["newsletter"],
      source: "website-newsletter",
    }).catch((error) => {
      console.error("[Newsletter] GHL contact creation failed:", error)
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[Newsletter] Subscription failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
