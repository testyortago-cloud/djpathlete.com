// app/api/admin/content-studio/captioned-cut/suggest-hook/route.ts
// POST { videoUploadId } — suggests a single hook title from the video's speech
// transcript, for the captioned-cut opening card. Admin-only, gated by the same
// feature_captioned_cut_enabled flag as the render itself.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSetting } from "@/lib/db/system-settings"
import { getSpeechTranscriptForVideo } from "@/lib/db/video-transcripts"
import { suggestHookFromTranscript } from "@/lib/ai/hook-suggestion"

export async function POST(request: NextRequest | Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const enabled = await getSetting<boolean>("feature_captioned_cut_enabled", false)
  if (!enabled) {
    return NextResponse.json({ error: "Captioned Cut is disabled." }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as { videoUploadId?: string } | null
  const videoUploadId = body?.videoUploadId
  if (!videoUploadId) {
    return NextResponse.json({ error: "videoUploadId is required" }, { status: 400 })
  }

  const transcript = await getSpeechTranscriptForVideo(videoUploadId)
  if (!transcript?.transcript_text) {
    return NextResponse.json(
      { error: "No speech transcript yet — a hook needs a spoken-audio transcript first." },
      { status: 422 },
    )
  }

  const hook = await suggestHookFromTranscript(transcript.transcript_text)
  return NextResponse.json({ hook }, { status: 200 })
}
