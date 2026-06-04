// lib/validators/reel-projects.ts
// Zod schema for the MEDIA-AGNOSTIC reel-project snapshot (props jsonb) that both
// the in-app reel editor and the render worker consume. The schema STRUCTURALLY
// rejects media URLs — `videoSrc`/b-roll `src` are not fields here; each consumer
// resolves media itself (browser = v4 signed URLs; worker = loopback) — and a
// belt-and-suspenders `noUrl` refine keeps URL-shaped strings out of text fields.
import { z } from "zod"
import { REEL_MODES, type ReelMode } from "@/types/database"

export type { ReelMode }
export const reelModeSchema = z.enum(REEL_MODES)

// The render worker's BRAND_ACCENT_HEX (sRGB of the --accent oklch token). Used
// as the snapshot default when the operator hasn't picked a colour.
export const REEL_DEFAULT_ACCENT_HEX = "#c4936b"

// Reject any URL/scheme-prefixed string — props must never carry a (signed) media URL.
const noUrl = (s: string) => !/^\s*(https?:|gs:|data:|blob:|file:)/i.test(s)
const safeText = (max: number) =>
  z.string().max(max).refine(noUrl, { message: "URLs are not allowed in reel props" })

const captionWordSchema = z.object({
  text: safeText(120),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  emphasis: z.boolean(),
})
const captionPageSchema = z.object({
  text: safeText(400),
  words: z.array(captionWordSchema).max(64),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
})
// Face trajectory is worker-managed (the browser can't run detection); the editor
// passes it through read-only. Stored here so the preview can show the tracked crop.
const facePointSchema = z.object({
  ms: z.number().nonnegative(),
  cx: z.number(),
  cy: z.number(),
  size: z.number(),
})
const brollEditSchema = z.object({
  segmentIndex: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  enabled: z.boolean(),
})
const hexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "accentHex must be #rrggbb")
// A bare music filename baked into the worker's public/music dir (no path/url).
const musicTrackSchema = z.string().min(1).max(80).regex(/^[\w.-]+$/, "invalid music track name")

export const reelProjectPropsSchema = z.object({
  pages: z.array(captionPageSchema).max(600),
  accentHex: hexSchema,
  // tri-state: null = never computed (worker detects); [] = computed, no face
  // (center-crop, do NOT re-detect); non-empty = use as-is.
  trajectory: z.array(facePointSchema).max(4000).nullable(),
  broll: z.array(brollEditSchema).max(24),
  hook: z.object({ text: safeText(80) }).nullable(),
  music: z.object({ track: musicTrackSchema }).nullable(),
  trimStartMs: z.number().int().nonnegative(),
  trimEndMs: z.number().int().nonnegative().nullable(),
})
export type ReelProjectProps = z.infer<typeof reelProjectPropsSchema>

// The subset of props the operator can edit. `trajectory` is intentionally
// excluded (worker-managed); the worker re-derives any field NOT listed here.
export const REEL_EDITABLE_FIELDS = [
  "pages",
  "accentHex",
  "broll",
  "hook",
  "music",
  "trimStartMs",
  "trimEndMs",
] as const
export type ReelEditableField = (typeof REEL_EDITABLE_FIELDS)[number]

export const reelEditorSaveSchema = z.object({
  videoUploadId: z.string().uuid(),
  mode: reelModeSchema,
  props: reelProjectPropsSchema,
  editedFields: z.array(z.enum(REEL_EDITABLE_FIELDS)),
})
export type ReelEditorSaveRequest = z.infer<typeof reelEditorSaveSchema>

// A blank effective snapshot for a video that has no saved row yet.
export function defaultReelProps(overrides: Partial<ReelProjectProps> = {}): ReelProjectProps {
  return {
    pages: [],
    accentHex: REEL_DEFAULT_ACCENT_HEX,
    trajectory: null,
    broll: [],
    hook: null,
    music: null,
    trimStartMs: 0,
    trimEndMs: null,
    ...overrides,
  }
}
