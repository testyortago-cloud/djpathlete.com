// app/api/admin/marketing/athletes/route.ts
// PATCH the single athletes_page_content row. Admin-only. Revalidates
// /athletes on success so the public page picks up the change immediately.

import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { athletesPageContentSchema } from "@/lib/validators/athletes-page"
import { updateAthletesPageContent } from "@/lib/db/athletes-page"
import { withAudit } from "@/lib/audit/with-audit"

export const PATCH = withAudit(
  { action: "athletes_page.update", category: "marketing" },
  async (request) => {
    try {
      const session = await auth()
      if (!session?.user?.id || session.user.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const raw = await request.json().catch(() => null)
      const parsed = athletesPageContentSchema.safeParse(raw)
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid body", issues: parsed.error.issues },
          { status: 400 },
        )
      }

      const content = await updateAthletesPageContent(parsed.data)
      revalidatePath("/athletes")

      return NextResponse.json({ content })
    } catch (error) {
      console.error("Athletes page PATCH error:", error)
      return NextResponse.json(
        { error: "Failed to save Athletes page content" },
        { status: 500 },
      )
    }
  },
)
