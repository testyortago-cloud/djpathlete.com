// app/api/admin/marketing/faqs/reorder/route.ts
// POST persists a new FAQ ordering for one page. Admin-only.

import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { reorderFaqs } from "@/lib/db/faqs"
import { resolveFaqPage } from "@/lib/faq/pages"
import { withAudit } from "@/lib/audit/with-audit"

const reorderSchema = z.object({
  page_key: z.string().min(1),
  ordered_ids: z.array(z.string().min(1)),
})

export const POST = withAudit(
  {
    action: "faq.reorder",
    category: "marketing",
  },
  async (request) => {
    try {
      const session = await auth()
      if (!session?.user?.id || session.user.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const raw = await request.json().catch(() => null)
      const parsed = reorderSchema.safeParse(raw)
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid body", issues: parsed.error.issues },
          { status: 400 },
        )
      }

      await reorderFaqs(parsed.data.ordered_ids)

      const route = resolveFaqPage(parsed.data.page_key)?.routePath
      if (route) revalidatePath(route)

      return NextResponse.json({ ok: true })
    } catch (error) {
      console.error("FAQ reorder error:", error)
      return NextResponse.json({ error: "Failed to reorder FAQs" }, { status: 500 })
    }
  },
)
