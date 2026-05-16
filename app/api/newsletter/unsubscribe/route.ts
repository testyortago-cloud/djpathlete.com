import { NextResponse } from "next/server"
import { z } from "zod"
import { removeSubscriber } from "@/lib/db/newsletter"
import { withAudit } from "@/lib/audit/with-audit"

const schema = z.object({
  email: z.string().email(),
})

export const POST = withAudit(
  { action: "newsletter.unsubscribed", category: "marketing" },
  async (request) => {
    try {
      const body = await request.json()
      const result = schema.safeParse(body)

      if (!result.success) {
        return NextResponse.json({ error: "Invalid email" }, { status: 400 })
      }

      await removeSubscriber(result.data.email)
      return NextResponse.json({ success: true })
    } catch {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
