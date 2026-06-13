// app/api/admin/marketing/step-up/route.ts
// PATCH the single step_up_page_content row. Admin-only. Revalidates
// /step-up-for-students on success so the public page picks up the change.

import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { stepUpPageContentSchema } from "@/lib/validators/step-up-page"
import { updateStepUpPageContent } from "@/lib/db/step-up-page"
import { withAudit } from "@/lib/audit/with-audit"

export const PATCH = withAudit(
  { action: "step_up_page.update", category: "marketing" },
  async (request) => {
    try {
      const session = await auth()
      if (!session?.user?.id || session.user.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const raw = await request.json().catch(() => null)
      const parsed = stepUpPageContentSchema.safeParse(raw)
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid body", issues: parsed.error.issues },
          { status: 400 },
        )
      }

      const content = await updateStepUpPageContent(parsed.data)
      revalidatePath("/step-up-for-students")

      return NextResponse.json({ content })
    } catch (error) {
      console.error("Step Up page PATCH error:", error)
      return NextResponse.json(
        { error: "Failed to save Step Up For Students page content" },
        { status: 500 },
      )
    }
  },
)
