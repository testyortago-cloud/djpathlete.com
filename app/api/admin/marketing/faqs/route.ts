// app/api/admin/marketing/faqs/route.ts
// GET lists FAQs for a page; POST creates a new FAQ. Admin-only.

import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { faqInputSchema } from "@/lib/validators/faq"
import { createFaq, listFaqsForPage } from "@/lib/db/faqs"
import { resolveFaqPage } from "@/lib/faq/pages"
import { withAudit } from "@/lib/audit/with-audit"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const pageKey = searchParams.get("page_key")
    if (!pageKey) {
      return NextResponse.json({ error: "page_key required" }, { status: 400 })
    }

    const faqs = await listFaqsForPage(pageKey)
    return NextResponse.json({ faqs })
  } catch (error) {
    console.error("FAQ GET error:", error)
    return NextResponse.json({ error: "Failed to fetch FAQs" }, { status: 500 })
  }
}

export const POST = withAudit(
  {
    action: "faq.create",
    category: "marketing",
    metadata: (_req, res) => {
      const id = res.headers.get("x-audit-target-id")
      return id ? { target_id: id } : {}
    },
  },
  async (request) => {
    try {
      const session = await auth()
      if (!session?.user?.id || session.user.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const raw = await request.json().catch(() => null)
      const parsed = faqInputSchema.safeParse(raw)
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid body", issues: parsed.error.issues },
          { status: 400 },
        )
      }

      const faq = await createFaq(parsed.data)

      const route = resolveFaqPage(faq.page_key)?.routePath
      if (route) revalidatePath(route)

      const response = NextResponse.json({ faq }, { status: 201 })
      response.headers.set("x-audit-target-id", faq.id)
      return response
    } catch (error) {
      console.error("FAQ POST error:", error)
      return NextResponse.json({ error: "Failed to create FAQ" }, { status: 500 })
    }
  },
)
