import { createServiceRoleClient } from "@/lib/supabase"
import type { SocialPost, VideoUpload } from "@/types/database"

export interface SearchResults {
  videos: Array<Pick<VideoUpload, "id" | "title" | "original_filename" | "status">>
  transcripts: Array<{
    id: string
    video_upload_id: string
    snippet: string
    video_filename: string | null
  }>
  posts: Array<
    Pick<
      SocialPost,
      "id" | "platform" | "content" | "approval_status" | "source_video_id"
    > & {
      source_video_filename: string | null
    }
  >
}

const EMPTY: SearchResults = { videos: [], transcripts: [], posts: [] }

const LIMIT = 10

export async function searchContentStudio(query: string): Promise<SearchResults> {
  const q = query.trim()
  if (!q) return EMPTY
  const supabase = createServiceRoleClient()
  const likePattern = `%${q}%`

  const [vidRes, transRes, postRes] = await Promise.all([
    supabase
      .from("video_uploads")
      .select("id, title, original_filename, status")
      .or(`title.ilike.${likePattern},original_filename.ilike.${likePattern}`)
      .limit(LIMIT),
    supabase
      .from("video_transcripts")
      .select("id, video_upload_id, transcript_text, video_uploads(original_filename)")
      .textSearch("transcript_tsv", q, { type: "plain", config: "english" })
      .limit(LIMIT),
    supabase
      .from("social_posts")
      .select(
        "id, platform, content, approval_status, source_video_id, video_uploads(original_filename)",
      )
      .ilike("content", likePattern)
      .limit(LIMIT),
  ])

  if (vidRes.error) throw vidRes.error
  if (transRes.error) throw transRes.error
  if (postRes.error) throw postRes.error

  return {
    videos: (vidRes.data ?? []) as SearchResults["videos"],
    transcripts: (transRes.data ?? []).map((r) => {
      const rec = r as {
        id: string
        video_upload_id: string
        transcript_text: string
        video_uploads: { original_filename: string } | null
      }
      const text = rec.transcript_text
      const idx = text.toLowerCase().indexOf(q.toLowerCase())
      const start = Math.max(0, idx - 40)
      const end = Math.min(
        text.length,
        (idx === -1 ? 0 : idx) + q.length + 80,
      )
      const snippet =
        (start > 0 ? "…" : "") +
        text.slice(start, end) +
        (end < text.length ? "…" : "")
      return {
        id: rec.id,
        video_upload_id: rec.video_upload_id,
        snippet,
        video_filename: rec.video_uploads?.original_filename ?? null,
      }
    }),
    posts: (postRes.data ?? []).map((r) => {
      const rec = r as SocialPost & {
        video_uploads: { original_filename: string } | null
      }
      return {
        id: rec.id,
        platform: rec.platform,
        content: rec.content,
        approval_status: rec.approval_status,
        source_video_id: rec.source_video_id,
        source_video_filename: rec.video_uploads?.original_filename ?? null,
      }
    }),
  }
}
