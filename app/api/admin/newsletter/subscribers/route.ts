import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import { importSubscribers } from "@/lib/db/newsletter"
import { ghlCreateContact } from "@/lib/ghl"

const importSchema = z.object({
  emails: z.array(z.string().email()).min(1, "At least 1 email required").max(5000, "Maximum 5000 emails per import"),
})

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = importSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 },
      )
    }

    const result = await importSubscribers(parsed.data.emails)

    // Sync new subscribers to GHL (fire-and-forget)
    for (const email of parsed.data.emails) {
      ghlCreateContact({
        email,
        tags: ["newsletter"],
        source: "admin-import",
      })
    }

    return NextResponse.json({
      success: true,
      added: result.added,
      skipped: result.skipped,
      total: parsed.data.emails.length,
    })
  } catch (error) {
    console.error("[Subscribers Import] Error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
