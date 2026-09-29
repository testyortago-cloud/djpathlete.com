// app/api/admin/social/agent/run/route.ts
// POST { platform?: "linkedin"; blogPostId?: string } — queue an autonomous
// social-agent run. The Firebase Function `socialAgent` picks it up, drafts a
// LinkedIn post, and lands it as a draft in /admin/social.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { platformBusinessId } from "@/lib/tenancy/platform"
import { SITE_URL } from "@/lib/constants"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as
    | { platform?: string; blogPostId?: string }
    | null

  const platform = body?.platform ?? "linkedin"
  if (platform !== "linkedin") {
    return NextResponse.json(
      { error: `Unsupported platform "${platform}". This phase supports linkedin only.` },
      { status: 400 },
    )
  }

  // businessId (G35): whose owners get the agent's "no eligible topic" alert.
  // The PLATFORM's, not the business this admin has selected, although this
  // route has a session and could resolve one: every table the social agent
  // reads and writes (blog_posts, strategy_briefs, social_posts,
  // platform_connections, social_agent_memos) has no business_id, so the run
  // is about darrenjpaul.com's blog whichever business is selected. Stamping
  // the selected one would alert a coach's owners about the platform's posts.
  // lib/tenancy/platform.ts lists this route under CORRECT BY CONSTRUCTION.
  // siteUrl: the agent writes the link card (link_* columns) only when the job
  // carries it, so without it a manual run's draft publishes as bare text.
  const input: Record<string, unknown> = { platform, businessId: platformBusinessId(), siteUrl: SITE_URL }
  if (body?.blogPostId) input.blogPostId = body.blogPostId

  const { jobId, status } = await createAiJob({
    type: "social_agent_run",
    userId: session.user.id,
    input,
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
