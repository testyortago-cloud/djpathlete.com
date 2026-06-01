"use client"

import { useState, useEffect, useCallback, type ReactNode } from "react"
import { Clapperboard, Loader2, ExternalLink, RefreshCw, CheckCircle2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import { useAiJob } from "@/hooks/use-ai-job"
import { renderPhase, formatElapsed } from "@/lib/content-studio/render-progress"
import { cn } from "@/lib/utils"

interface CutPost {
  id: string
  platform: string
  approvalStatus: string
}

interface CutState {
  inFlightJobId: string | null
  cut: {
    assetId: string
    signedUrl: string
    width: number | null
    height: number | null
    durationMs: number | null
    createdAt: string
    posts: CutPost[]
  } | null
}

interface CaptionedCutPanelProps {
  videoUploadId: string
  hasTranscript: boolean
}

// The Content Studio drawer's captioned-cut surface. Unlike a bare button, this
// rehydrates its state from the server on open, so an in-flight render (which
// takes a few minutes) keeps showing progress after a refresh or navigating away,
// and a finished cut is playable inline with links to its draft posts.
export function CaptionedCutPanel({ videoUploadId, hasTranscript }: CaptionedCutPanelProps) {
  const [state, setState] = useState<CutState | null>(null) // null = initial load
  const [jobId, setJobId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [hook, setHook] = useState("")
  const [music, setMusic] = useState("")
  const [elapsedMs, setElapsedMs] = useState(0)
  const { status, error } = useAiJob(jobId)

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/content-studio/captioned-cut?videoUploadId=${encodeURIComponent(videoUploadId)}`,
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Failed to load (${res.status})`)
      setState(data as CutState)
      if (data.inFlightJobId) setJobId(data.inFlightJobId as string) // resume tracking a live render
    } catch (err) {
      setState({ inFlightJobId: null, cut: null })
      toast.error((err as Error).message || "Failed to load captioned cut state")
    }
  }, [videoUploadId])

  useEffect(() => {
    void fetchState()
  }, [fetchState])

  // When the tracked render finishes, refetch to pick up the new cut (or surface
  // the failure) and drop the progress state.
  useEffect(() => {
    if (!jobId) return
    if (status === "completed") {
      toast.success("Captioned cut ready")
      setJobId(null)
      void fetchState()
    } else if (status === "failed") {
      toast.error(error || "Captioned cut failed")
      setJobId(null)
      void fetchState()
    }
  }, [status, error, jobId, fetchState])

  const rendering = submitting || (jobId !== null && (status === "pending" || status === "processing"))

  // Tick an elapsed-time counter while a render is in flight. The job only
  // reports queued/rendering (no true %), so the live timer is the "it's alive"
  // cue during the multi-minute wait. Resets each time a render starts; for a
  // render resumed after reopening the drawer it counts from reopen, not queue.
  useEffect(() => {
    if (!rendering) return
    const start = Date.now()
    setElapsedMs(0)
    const id = setInterval(() => setElapsedMs(Date.now() - start), 1000)
    return () => clearInterval(id)
  }, [rendering])

  async function generate() {
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/content-studio/captioned-cut", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId, hook: hook.trim() || undefined, music: music || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
      if (typeof data?.jobId !== "string" || !data.jobId) throw new Error("Server returned no job id")
      setJobId(data.jobId)
      toast.message("Rendering captioned cut… runs in the background (a few minutes).")
    } catch (err) {
      toast.error((err as Error).message || "Failed to start render")
    } finally {
      setSubmitting(false)
    }
  }

  // ── initial load ──────────────────────────────────────────────────────────
  if (state === null) {
    return (
      <PanelShell>
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </span>
      </PanelShell>
    )
  }

  // ── rendering ─────────────────────────────────────────────────────────────
  if (rendering) {
    const phase = renderPhase(status)
    return (
      <PanelShell>
        <div className="space-y-2.5 text-xs">
          <div className="flex items-center gap-2 text-primary">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            <span className="font-medium">
              {phase === "queued" ? "Queued…" : "Rendering captioned cut…"}
            </span>
            <span className="ml-auto font-mono tabular-nums text-muted-foreground" aria-label="Elapsed time">
              {formatElapsed(elapsedMs)}
            </span>
          </div>

          <ol className="flex items-center gap-1.5 text-[11px]">
            <ProgressStep label="Queued" state={phase === "queued" ? "active" : "done"} />
            <span aria-hidden className="text-muted-foreground/50">
              →
            </span>
            <ProgressStep label="Rendering" state={phase === "rendering" ? "active" : "todo"} />
            <span aria-hidden className="text-muted-foreground/50">
              →
            </span>
            <ProgressStep label="Ready" state="todo" />
          </ol>

          <p className="text-muted-foreground">
            Usually ~2–4 min. Safe to close this drawer or navigate away — it’ll be waiting here when it’s done.
          </p>
        </div>
      </PanelShell>
    )
  }

  // ── done: a rendered cut exists ───────────────────────────────────────────
  const cut = state.cut
  if (cut) {
    const seconds = cut.durationMs ? Math.round(cut.durationMs / 1000) : null
    return (
      <PanelShell>
        <div className="flex flex-col gap-3 sm:flex-row">
          <video
            src={cut.signedUrl}
            controls
            preload="metadata"
            className="aspect-[9/16] w-36 shrink-0 rounded bg-black object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">
              {cut.width ?? 1080}×{cut.height ?? 1920}
              {seconds !== null ? ` · ${seconds}s` : ""}
            </p>
            {cut.posts.length > 0 ? (
              <ul className="mt-1.5 space-y-1">
                {cut.posts.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/admin/content/post/${p.id}`}
                      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      <ExternalLink className="size-3" /> {p.platform} draft
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground">
                No draft posts — connect a video platform to auto-create them.
              </p>
            )}
            <HookInput value={hook} onChange={setHook} videoUploadId={videoUploadId} hasTranscript={hasTranscript} />
            <MusicPicker value={music} onChange={setMusic} />
            <button
              type="button"
              onClick={generate}
              disabled={!hasTranscript}
              className="mt-2 inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs hover:bg-surface disabled:opacity-60"
            >
              <RefreshCw className="size-3" /> Re-render
            </button>
          </div>
        </div>
      </PanelShell>
    )
  }

  // ── idle: no cut yet ──────────────────────────────────────────────────────
  return (
    <PanelShell>
      <HookInput value={hook} onChange={setHook} videoUploadId={videoUploadId} hasTranscript={hasTranscript} />
      <MusicPicker value={music} onChange={setMusic} />
      <button
        type="button"
        onClick={generate}
        disabled={!hasTranscript}
        title={
          !hasTranscript
            ? "No speech transcript — captions need spoken audio"
            : "Render a vertical 9:16 clip with word-pop captions burned in"
        }
        aria-label="Generate captioned cut"
        className="inline-flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        <Clapperboard className="size-3.5" /> Generate Captioned Cut
      </button>
      {!hasTranscript && <p className="mt-1.5 text-xs text-muted-foreground">Needs a speech transcript first.</p>}
    </PanelShell>
  )
}

function ProgressStep({ label, state }: { label: string; state: "done" | "active" | "todo" }) {
  return (
    <li
      className={cn(
        "inline-flex items-center gap-1",
        state === "active" && "font-medium text-primary",
        state === "done" && "text-muted-foreground",
        state === "todo" && "text-muted-foreground/40",
      )}
    >
      {state === "done" ? (
        <CheckCircle2 className="size-3" />
      ) : state === "active" ? (
        <span className="size-2 rounded-full bg-primary" />
      ) : (
        <span className="size-2 rounded-full border border-current" />
      )}
      {label}
    </li>
  )
}

function PanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface/40 p-3">
      <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Clapperboard className="size-3" /> Captioned Cut
      </p>
      {children}
    </div>
  )
}

function HookInput({
  value,
  onChange,
  videoUploadId,
  hasTranscript,
}: {
  value: string
  onChange: (v: string) => void
  videoUploadId: string
  hasTranscript: boolean
}) {
  const [suggesting, setSuggesting] = useState(false)

  async function suggest() {
    setSuggesting(true)
    try {
      const res = await fetch("/api/admin/content-studio/captioned-cut/suggest-hook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
      if (typeof data?.hook === "string" && data.hook.trim()) {
        onChange(data.hook.trim())
        toast.success("Hook suggested — tweak it if you like")
      } else {
        toast.message("Couldn't draw a hook from this transcript — type one in.")
      }
    } catch (err) {
      toast.error((err as Error).message || "Failed to suggest a hook")
    } finally {
      setSuggesting(false)
    }
  }

  return (
    <label className="mb-2 block">
      <span className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Hook title (optional)</span>
        <button
          type="button"
          onClick={suggest}
          disabled={suggesting || !hasTranscript}
          aria-label="Suggest hook from transcript"
          title={hasTranscript ? "Suggest a hook from the transcript" : "Needs a speech transcript first"}
          className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-surface disabled:opacity-50"
        >
          {suggesting ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          Suggest
        </button>
      </span>
      <input
        type="text"
        value={value}
        maxLength={80}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 5 Mistakes Athletes Make"
        className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
      />
    </label>
  )
}

const MUSIC_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "No music" },
  { value: "motivational-cinematic.mp3", label: "Motivational Cinematic" },
  { value: "inspirational.mp3", label: "Inspirational" },
  { value: "cinematic.mp3", label: "Cinematic" },
]

function MusicPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-[11px] text-muted-foreground">Music</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
      >
        {MUSIC_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
