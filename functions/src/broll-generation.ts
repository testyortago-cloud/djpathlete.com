// functions/src/broll-generation.ts
// Handler for ai_jobs of type "broll_generation". Selects b-roll moments from the
// transcript, writes broll_segments rows, reuses cached clips, and submits the rest
// to fal's queue with a webhook. Leaves the job in "processing"; the fal webhook
// flips it to "completed" once every segment is ready.
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getSupabase } from "./lib/supabase.js"
import { fetchTranscriptWords } from "./lib/assemblyai-words.js"
import { selectBrollMoments } from "./ai/broll-select.js"
import { submitBrollClip } from "./lib/fal-broll.js"
import { postProcessWindows, brollCacheKey } from "./lib/broll-selection.js"
import { suggestHookFromTranscript } from "./lib/hook-suggestion.js"

export async function handleBrollGeneration(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)
  const supabase = getSupabase()

  try {
    const jobSnap = await jobRef.get()
    const input = jobSnap.data()?.input as { videoUploadId: string } | undefined
    const videoUploadId = input?.videoUploadId
    if (!videoUploadId) throw new Error("broll_generation: missing videoUploadId")

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    // Settings
    const settings = await loadSplitReelSettings(supabase)

    // Transcript words
    const { data: tx } = await supabase
      .from("video_transcripts")
      .select("assemblyai_job_id")
      .eq("video_upload_id", videoUploadId)
      .eq("source", "speech")
      .not("assemblyai_job_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!tx?.assemblyai_job_id) throw new Error("no speech transcript for video")
    const words = await fetchTranscriptWords(tx.assemblyai_job_id)
    if (words.length === 0) throw new Error("transcript has no words")
    const totalMs = words[words.length - 1].end

    // Auto-write the opening hook from the transcript and stash it on the video
    // row so the Split Reel render can burn it onto the first frame. Best-effort:
    // a hook failure must NEVER fail the b-roll job — the render just omits the card.
    try {
      const transcriptText = words.map((w) => w.text).join(" ")
      const hook = await suggestHookFromTranscript(transcriptText)
      if (hook) {
        // Only set the hook when none exists yet, so a "Regenerate"/re-run never
        // clobbers a coach-edited hook (the panel edits hook_text directly).
        const { error: hookErr } = await supabase
          .from("video_uploads")
          .update({ hook_text: hook })
          .eq("id", videoUploadId)
          .is("hook_text", null)
        if (hookErr) console.warn("[broll_generation] hook write failed (non-fatal):", hookErr.message)
      }
    } catch (e) {
      console.warn("[broll_generation] hook suggestion failed (non-fatal):", (e as Error).message)
    }

    // AI selection → post-process
    const selected = await selectBrollMoments({
      words,
      windowSeconds: settings.windowSeconds,
      maxWindows: settings.maxWindows,
    })
    const { kept, dropped } = postProcessWindows(
      selected.segments.map((s) => ({ startMs: s.start_ms, endMs: s.end_ms, concept: s.concept, prompt: s.visual_prompt })),
      { maxWindows: settings.maxWindows, minGapMs: settings.minGapSeconds * 1000, totalMs },
    )

    // Phase 3: persist dropped windows (status='dropped', indexed AFTER the kept
    // ones so the (video_upload_id, segment_index) unique index holds) so the
    // review panel can surface them. The worker loads only status='ready', so
    // these never reach the render.
    if (dropped.length > 0) {
      await supabase.from("broll_segments").insert(
        dropped.map((win, i) => ({
          video_upload_id: videoUploadId,
          generation_job_id: jobId,
          segment_index: kept.length + i,
          start_ms: win.startMs,
          end_ms: win.endMs,
          concept: win.concept,
          prompt: win.prompt,
          cache_key: brollCacheKey(win.prompt, settings.model, settings.windowSeconds),
          media_asset_id: null,
          status: "dropped" as const,
        })),
      )
    }

    if (kept.length === 0) {
      // Nothing to illustrate — complete immediately so the chain can still render
      // a full-frame-only reel.
      await jobRef.update({
        status: "completed",
        error: null,
        result: { segmentCount: 0, droppedCount: dropped.length },
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }

    const baseUrl = requireBaseUrl()
    const secret = process.env.BROLL_WEBHOOK_SECRET
    if (!secret) throw new Error("BROLL_WEBHOOK_SECRET not set")

    // Write rows, reuse cache, submit the rest.
    for (let i = 0; i < kept.length; i += 1) {
      const win = kept[i]
      const cacheKey = brollCacheKey(win.prompt, settings.model, settings.windowSeconds)
      const cachedAssetId = await findReadyAssetByCacheKey(supabase, cacheKey)

      const { data: seg, error: segErr } = await supabase
        .from("broll_segments")
        .insert({
          video_upload_id: videoUploadId,
          generation_job_id: jobId,
          segment_index: i,
          start_ms: win.startMs,
          end_ms: win.endMs,
          concept: win.concept,
          prompt: win.prompt,
          cache_key: cacheKey,
          media_asset_id: cachedAssetId,
          status: cachedAssetId ? "ready" : "pending",
        })
        .select()
        .single()
      if (segErr || !seg) throw new Error(`insert broll_segment ${i} failed: ${segErr?.message}`)
      if (cachedAssetId) continue // reused — no fal call

      const webhookUrl = `${baseUrl}/api/webhooks/fal-broll?segment_id=${seg.id}&token=${secret}`
      const { requestId } = await submitBrollClip({
        model: settings.model,
        prompt: win.prompt,
        durationSeconds: settings.windowSeconds,
        webhookUrl,
      })
      await supabase.from("broll_segments").update({ status: "generating", fal_request_id: requestId }).eq("id", seg.id)
    }

    // If every kept segment was cache-served, complete now; else the webhook will.
    await maybeCompleteJob(supabase, jobRef, jobId)
  } catch (err) {
    await jobRef
      .update({ status: "failed", error: (err as Error).message ?? "broll_generation failed", updatedAt: FieldValue.serverTimestamp() })
      .catch(() => {})
    console.error("[broll_generation]", err)
  }
}

type SplitReelSettings = { model: string; windowSeconds: number; maxWindows: number; minGapSeconds: number }
async function loadSplitReelSettings(supabase: ReturnType<typeof getSupabase>): Promise<SplitReelSettings> {
  const { data } = await supabase.from("system_settings").select("key,value").in("key", [
    "split_reel_broll_model",
    "split_reel_broll_window_seconds",
    "split_reel_max_broll_windows",
    "split_reel_min_gap_seconds",
  ])
  const map = new Map((data ?? []).map((r) => [r.key as string, r.value]))
  return {
    model: (map.get("split_reel_broll_model") as string) ?? "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    windowSeconds: (map.get("split_reel_broll_window_seconds") as number) ?? 5,
    maxWindows: (map.get("split_reel_max_broll_windows") as number) ?? 6,
    minGapSeconds: (map.get("split_reel_min_gap_seconds") as number) ?? 4,
  }
}

async function findReadyAssetByCacheKey(supabase: ReturnType<typeof getSupabase>, cacheKey: string): Promise<string | null> {
  const { data } = await supabase
    .from("broll_segments")
    .select("media_asset_id")
    .eq("cache_key", cacheKey)
    .eq("status", "ready")
    .not("media_asset_id", "is", null)
    .limit(1)
    .maybeSingle()
  return (data?.media_asset_id as string | undefined) ?? null
}

// Exported so the webhook reuses the same completion logic.
export async function maybeCompleteJob(
  supabase: ReturnType<typeof getSupabase>,
  jobRef: FirebaseFirestore.DocumentReference,
  jobId: string,
): Promise<void> {
  const { data } = await supabase.from("broll_segments").select("status").eq("generation_job_id", jobId)
  const rows = data ?? []
  const pendingOrGenerating = rows.filter((r) => r.status === "pending" || r.status === "generating")
  if (pendingOrGenerating.length > 0) return
  const ready = rows.filter((r) => r.status === "ready").length
  await jobRef.update({
    status: "completed",
    error: null,
    result: { segmentCount: ready },
    updatedAt: FieldValue.serverTimestamp(),
  })
}

function requireBaseUrl(): string {
  // Mirror the AssemblyAI webhook submission (transcribe-video.ts): NEXT_PUBLIC_APP_URL ?? APP_URL.
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL/APP_URL not set for webhook callback")
  return base.replace(/\/$/, "")
}
