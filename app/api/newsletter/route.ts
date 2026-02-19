import { NextResponse } from "next/server"
import { z } from "zod"
import { ghlCreateContact } from "@/lib/ghl"

const newsletterSchema = z.object({
  email: z.string().email("Invalid email address"),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = newsletterSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      )
    }

    // Fire-and-forget: create contact in GHL but always return success
    // to the user regardless of whether GHL succeeds
    ghlCreateContact({
      email: result.data.email,
      tags: ["newsletter"],
      source: "website-newsletter",
    }).catch((error) => {
      console.error("[Newsletter] GHL contact creation failed:", error)
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
