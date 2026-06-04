// render-worker/src/lib/reel-project.ts
// Loads + writes the in-app reel editor's per-(video, mode) snapshot so the
// render honours operator edits. The editor persists a MEDIA-AGNOSTIC snapshot
// (no URLs); the worker uses a saved field ONLY when the operator locked it
// (edited_fields), otherwise it re-derives from live truth — then writes the
// RESOLVED snapshot back so the editor reflects exactly what was rendered (and
// the expensive face trajectory is cached). TWIN of the app's
// lib/db/reel-projects.ts + lib/validators/reel-projects.ts — keep in sync.
import type { SupabaseClient } from "@supabase/supabase-js"
import type { CaptionPage } from "./caption-paging.js"
import type { FacePoint } from "./face-track.js"

export type ReelMode = "split_reel" | "captioned_cut"

export type BrollEdit = { segmentIndex: number; startMs: number; endMs: number; enabled: boolean }

export type ReelProjectProps = {
  pages: CaptionPage[]
  accentHex: string
  trajectory: FacePoint[] | null
  broll: BrollEdit[]
  hook: { text: string } | null
  music: { track: string } | null
  trimStartMs: number
  trimEndMs: number | null
}

export type LoadedReelProject = { props: Partial<ReelProjectProps>; editedFields: string[] }

export async function loadReelProject(
  supabase: SupabaseClient,
  videoUploadId: string,
  mode: ReelMode,
): Promise<LoadedReelProject | null> {
  const { data, error } = await supabase
    .from("reel_projects")
    .select("props, edited_fields")
    .eq("video_upload_id", videoUploadId)
    .eq("mode", mode)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    props: (data.props ?? {}) as Partial<ReelProjectProps>,
    editedFields: (data.edited_fields ?? []) as string[],
  }
}

// Generic merge: use the saved value ONLY when the operator locked the field;
// otherwise the freshly-derived value. `trajectory` is NOT routed through here
// (it is worker-managed — see resolveTrajectory).
export function pickEdited<K extends keyof ReelProjectProps>(
  project: LoadedReelProject | null,
  field: K,
  derived: ReelProjectProps[K],
): ReelProjectProps[K] {
  if (project && project.editedFields.includes(field) && project.props[field] !== undefined) {
    return project.props[field] as ReelProjectProps[K]
  }
  return derived
}

// Tri-state trajectory cache (split mode): null/absent → detect; [] → computed,
// no face (center-crop, do NOT re-detect); non-empty → reuse the saved points.
// `detect` runs the 2–5 min face pass only when there's nothing usable saved.
export async function resolveTrajectory(
  project: LoadedReelProject | null,
  detect: () => Promise<FacePoint[]>,
): Promise<FacePoint[]> {
  const saved = project?.props.trajectory
  if (saved === undefined || saved === null) return detect()
  if (Array.isArray(saved)) return saved // [] = intentional center-crop; non-empty = reuse
  return detect()
}

// Default b-roll edit list (every ready clip enabled at its stored timing), used
// when the operator hasn't edited b-roll.
export function defaultBrollEdits(
  clips: { segmentIndex: number; startMs: number; endMs: number }[],
): BrollEdit[] {
  return clips.map((c) => ({
    segmentIndex: c.segmentIndex,
    startMs: c.startMs,
    endMs: c.endMs,
    enabled: true,
  }))
}

// Apply b-roll edits to the loaded (loopback-served) clips → the render-shape
// clip list. Disabled windows drop out; enabled windows take the edited timing.
// A loaded clip with no matching edit is kept at its default timing.
export function applyBrollEdits<
  T extends { segmentIndex: number; startMs: number; endMs: number; url: string },
>(clips: T[], edits: BrollEdit[]): { startMs: number; endMs: number; src: string }[] {
  const byIndex = new Map(edits.map((e) => [e.segmentIndex, e]))
  const out: { startMs: number; endMs: number; src: string }[] = []
  for (const c of clips) {
    const e = byIndex.get(c.segmentIndex)
    if (e && !e.enabled) continue
    out.push({ startMs: e?.startMs ?? c.startMs, endMs: e?.endMs ?? c.endMs, src: c.url })
  }
  return out
}

// Write the resolved snapshot back so the editor reflects what was rendered and
// the trajectory is cached. Best-effort at the call site — never fail a render
// because the snapshot write hiccuped.
export async function saveResolvedSnapshot(
  supabase: SupabaseClient,
  videoUploadId: string,
  mode: ReelMode,
  props: ReelProjectProps,
  editedFields: string[],
): Promise<void> {
  const { error } = await supabase.from("reel_projects").upsert(
    {
      video_upload_id: videoUploadId,
      mode,
      props,
      edited_fields: editedFields,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "video_upload_id,mode" },
  )
  if (error) throw error
}
