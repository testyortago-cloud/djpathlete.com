"use client"

import { useState, useEffect, useCallback, Fragment, type ReactNode } from "react"
import { Film, Loader2, ExternalLink, RefreshCw, CheckCircle2, AlertTriangle, Clapperboard } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import { useAiJob } from "@/hooks/use-ai-job"
import { renderPhase, formatElapsed } from "@/lib/content-studio/render-progress"
import { canRenderSplitReel, segmentsRemaining } from "@/lib/split-reel/render-gate"
import { cn } from "@/lib/utils"

// ── Types (mirror the GET /api/admin/content-studio/split-reel response) ──────
interface ReelPost {
  id: string
  platform: string
  approvalStatus: string
}
interface BrollWindow {
  id: string
  index: number
  concept: string
  prompt: string
  status: string
  startMs: number
  endMs: number
  clipUrl: string | null
}
interface DroppedWindow {
  startMs: number
  endMs: number
  concept: string
}
interface ReelState {
  inFlightBrollJobId: string | null
  inFlightRenderJobId: string | null
  windows: BrollWindow[]
  dropped: DroppedWindow[]
  hookText: string
  reel: {
    assetId: string
    signedUrl: string
    width: number | null
    height: number | null
    durationMs: number | null
    createdAt: string
    posts: ReelPost[]
  } | null
}

interface SplitReelPanelProps {
  videoUploadId: string
  hasTranscript: boolean
}

const BASE = "/api/admin/content-studio/split-reel"

// The Content Studio drawer's Split Reel surface (Phase 3). Generation, review,
// per-window regenerate, and the explicit render gate. Rehydrates from the server
// on open and tracks the broll_generation + split_reel_render jobs in Firestore.
export function SplitReelPanel({ videoUploadId, hasTranscript }: SplitReelPanelProps) {
  const [state, setState] = useState<ReelState | null>(null)
  const [hook, setHook] = useState("")
  const [genJobId, setGenJobId] = useState<string | null>(null)
  const [renderJobId, setRenderJobId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [prompts, setPrompts] = useState<Record<string, string>>({})
  const [regenerating, setRegenerating] = useState<Set<string>>(new Set())
  const { status: genStatus } = useAiJob(genJobId)
  const { status: renderStatus, error: renderError } = useAiJob(renderJobId)

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}?videoUploadId=${encodeURIComponent(videoUploadId)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Failed to load (${res.status})`)
      const s = data as ReelState
      setState(s)
      setHook((prev) => (prev.length > 0 ? prev : (s.hookText ?? "")))
      if (s.inFlightBrollJobId) setGenJobId(s.inFlightBrollJobId)
      if (s.inFlightRenderJobId) setRenderJobId(s.inFlightRenderJobId)
    } catch (err) {
      setState({ inFlightBrollJobId: null, inFlightRenderJobId: null, windows: [], dropped: [], hookText: "", reel: null })
      toast.error((err as Error).message || "Failed to load Split Reel state")
    }
  }, [videoUploadId])

  useEffect(() => {
    void fetchState()
  }, [fetchState])

  useEffect(() => {
    if (!genJobId) return
    if (genStatus === "completed") {
      toast.success("B-roll ready — rendering your reel…")
      setGenJobId(null)
      void fetchState()
    } else if (genStatus === "failed") {
      toast.error("B-roll generation failed")
      setGenJobId(null)
      void fetchState()
    }
  }, [genStatus, genJobId, fetchState])

  useEffect(() => {
    if (!renderJobId) return
    if (renderStatus === "completed") {
      toast.success("Split Reel ready")
      setRenderJobId(null)
      void fetchState()
    } else if (renderStatus === "failed") {
      toast.error(renderError || "Split Reel render failed")
      setRenderJobId(null)
      void fetchState()
    }
  }, [renderStatus, renderError, renderJobId, fetchState])

  const generating = submitting || (genJobId !== null && (genStatus === "pending" || genStatus === "processing"))
  const rendering = renderJobId !== null && (renderStatus === "pending" || renderStatus === "processing")
  const windowsInFlight = state ? segmentsRemaining(state.windows) > 0 : false

  // Live elapsed counter while a job runs (no true %, so the timer is the heartbeat).
  useEffect(() => {
    if (!generating && !rendering) return
    const start = Date.now()
    setElapsedMs(0)
    const id = setInterval(() => setElapsedMs(Date.now() - start), 1000)
    return () => clearInterval(id)
  }, [generating, rendering])

  // Segments live in Supabase (no realtime), so poll while a window is still
  // cooking (a regenerate, or clips finishing after generation) to flip it ready.
  useEffect(() => {
    if (!windowsInFlight || generating || rendering) return
    const id = setInterval(() => {
      void fetchState()
    }, 5000)
    return () => clearInterval(id)
  }, [windowsInFlight, generating, rendering, fetchState])

  async function startGenerate() {
    setSubmitting(true)
    try {
      const res = await fetch(BASE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
      if (typeof data?.jobId !== "string" || !data.jobId) throw new Error("Server returned no job id")
      setGenJobId(data.jobId)
      toast.message("Creating reel… picking moments, rendering clips, then the reel.")
    } catch (err) {
      toast.error((err as Error).message || "Failed to start b-roll generation")
    } finally {
      setSubmitting(false)
    }
  }

  async function regenerateWindow(w: BrollWindow) {
    setRegenerating((prev) => new Set(prev).add(w.id))
    try {
      const edited = prompts[w.id]?.trim()
      const res = await fetch(`${BASE}/broll/regenerate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ segmentId: w.id, ...(edited && edited !== w.prompt ? { prompt: edited } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
      toast.message(`Regenerating window ${w.index + 1}…`)
      await fetchState()
    } catch (err) {
      toast.error((err as Error).message || "Failed to regenerate window")
    } finally {
      setRegenerating((prev) => {
        const n = new Set(prev)
        n.delete(w.id)
        return n
      })
    }
  }

  async function startRender() {
    setSubmitting(true)
    try {
      const res = await fetch(`${BASE}/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUploadId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
      if (typeof data?.jobId !== "string" || !data.jobId) throw new Error("Server returned no job id")
      setRenderJobId(data.jobId)
      toast.message("Rendering Split Reel… runs in the background (a few minutes).")
    } catch (err) {
      toast.error((err as Error).message || "Failed to start render")
    } finally {
      setSubmitting(false)
    }
  }

  async function reRender() {
    const desired = hook.trim()
    if (state && desired !== (state.hookText ?? "")) {
      try {
        const res = await fetch(`/api/admin/videos/${encodeURIComponent(videoUploadId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hook_text: desired || null }),
        })
        if (!res.ok) throw new Error(`save failed (${res.status})`)
      } catch {
        toast.error("Failed to save the hook")
        return
      }
    }
    await startRender()
  }

  // ── loading ──
  if (state === null) {
    return (
      <PanelShell>
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </span>
      </PanelShell>
    )
  }

  // ── generating b-roll ──
  if (generating) {
    return (
      <PanelShell>
        <JobProgress
          title={genStatus === "processing" ? "Generating b-roll…" : "Queued…"
          }
          steps={["Selecting moments", "Generating clips", "Ready"]}
          activeIndex={genStatus === "processing" ? 1 : 0}
          elapsedMs={elapsedMs}
          note="Picks moments, then renders each clip on fal. Safe to close — it'll be here when it's done."
        />
      </PanelShell>
    )
  }

  // ── rendering the reel ──
  if (rendering) {
    const phase = renderPhase(renderStatus)
    return (
      <PanelShell>
        <JobProgress
          title={phase === "queued" ? "Queued…" : "Rendering Split Reel…"}
          steps={["Queued", "Rendering", "Ready"]}
          activeIndex={phase === "queued" ? 0 : 1}
          elapsedMs={elapsedMs}
          note="Usually ~2–4 min. Safe to close this drawer or navigate away."
        />
      </PanelShell>
    )
  }

  const { windows, dropped, reel } = state
  const canRender = canRenderSplitReel(windows)
  const remaining = segmentsRemaining(windows)

  // ── review (windows exist) ──
  if (windows.length > 0) {
    return (
      <PanelShell>
        {reel && <CurrentReel reel={reel} compact />}
        <p className="mb-2 text-[11px] text-muted-foreground">
          {windows.length} b-roll window{windows.length === 1 ? "" : "s"} — preview, tweak a prompt and regenerate, then render.
        </p>
        <div className="space-y-2">
          {windows.map((w) => (
            <BrollWindowCard
              key={w.id}
              w={w}
              promptValue={prompts[w.id] ?? w.prompt}
              onPromptChange={(v) => setPrompts((p) => ({ ...p, [w.id]: v }))}
              onRegenerate={() => regenerateWindow(w)}
              regenerating={regenerating.has(w.id)}
            />
          ))}
        </div>
        {dropped.length > 0 && <DroppedBanner dropped={dropped} />}
        <div className="mt-3">
          <HookField value={hook} onChange={setHook} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={reRender}
            disabled={!canRender || submitting}
            title={canRender ? "Render the Split Reel from these windows" : "Some windows are still generating"}
            className="inline-flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Film className="size-3.5" /> Render reel
          </button>
          <button
            type="button"
            onClick={startGenerate}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs hover:bg-surface disabled:opacity-60"
          >
            <RefreshCw className="size-3" /> Regenerate all
          </button>
          {!canRender && (
            <span className="text-[11px] text-muted-foreground">{remaining} window(s) still generating…</span>
          )}
        </div>
      </PanelShell>
    )
  }

  // ── done (a reel exists, no windows) ──
  if (reel) {
    return (
      <PanelShell>
        <CurrentReel reel={reel} />
        <div className="mt-2">
          <HookField value={hook} onChange={setHook} />
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={startGenerate}
            disabled={!hasTranscript || submitting}
            className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs hover:bg-surface disabled:opacity-60"
          >
            <RefreshCw className="size-3" /> Re-create
          </button>
          <button
            type="button"
            onClick={reRender}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs hover:bg-surface disabled:opacity-60"
          >
            <Film className="size-3" /> Re-render
          </button>
        </div>
      </PanelShell>
    )
  }

  // ── idle ──
  return (
    <PanelShell>
      <button
        type="button"
        onClick={startGenerate}
        disabled={!hasTranscript || submitting}
        title={
          hasTranscript
            ? "Create the full reel in one click — hook, captions, b-roll, render"
            : "No speech transcript — needs spoken audio"
        }
        aria-label="Create Reel"
        className="inline-flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        <Clapperboard className="size-3.5" /> Create Reel
      </button>
      {!hasTranscript && <p className="mt-1.5 text-xs text-muted-foreground">Needs a speech transcript first.</p>}
    </PanelShell>
  )
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

function PanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface/40 p-3">
      <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Film className="size-3" /> Split Reel
      </p>
      {children}
    </div>
  )
}

function JobProgress({
  title,
  steps,
  activeIndex,
  elapsedMs,
  note,
}: {
  title: string
  steps: string[]
  activeIndex: number
  elapsedMs: number
  note: string
}) {
  return (
    <div className="space-y-2.5 text-xs">
      <div className="flex items-center gap-2 text-primary">
        <Loader2 className="size-4 shrink-0 animate-spin" />
        <span className="font-medium">{title}</span>
        <span className="ml-auto font-mono tabular-nums text-muted-foreground" aria-label="Elapsed time">
          {formatElapsed(elapsedMs)}
        </span>
      </div>
      <ol className="flex items-center gap-1.5 text-[11px]">
        {steps.map((label, i) => (
          <Fragment key={label}>
            {i > 0 && (
              <span aria-hidden className="text-muted-foreground/50">
                →
              </span>
            )}
            <ProgressStep label={label} state={i < activeIndex ? "done" : i === activeIndex ? "active" : "todo"} />
          </Fragment>
        ))}
      </ol>
      <p className="text-muted-foreground">{note}</p>
    </div>
  )
}

function ProgressStep({ label, state }: { label: string; state: "done" | "active" | "todo" }) {
  return (
    <li
      className={cn(
        "inline-flex list-none items-center gap-1",
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

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    ready: "text-success",
    generating: "text-primary",
    pending: "text-muted-foreground",
    failed: "text-error",
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium uppercase", map[status] ?? "text-muted-foreground")}>
      {status === "generating" || status === "pending" ? <Loader2 className="size-2.5 animate-spin" /> : null}
      {status}
    </span>
  )
}

function BrollWindowCard({
  w,
  promptValue,
  onPromptChange,
  onRegenerate,
  regenerating,
}: {
  w: BrollWindow
  promptValue: string
  onPromptChange: (v: string) => void
  onRegenerate: () => void
  regenerating: boolean
}) {
  const busy = regenerating || w.status === "generating" || w.status === "pending"
  return (
    <div className="rounded border border-border bg-background/60 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium">
          #{w.index + 1} · {w.concept || "b-roll"}{" "}
          <span className="font-mono text-muted-foreground">
            {fmtMs(w.startMs)}–{fmtMs(w.endMs)}
          </span>
        </span>
        <StatusChip status={w.status} />
      </div>
      <div className="mt-1.5 flex gap-2">
        {w.status === "ready" && w.clipUrl ? (
          <video
            src={w.clipUrl}
            controls
            preload="metadata"
            className="aspect-[9/16] w-16 shrink-0 rounded bg-black object-cover"
          />
        ) : (
          <div className="flex aspect-[9/16] w-16 shrink-0 items-center justify-center rounded bg-black/80 text-[10px] text-muted-foreground">
            {w.status === "failed" ? "failed" : busy ? <Loader2 className="size-3 animate-spin" /> : "—"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <textarea
            value={promptValue}
            onChange={(e) => onPromptChange(e.target.value)}
            rows={2}
            maxLength={800}
            className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-[11px]"
          />
          <button
            type="button"
            onClick={onRegenerate}
            disabled={busy}
            className="mt-1 inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium hover:bg-surface disabled:opacity-50"
          >
            {regenerating ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Regenerate
          </button>
        </div>
      </div>
    </div>
  )
}

function DroppedBanner({ dropped }: { dropped: DroppedWindow[] }) {
  return (
    <div className="mt-2 flex gap-2 rounded border border-warning/40 bg-warning/5 p-2 text-[11px]">
      <AlertTriangle className="size-3.5 shrink-0 text-warning" />
      <div>
        <span className="font-medium">{dropped.length} moment{dropped.length === 1 ? "" : "s"} dropped</span>{" "}
        (window cap / spacing): {dropped.map((d) => `${fmtMs(d.startMs)}${d.concept ? ` ${d.concept}` : ""}`).join(", ")}
      </div>
    </div>
  )
}

function HookField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-[11px] text-muted-foreground">Hook title (optional)</span>
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

function CurrentReel({ reel, compact = false }: { reel: NonNullable<ReelState["reel"]>; compact?: boolean }) {
  const seconds = reel.durationMs ? Math.round(reel.durationMs / 1000) : null
  return (
    <div className={cn("flex gap-3", compact ? "mb-2 border-b border-border pb-2" : "flex-col sm:flex-row")}>
      <video
        src={reel.signedUrl}
        controls
        preload="metadata"
        className={cn("aspect-[9/16] shrink-0 rounded bg-black object-cover", compact ? "w-20" : "w-36")}
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          {compact ? "Latest reel · " : ""}
          {reel.width ?? 1080}×{reel.height ?? 1920}
          {seconds !== null ? ` · ${seconds}s` : ""}
        </p>
        {reel.posts.length > 0 ? (
          <ul className="mt-1.5 space-y-1">
            {reel.posts.map((p) => (
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
          <p className="mt-1.5 text-xs text-muted-foreground">No draft posts — connect a video platform to auto-create them.</p>
        )}
      </div>
    </div>
  )
}
