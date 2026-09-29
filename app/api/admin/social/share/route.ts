// app/api/admin/social/share/route.ts
// POST { blogPostId } | { newsletterId } — "Share to LinkedIn". Returns an
// existing un-posted LinkedIn draft from the same source if there is one;
// otherwise queues the social agent (functions/src/social-agent.ts), which
// drafts the post in the brand voice with a link card and lands it in
// /admin/social for review. Spec: docs/superpowers/specs/2026-09-29-share-to-linkedin-design.md
//
// The dedupe is check-then-enqueue, not atomic: two concurrent requests can
// both draft. The button disables itself while a request is in flight.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { platformBusinessId } from "@/lib/tenancy/platform"
import { SITE_URL } from "@/lib/constants"
import { getBlogPostById } from "@/lib/db/blog-posts"
import { getNewsletterById } from "@/lib/db/newsletters"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { findOpenShareDraft, type ShareSource } from "@/lib/db/social-posts"

// The getters use .single() and throw the raw PostgREST error; zero rows is
// PGRST116. Anything else (timeout, outage) is a failure, not a missing row.
function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "PGRST116"
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    blogPostId?: unknown
    newsletterId?: unknown
  } | null
  const blogPostId = typeof body?.blogPostId === "string" && body.blogPostId ? body.blogPostId : null
  const newsletterId = typeof body?.newsletterId === "string" && body.newsletterId ? body.newsletterId : null
  if (blogPostId && newsletterId) {
    return NextResponse.json({ error: "Send blogPostId or newsletterId, not both" }, { status: 400 })
  }
  if (!blogPostId && !newsletterId) {
    return NextResponse.json({ error: "Send blogPostId or newsletterId" }, { status: 400 })
  }

  let source: ShareSource
  if (blogPostId) {
    let post
    try {
      post = await getBlogPostById(blogPostId)
    } catch (err) {
      if (isNotFound(err)) return NextResponse.json({ error: "Blog post not found" }, { status: 404 })
      console.error("[social/share] blog post lookup failed", err)
      return NextResponse.json({ error: "Couldn't load the blog post" }, { status: 500 })
    }
    if (post.status !== "published") {
      return NextResponse.json({ error: "Only published posts can be shared" }, { status: 409 })
    }
    source = { blogPostId }
  } else {
    let issue
    try {
      issue = await getNewsletterById(newsletterId!)
    } catch (err) {
      if (isNotFound(err)) return NextResponse.json({ error: "Newsletter not found" }, { status: 404 })
      console.error("[social/share] newsletter lookup failed", err)
      return NextResponse.json({ error: "Couldn't load the newsletter" }, { status: 500 })
    }
    if (issue.status !== "sent" && issue.status !== "scheduled") {
      return NextResponse.json({ error: "Only sent or scheduled issues can be shared" }, { status: 409 })
    }
    source = { newsletterId: newsletterId! }
  }

  const connections = await listPlatformConnections()
  if (!connections.some((c) => c.plugin_name === "linkedin" && c.status === "connected")) {
    return NextResponse.json({ error: "Connect LinkedIn first (Platform connections)" }, { status: 409 })
  }

  const existing = await findOpenShareDraft(source)
  if (existing) return NextResponse.json({ existingPostId: existing.id }, { status: 200 })

  // businessId: the PLATFORM's, for the same reason as agent/run (see
  // lib/tenancy/platform.ts): nothing the social agent reads or writes has a
  // business_id, and the blog and newsletter are darrenjpaul.com's own.
  const { jobId } = await createAiJob({
    type: "social_agent_run",
    userId: session.user.id,
    input: { platform: "linkedin", ...source, siteUrl: SITE_URL, businessId: platformBusinessId() },
  })
  return NextResponse.json({ jobId }, { status: 202 })
}
