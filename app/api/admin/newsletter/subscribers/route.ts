import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import { importSubscribers } from "@/lib/db/newsletter"

// Per-request cap. The admin UI chunks large lists into requests of ~2,000, so a
// list of any size imports across multiple calls without hitting body-size limits.
const importSchema = z.object({
  emails: z.array(z.string().email()).min(1, "At least 1 email required").max(10000, "Maximum 10000 emails per request"),
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

    // NOTE: GHL sync is intentionally NOT done inline here — pushing one contact
    // per email would fan out thousands of concurrent calls on a bulk import.
    // The admin "Sync GHL" action handles that safely in its own batched flow.

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
