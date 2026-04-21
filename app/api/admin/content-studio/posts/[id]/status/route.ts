import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"
import type { SocialApprovalStatus } from "@/types/database"

const ALLOWED_COLUMNS = ["needs_review", "approved", "scheduled", "published", "failed"] as const
type TargetColumn = (typeof ALLOWED_COLUMNS)[number]

function isColumn(v: unknown): v is TargetColumn {
  return typeof v === "string" && (ALLOWED_COLUMNS as readonly string[]).includes(v)
}

// Map the UI column concept to the DB approval_status enum.
// The "needs_review" column collects draft + edited posts; when a post is
// dragged INTO it, we write `draft` as the canonical "hasn't been acted on"
// state. Failed is a special case: the DB enum has `failed` but dragging INTO
// failed isn't a real user flow — we still accept it for completeness.
function columnToStatus(column: Exclude<TargetColumn, "scheduled" | "published">): SocialApprovalStatus {
  switch (column) {
    case "needs_review":
      return "draft"
    case "approved":
      return "approved"
    case "failed":
      return "failed"
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { targetColumn?: string } | null
  const target = body?.targetColumn
  if (!isColumn(target)) {
    return NextResponse.json(
      {
        error: "targetColumn must be one of needs_review|approved|scheduled|published|failed",
      },
      { status: 400 },
    )
  }

  if (target === "scheduled") {
    return NextResponse.json({ error: "Use the schedule dialog to pick a date/time" }, { status: 409 })
  }
  if (target === "published") {
    return NextResponse.json({ error: "Posts publish automatically — use Publish Now instead" }, { status: 409 })
  }

  const { id } = await params
  const post = await getSocialPostById(id)
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })

  const nextStatus = columnToStatus(target)

  const patch: Parameters<typeof updateSocialPost>[1] = { approval_status: nextStatus }
  if (target === "needs_review" && post.approval_status === "failed") {
    patch.rejection_notes = null
    patch.scheduled_at = null
  }

  const updated = await updateSocialPost(id, patch)
  return NextResponse.json({ id: updated.id, approval_status: updated.approval_status })
}
