// POST /api/admin/blog/[id]/refresh
// Admin-only. Enqueues a Firestore ai_jobs doc of type "blog_refresh" for the
// given blog_post. The Firebase blogRefresh trigger picks it up.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getBlogPostById } from "@/lib/db/blog-posts"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"

const RefreshBodySchema = z
  .object({
    triggerReason: z.string().max(200).optional(),
    gscTopQueries: z.array(z.string().min(1).max(200)).max(20).optional(),
  })
  .strict()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params

  // Confirm the post exists before enqueuing.
  try {
    await getBlogPostById(id)
  } catch {
    return NextResponse.json({ error: "Blog post not found" }, { status: 404 })
  }

  const raw = await request.json().catch(() => ({}))
  const parsed = RefreshBodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  const { triggerReason, gscTopQueries } = parsed.data

  const db = getAdminFirestore()
  const jobRef = db.collection("ai_jobs").doc()

  await jobRef.set({
    type: "blog_refresh",
    status: "pending",
    input: {
      blogPostId: id,
      triggerReason: triggerReason ?? "manual",
      userId: session.user.id,
      ...(gscTopQueries?.length ? { references: { gscTopQueries } } : {}),
    },
    result: null,
    error: null,
    userId: session.user.id,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    triggeredBy: "manual_refresh_button",
  })

  return NextResponse.json({ jobId: jobRef.id, status: "pending" }, { status: 202 })
}
