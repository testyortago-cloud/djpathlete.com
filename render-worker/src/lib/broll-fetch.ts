// render-worker/src/lib/broll-fetch.ts
// Load the ready b-roll segments for a video from Supabase, download each clip to a
// local dir, and serve each over loopback (OffthreadVideo needs http://, not file://).
import type { SupabaseClient } from "@supabase/supabase-js"
import path from "node:path"
import { serveFileLocally } from "./serve-file.js"

export type ReadyBrollClip = { startMs: number; endMs: number; url: string; close: () => Promise<void> }

export async function loadReadyBrollClips(
  supabase: SupabaseClient,
  bucket: { file: (p: string) => { download: (o: { destination: string }) => Promise<unknown> } },
  videoUploadId: string,
  workDir: string,
): Promise<ReadyBrollClip[]> {
  const { data: segs, error } = await supabase
    .from("broll_segments")
    .select("segment_index,start_ms,end_ms,media_asset_id,status")
    .eq("video_upload_id", videoUploadId)
    .eq("status", "ready")
    .not("media_asset_id", "is", null)
    .order("segment_index", { ascending: true })
  if (error) throw error
  const rows = segs ?? []
  if (rows.length === 0) return []

  const assetIds = rows.map((r) => r.media_asset_id as string)
  const { data: assets, error: aErr } = await supabase
    .from("media_assets")
    .select("id,storage_path")
    .in("id", assetIds)
  if (aErr) throw aErr
  const pathById = new Map((assets ?? []).map((a) => [a.id as string, a.storage_path as string]))

  const clips: ReadyBrollClip[] = []
  for (const r of rows) {
    const storagePath = pathById.get(r.media_asset_id as string)
    if (!storagePath) continue
    const local = path.join(workDir, `broll-${r.segment_index}.mp4`)
    await bucket.file(storagePath).download({ destination: local })
    const server = await serveFileLocally(local)
    clips.push({ startMs: r.start_ms as number, endMs: r.end_ms as number, url: server.url, close: server.close })
  }
  return clips
}
