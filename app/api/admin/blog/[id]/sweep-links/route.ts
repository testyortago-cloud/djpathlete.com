// POST /api/admin/blog/[id]/sweep-links
// Admin-only. For the given TARGET post, computes top 5 candidate posts via
// tag-overlap scoring and enqueues an internal_link_sweep ai_job that will
// push inbound links from those candidates to the target.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBlogPostById } from "@/lib/db/blog-posts"
import { createServiceRoleClient } from "@/lib/supabase"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { scoreInternalLinks } from "@/lib/blog/internal-link-scoring"
import type { BlogPost } from "@/types/database"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const CANDIDATE_POOL_SIZE = 50

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params

  let target: BlogPost
  try {
    target = (await getBlogPostById(id)) as BlogPost
  } catch {
    return NextResponse.json({ error: "Blog post not found" }, { status: 404 })
  }

  // Fetch top N most-recently-published OTHER posts and score them.
  const supabase = createServiceRoleClient()
  const { data: candidatePool, error: fetchErr } = await supabase
    .from("blog_posts")
    .select("id, title, slug, tags, category")
    .eq("status", "published")
    .neq("id", id)
    .order("published_at", { ascending: false })
    .limit(CANDIDATE_POOL_SIZE)
  if (fetchErr) {
    return NextResponse.json({ error: `Candidate fetch failed: ${fetchErr.message}` }, { status: 500 })
  }

  type CandidateRow = { id: string; title: string; slug: string; tags: string[] | null; category: string | null }
  const candidates = (candidatePool as CandidateRow[] | null) ?? []

  const scored = scoreInternalLinks(
    {
      id: target.id,
      title: target.title,
      slug: target.slug,
      tags: target.tags ?? [],
      category: target.category ?? null,
    },
    candidates.map((c) => ({
      id: c.id,
      title: c.title,
      slug: c.slug,
      tags: c.tags ?? [],
      category: c.category,
    })),
  )

  if (scored.length === 0) {
    return NextResponse.json(
      { error: "No candidate posts with topical overlap found. Try adding more tags to this post." },
      { status: 409 },
    )
  }

  const candidateAnchorPostIds = scored.map((s) => s.blog_post_id)

  const db = getAdminFirestore()
  const jobRef = db.collection("ai_jobs").doc()

  await jobRef.set({
    type: "internal_link_sweep",
    status: "pending",
    input: {
      targetBlogPostId: id,
      candidateAnchorPostIds,
      userId: session.user.id,
    },
    result: null,
    error: null,
    userId: session.user.id,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    triggeredBy: "manual_sweep_button",
  })

  return NextResponse.json(
    {
      jobId: jobRef.id,
      status: "pending",
      candidateCount: candidateAnchorPostIds.length,
    },
    { status: 202 },
  )
}
