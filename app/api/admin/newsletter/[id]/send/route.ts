import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { sendNewsletterNow, NewsletterNotSendableError } from "@/lib/newsletter/send-newsletter"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export const POST = withAudit(
  {
    action: "newsletter.sent",
    category: "marketing",
    target: async (_request, ctx) => {
      const { id } = await ctx.params
      return { type: "newsletter", id }
    },
  },
  async (_request, { params }) => {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    try {
      await sendNewsletterNow({ id, actorId: session.user.id })
    } catch (err) {
      if (err instanceof NewsletterNotSendableError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Newsletter send error:", error)
    return NextResponse.json({ error: "Failed to send newsletter" }, { status: 500 })
  }
  },
)
