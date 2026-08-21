import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getNewsletterById, updateNewsletter, deleteNewsletter } from "@/lib/db/newsletters"
import { newsletterFormSchema } from "@/lib/validators/newsletter"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const newsletter = await getNewsletterById(id)
    return NextResponse.json(newsletter)
  } catch (error) {
    console.error("Newsletter GET error:", error)
    return NextResponse.json({ error: "Failed to fetch newsletter" }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const existing = await getNewsletterById(id)

    if (existing.status === "sent") {
      return NextResponse.json({ error: "Cannot edit a sent newsletter" }, { status: 400 })
    }

    const body = await request.json()
    const parsed = newsletterFormSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    // Clear any stale "Missed" reason on save — otherwise the badge from a
    // schedule that failed weeks ago keeps showing on the list even after
    // the coach fixed the newsletter and saved it again.
    const updated = await updateNewsletter(id, { ...parsed.data, schedule_failed_reason: null })
    return NextResponse.json(updated)
  } catch (error) {
    console.error("Newsletter PATCH error:", error)
    return NextResponse.json({ error: "Failed to update newsletter" }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    await deleteNewsletter(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Newsletter DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete newsletter" }, { status: 500 })
  }
}
