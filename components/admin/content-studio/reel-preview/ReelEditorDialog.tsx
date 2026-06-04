"use client"

// The reel editor: a live @remotion/player preview of the real SplitReel
// composition + controls to edit the operator-facing fields (hook, accent,
// music, b-roll windows, captions). Save persists the snapshot; Save & Render
// re-renders through the existing split-reel pipeline (the worker reads the
// snapshot). The Player is dynamically imported (ssr:false) so Remotion only
// loads when the dialog opens.
import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { toast } from "sonner"
import { Loader2, Save, Film, AlertTriangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { isEmphasisWord, type CaptionPage } from "@/lib/content-studio/caption-paging"
import {
  REEL_EDITABLE_FIELDS,
  type ReelEditableField,
  type ReelProjectProps,
} from "@/lib/validators/reel-projects"
import type { SplitReelProps } from "./remotion/SplitReel"

const ReelPlayer = dynamic(() => import("./ReelPlayer").then((m) => m.ReelPlayer), { ssr: false })

// Bare filenames baked into the worker's public/music dir (copied into the app's
// public/music for preview parity). Keep in sync with render-worker/public/music.
const MUSIC_TRACKS = ["cinematic.mp3", "inspirational.mp3", "motivational-cinematic.mp3"] as const

const BASE = "/api/admin/content-studio/reel-editor"

interface ReelEditorDialogProps {
  videoUploadId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the split_reel_render job id after Save & Render enqueues it. */
  onRenderStarted: (jobId: string) => void
}

interface LoadedMedia {
  videoSrc: string | null
  broll: Record<string, string>
}

// Re-tokenise an edited caption page. A pure typo fix (same word count) keeps the
// original per-word timing; adding/removing words redistributes evenly across the
// page's span. Emphasis is recomputed with the same rule the worker uses.
function retokenizePage(page: CaptionPage, newText: string): CaptionPage {
  const tokens = newText.split(/\s+/).map((t) => t.trim()).filter(Boolean)
  if (tokens.length === 0) return { ...page, text: "", words: [] }
  if (tokens.length === page.words.length) {
    const words = page.words.map((w, i) => ({ ...w, text: tokens[i], emphasis: isEmphasisWord(tokens[i]) }))
    return { ...page, text: tokens.join(" "), words }
  }
  const span = Math.max(1, page.endMs - page.startMs)
  const per = span / tokens.length
  const words = tokens.map((t, i) => ({
    text: t,
    startMs: Math.round(page.startMs + i * per),
    endMs: Math.round(page.startMs + (i + 1) * per),
    emphasis: isEmphasisWord(t),
  }))
  return { text: tokens.join(" "), words, startMs: page.startMs, endMs: words[words.length - 1].endMs }
}

export function ReelEditorDialog({ videoUploadId, open, onOpenChange, onRenderStarted }: ReelEditorDialogProps) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [props, setProps] = useState<ReelProjectProps | null>(null)
  const [media, setMedia] = useState<LoadedMedia>({ videoSrc: null, broll: {} })
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [exists, setExists] = useState(false)
  const [edited, setEdited] = useState<Set<ReelEditableField>>(new Set())
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    void (async () => {
      try {
        const res = await fetch(`${BASE}?videoUploadId=${encodeURIComponent(videoUploadId)}&mode=split_reel`)
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d?.error || `Failed to load (${res.status})`)
        if (cancelled) return
        setProps(d.props as ReelProjectProps)
        setMedia(d.media as LoadedMedia)
        setDurationMs(d.durationMs ?? null)
        setExists(Boolean(d.exists))
        setEdited(
          new Set(
            ((d.editedFields ?? []) as string[]).filter((f): f is ReelEditableField =>
              (REEL_EDITABLE_FIELDS as readonly string[]).includes(f),
            ),
          ),
        )
        setDirty(false)
      } catch (e) {
        if (!cancelled) setErr((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, videoUploadId])

  const update = useCallback((field: ReelEditableField, updater: (p: ReelProjectProps) => ReelProjectProps) => {
    setProps((prev) => (prev ? updater(prev) : prev))
    setEdited((prev) => new Set(prev).add(field))
    setDirty(true)
  }, [])

  const previewProps: SplitReelProps | null = useMemo(() => {
    if (!props) return null
    return {
      videoSrc: media.videoSrc ?? "",
      pages: props.pages,
      accentHex: props.accentHex,
      trajectory: props.trajectory ?? [],
      broll: props.broll
        .filter((b) => b.enabled)
        .map((b) => ({ startMs: b.startMs, endMs: b.endMs, src: media.broll[String(b.segmentIndex)] }))
        .filter((b) => Boolean(b.src)),
      hook: props.hook ?? undefined,
      music: props.music ?? undefined,
    }
  }, [props, media])

  const durationInFrames = Math.max(1, Math.ceil(((durationMs ?? 10000) / 1000) * 30))

  const save = useCallback(async (): Promise<boolean> => {
    if (!props) return false
    setSaving(true)
    try {
      const res = await fetch(BASE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId, mode: "split_reel", props, editedFields: Array.from(edited) }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error || `Save failed (${res.status})`)
      setDirty(false)
      return true
    } catch (e) {
      toast.error((e as Error).message || "Save failed")
      return false
    } finally {
      setSaving(false)
    }
  }, [props, edited, videoUploadId])

  async function saveAndRender() {
    const ok = await save()
    if (!ok) return
    try {
      const res = await fetch("/api/admin/content-studio/split-reel/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error || `Render failed (${res.status})`)
      if (typeof d?.jobId !== "string" || !d.jobId) throw new Error("Server returned no job id")
      toast.success("Saved — rendering your reel…")
      onRenderStarted(d.jobId)
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message || "Failed to start render")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(96vw,1100px)] max-h-[92vh] overflow-hidden p-0">
        <div className="flex max-h-[92vh] flex-col">
          <DialogHeader className="border-b border-border px-5 py-3">
            <DialogTitle className="font-heading text-base">Edit reel</DialogTitle>
            <DialogDescription className="text-xs">
              Live preview — the final render is frame-exact and may differ slightly in video frame timing.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center gap-2 px-5 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading editor…
            </div>
          ) : err ? (
            <div className="px-5 py-16 text-center text-sm text-error">{err}</div>
          ) : props ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 md:grid-cols-[minmax(0,360px)_1fr]">
              {/* Preview */}
              <div className="order-1 flex items-center justify-center bg-black p-4 md:order-2">
                <div className="aspect-[9/16] h-full max-h-[64vh] w-auto overflow-hidden rounded-md bg-black">
                  {previewProps && (
                    <ReelPlayer mode="split_reel" inputProps={previewProps} durationInFrames={durationInFrames} />
                  )}
                </div>
              </div>

              {/* Controls */}
              <div className="order-2 min-h-0 space-y-4 overflow-y-auto px-5 py-4 md:order-1">
                {!exists && (
                  <div className="flex gap-2 rounded border border-warning/40 bg-warning/5 p-2 text-[11px]">
                    <AlertTriangle className="size-3.5 shrink-0 text-warning" />
                    <span>
                      Captions &amp; face-tracking load into the editor after the first render. You can still adjust the
                      hook, accent, music and b-roll, then Save &amp; Render.
                    </span>
                  </div>
                )}

                {/* Hook */}
                <Field label="Hook title">
                  <input
                    type="text"
                    value={props.hook?.text ?? ""}
                    maxLength={80}
                    placeholder="e.g. 5 Mistakes Athletes Make"
                    onChange={(e) =>
                      update("hook", (p) => ({ ...p, hook: e.target.value.trim() ? { text: e.target.value.slice(0, 80) } : null }))
                    }
                    className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
                  />
                </Field>

                {/* Accent */}
                <Field label="Accent colour">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={props.accentHex}
                      onChange={(e) => update("accentHex", (p) => ({ ...p, accentHex: e.target.value }))}
                      className="h-7 w-10 cursor-pointer rounded border border-border bg-background"
                    />
                    <span className="font-mono text-[11px] text-muted-foreground">{props.accentHex}</span>
                  </div>
                </Field>

                {/* Music */}
                <Field label="Music bed">
                  <select
                    value={props.music?.track ?? "none"}
                    onChange={(e) =>
                      update("music", (p) => ({ ...p, music: e.target.value === "none" ? null : { track: e.target.value } }))
                    }
                    className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
                  >
                    <option value="none">None</option>
                    {MUSIC_TRACKS.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/\.mp3$/, "")}
                      </option>
                    ))}
                  </select>
                </Field>

                {/* B-roll windows */}
                {props.broll.length > 0 && (
                  <Field label={`B-roll windows (${props.broll.length})`}>
                    <div className="space-y-2">
                      {props.broll.map((b, idx) => (
                        <div key={b.segmentIndex} className="rounded border border-border bg-background/60 p-2">
                          <label className="flex items-center gap-2 text-[11px]">
                            <input
                              type="checkbox"
                              checked={b.enabled}
                              onChange={(e) =>
                                update("broll", (p) => ({
                                  ...p,
                                  broll: p.broll.map((x, i) => (i === idx ? { ...x, enabled: e.target.checked } : x)),
                                }))
                              }
                            />
                            <span className="font-medium">Window #{b.segmentIndex + 1}</span>
                          </label>
                          <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                            <SecondsInput
                              label="start"
                              ms={b.startMs}
                              onChange={(ms) =>
                                update("broll", (p) => ({
                                  ...p,
                                  broll: p.broll.map((x, i) => (i === idx ? { ...x, startMs: Math.min(ms, x.endMs - 100) } : x)),
                                }))
                              }
                            />
                            <SecondsInput
                              label="end"
                              ms={b.endMs}
                              onChange={(ms) =>
                                update("broll", (p) => ({
                                  ...p,
                                  broll: p.broll.map((x, i) => (i === idx ? { ...x, endMs: Math.max(ms, x.startMs + 100) } : x)),
                                }))
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </Field>
                )}

                {/* Captions */}
                {props.pages.length > 0 && (
                  <Field label={`Captions (${props.pages.length} lines)`}>
                    <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                      {props.pages.map((pg, idx) => (
                        <input
                          key={idx}
                          type="text"
                          value={pg.text}
                          onChange={(e) =>
                            update("pages", (p) => ({
                              ...p,
                              pages: p.pages.map((x, i) => (i === idx ? retokenizePage(x, e.target.value) : x)),
                            }))
                          }
                          className="w-full rounded border border-border bg-background px-2 py-1 text-[11px]"
                        />
                      ))}
                    </div>
                  </Field>
                )}
              </div>
            </div>
          ) : null}

          <DialogFooter className="items-center border-t border-border px-5 py-3">
            <span className={cn("mr-auto text-[11px]", dirty ? "text-accent" : "text-muted-foreground")}>
              {dirty ? "Unsaved changes" : "All changes saved"}
            </span>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !props || !dirty}
              className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs hover:bg-surface disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
            </button>
            <button
              type="button"
              onClick={() => void saveAndRender()}
              disabled={saving || !props}
              className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              <Film className="size-3.5" /> Save &amp; Render
            </button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function SecondsInput({ label, ms, onChange }: { label: string; ms: number; onChange: (ms: number) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        step={0.1}
        min={0}
        value={(ms / 1000).toFixed(1)}
        onChange={(e) => {
          const s = parseFloat(e.target.value)
          if (Number.isFinite(s)) onChange(Math.max(0, Math.round(s * 1000)))
        }}
        className="w-16 rounded border border-border bg-background px-1.5 py-0.5 text-[11px]"
      />
      <span className="text-muted-foreground">s</span>
    </span>
  )
}
