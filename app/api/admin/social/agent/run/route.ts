// app/api/admin/social/agent/run/route.ts
// POST { platform?: "linkedin"; blogPostId?: string } — queue an autonomous
// social-agent run. The Firebase Function `socialAgent` picks it up, drafts a
// LinkedIn post, and lands it as a draft in /admin/social.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { canAccessAdminPath } from "@/lib/permissions/guard"

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

  const input: Record<string, unknown> = { platform }
  if (body?.blogPostId) input.blogPostId = body.blogPostId

  const { jobId, status } = await createAiJob({
    type: "social_agent_run",
    userId: session.user.id,
    input,
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
