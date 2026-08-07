// app/api/admin/marketing/about/route.ts
// PATCH the single about_page_content row. Admin-only. Revalidates /about
// on success so the public page picks up the change without a redeploy.

import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { aboutPageContentSchema } from "@/lib/validators/about-page"
import { updateAboutPageContent } from "@/lib/db/about-page"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export const PATCH = withAudit(
  { action: "about_page.update", category: "marketing" },
  async (request) => {
    try {
      const session = await auth()
      if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const raw = await request.json().catch(() => null)
      const parsed = aboutPageContentSchema.safeParse(raw)
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid body", issues: parsed.error.issues },
          { status: 400 },
        )
      }

      const content = await updateAboutPageContent(parsed.data)
      revalidatePath("/about")

      return NextResponse.json({ content })
    } catch (error) {
      console.error("About page PATCH error:", error)
      return NextResponse.json(
        { error: "Failed to save About page content" },
        { status: 500 },
      )
    }
  },
)
