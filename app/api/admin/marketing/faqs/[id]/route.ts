// app/api/admin/marketing/faqs/[id]/route.ts
// PATCH updates an existing FAQ; DELETE removes it. Admin-only.

import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { faqInputSchema } from "@/lib/validators/faq"
import { deleteFaq, updateFaq } from "@/lib/db/faqs"
import { resolveFaqPage } from "@/lib/faq/pages"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export const PATCH = withAudit(
  {
    action: "faq.update",
    category: "marketing",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "faq", id }
    },
  },
  async (request, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    try {
      const session = await auth()
      if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const { id } = await params
      const raw = await request.json().catch(() => null)
      const parsed = faqInputSchema.safeParse(raw)
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid body", issues: parsed.error.issues },
          { status: 400 },
        )
      }

      const faq = await updateFaq(id, parsed.data)

      const route = resolveFaqPage(faq.page_key)?.routePath
      if (route) revalidatePath(route)

      return NextResponse.json({ faq })
    } catch (error) {
      console.error("FAQ PATCH error:", error)
      return NextResponse.json({ error: "Failed to update FAQ" }, { status: 500 })
    }
  },
)

export const DELETE = withAudit(
  {
    action: "faq.delete",
    category: "marketing",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "faq", id }
    },
  },
  async (request, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    try {
      const session = await auth()
      if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const { id } = await params
      const { searchParams } = new URL(request.url)
      const pageKey = searchParams.get("page_key")

      await deleteFaq(id)

      // page_key arrives as a query param so we can revalidate the right route.
      const route = pageKey ? resolveFaqPage(pageKey)?.routePath : undefined
      if (route) revalidatePath(route)

      return NextResponse.json({ ok: true })
    } catch (error) {
      console.error("FAQ DELETE error:", error)
      return NextResponse.json({ error: "Failed to delete FAQ" }, { status: 500 })
    }
  },
)
