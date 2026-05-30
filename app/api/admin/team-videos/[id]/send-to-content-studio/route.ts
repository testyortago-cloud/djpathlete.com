import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSubmissionById, lockSubmission } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { createAiJob } from "@/lib/ai-jobs"
import { resolveVideoUploadForSubmission } from "@/lib/content-studio/promote-submission"
import { listImagesForVersion } from "@/lib/db/team-submission-images"
import { createMediaAsset } from "@/lib/db/media-assets"
import { createSocialPost } from "@/lib/db/social-posts"
import { attachMedia } from "@/lib/db/social-post-media"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { copyImageToMediaAssetsBucket } from "@/lib/storage/team-videos"
import { isPlatformPostTypeSupported } from "@/lib/content-studio/post-type-support"
import { pluginNameToPlatform } from "@/lib/social/platform-mapping"
import type {
  PostType,
  SocialPlatform,
  TeamVideoSubmission,
  TeamVideoVersion,
} from "@/types/database"

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })
  if (submission.status !== "approved") {
    return NextResponse.json(
      { error: "Only approved submissions can be sent to Content Studio" },
      { status: 409 },
    )
  }
  const version = await getCurrentVersion(submission.id)
  if (!version) return NextResponse.json({ error: "No current version" }, { status: 409 })

  if (submission.kind === "image_set") {
    return sendImageSet(submission, version, session.user.id)
  }
  return sendVideo(submission, version, session.user.id)
}

async function sendVideo(
  submission: TeamVideoSubmission,
  version: TeamVideoVersion,
  adminId: string,
) {
  // For video submissions both storage_path and original_filename are non-null
  // (image_set is the only kind that uses nulls). Guard before delegating.
  if (!version.storage_path || !version.original_filename) {
    return NextResponse.json(
      { error: "Video version is missing storage_path or original_filename" },
      { status: 409 },
    )
  }

  // Delegate to the shared promote-or-reuse helper so there is exactly one
  // promotion code path (the captioned-cut team flow uses the same helper). It
  // creates (or reuses) the video_uploads row, locks the submission, and
  // non-fatally queues transcription — preserving this route's prior behavior.
  const { videoUploadId } = await resolveVideoUploadForSubmission(submission.id, adminId)
  const videoUpload = await getVideoUploadById(videoUploadId)

  return NextResponse.json({ kind: "video", videoUpload }, { status: 201 })
}

async function sendImageSet(
  submission: TeamVideoSubmission,
  version: TeamVideoVersion,
  adminId: string,
) {
  const images = await listImagesForVersion(version.id)
  if (images.length === 0) {
    return NextResponse.json({ error: "Image set has no images" }, { status: 409 })
  }

  // 1. Copy each image into the media-assets path and create asset rows. The
  //    source object stays in team-videos/ for the audit trail; the copy lives
  //    under images/<submissionId>/ alongside other Content Studio assets.
  const assets = await Promise.all(
    images.map(async (img) => {
      const { storagePath, publicUrl } = await copyImageToMediaAssetsBucket({
        sourceStoragePath: img.storage_path,
        submissionId: submission.id,
        position: img.position,
        originalFilename: img.original_filename,
      })
      const asset = await createMediaAsset({
        kind: "image",
        storage_path: storagePath,
        public_url: publicUrl,
        mime_type: img.mime_type,
        bytes: img.size_bytes,
        width: img.width,
        height: img.height,
        duration_ms: null,
        derived_from_video_id: null,
        ai_alt_text: null,
        ai_analysis: null,
        created_by: adminId,
      })
      return { mediaAssetId: asset.id, position: img.position }
    }),
  )
  const orderedAssetIds = assets
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((a) => a.mediaAssetId)

  const postType: PostType = orderedAssetIds.length >= 2 ? "carousel" : "image"

  // 2. For each connected, compatible platform create one draft post. Plugin
  //    names that don't map to a social platform (google_ads, gmail) and
  //    platforms that don't support the chosen post_type are silently skipped.
  const connections = await listPlatformConnections()
  const compatible = connections
    .map((c) => pluginNameToPlatform(c.plugin_name))
    .filter((p): p is SocialPlatform => p !== null && isPlatformPostTypeSupported(p, postType))

  const socialPostIds: string[] = []
  for (const platform of compatible) {
    const post = await createSocialPost({
      platform,
      content: "",
      approval_status: "draft",
      post_type: postType,
      scheduled_at: null,
      source_video_id: null,
      media_url: null,
      created_by: adminId,
    })
    for (let i = 0; i < orderedAssetIds.length; i++) {
      await attachMedia(post.id, orderedAssetIds[i], i)
    }
    socialPostIds.push(post.id)

    // 3. Queue a caption-generation job per (post, platform). The Firebase
    //    image_caption_generation handler picks this up and writes a
    //    platform-aware caption back onto social_posts.content. A queue
    //    failure here is non-fatal: the post still exists with empty content,
    //    and the admin can re-trigger or write the caption manually.
    try {
      await createAiJob({
        type: "image_caption_generation",
        userId: adminId,
        input: {
          socialPostId: post.id,
          platform,
          mediaAssetIds: orderedAssetIds,
        },
      })
    } catch (err) {
      console.error(
        `[send-to-content-studio] Failed to queue caption job for post ${post.id}: ${(err as Error).message}`,
      )
    }
  }

  await lockSubmission(submission.id)

  return NextResponse.json(
    {
      kind: "image_set",
      mediaAssetIds: orderedAssetIds,
      socialPostIds,
    },
    { status: 201 },
  )
}
