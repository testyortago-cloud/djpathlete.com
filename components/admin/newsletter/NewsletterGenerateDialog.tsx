"use client"

import { useState, useEffect, useRef } from "react"
import { Sparkles, Loader2, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useAiJob } from "@/hooks/use-ai-job"
import { cn } from "@/lib/utils"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { summarizeApiError } from "@/lib/errors/humanize"

interface GeneratedNewsletterData {
  subject: string
  preview_text: string
  content: string
}

interface NewsletterGenerateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerated: (data: GeneratedNewsletterData) => void
  hasExistingContent?: boolean
}

const tones = [
  { value: "professional", label: "Professional" },
  { value: "conversational", label: "Conversational" },
  { value: "motivational", label: "Motivational" },
] as const

const lengths = [
  { value: "short", label: "Short", desc: "Quick update" },
  { value: "medium", label: "Medium", desc: "Standard" },
  { value: "long", label: "Long", desc: "In-depth" },
] as const

export function NewsletterGenerateDialog({
  open,
  onOpenChange,
  onGenerated,
  hasExistingContent,
}: NewsletterGenerateDialogProps) {
  const [prompt, setPrompt] = useState("")
  const [tone, setTone] = useState<"professional" | "conversational" | "motivational">("professional")
  const [length, setLength] = useState<"short" | "medium" | "long">("medium")
  const [mode, setMode] = useState<"prompt" | "blog">("prompt")
  const [blogs, setBlogs] = useState<Array<{ id: string; title: string; published_at: string }>>([])
  const [selectedBlogId, setSelectedBlogId] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [startError, setStartError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const router = useRouter()

  const aiJob = useAiJob(jobId)

  // Elapsed timer while generating
  useEffect(() => {
    if (aiJob.status === "processing" || (aiJob.status === "pending" && jobId)) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((p) => p + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [aiJob.status, jobId])

  // Handle completion
  useEffect(() => {
    if (aiJob.status === "completed" && aiJob.result) {
      const data = aiJob.result as unknown as GeneratedNewsletterData
      onGenerated(data)
      toast.success("Newsletter generated! Review and edit before sending.")
      resetState()
    }
  }, [aiJob.status, aiJob.result, onGenerated])

  // Handle error
  useEffect(() => {
    if (aiJob.status === "failed") {
      setSubmitting(false)
      setJobId(null)
    }
  }, [aiJob.status])

  // Fetch published blog posts when switching to blog mode
  useEffect(() => {
    if (mode !== "blog" || !open) return
    let cancelled = false
    fetch("/api/admin/blog?status=published")
      .then((r) => r.json())
      .then((data: Array<{ id: string; title: string; published_at: string }>) => {
        // Route returns a bare array (not { posts })
        if (!cancelled) setBlogs(Array.isArray(data) ? data : [])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [mode, open])

  function resetState() {
    setMode("prompt")
    setBlogs([])
    setSelectedBlogId(null)
    setPrompt("")
    setTone("professional")
    setLength("medium")
    setJobId(null)
    setSubmitting(false)
    setConfirmed(false)
    setElapsed(0)
    setStartError(null)
    aiJob.reset()
  }

  async function handleGenerate() {
    if (hasExistingContent && !confirmed) {
      setConfirmed(true)
      return
    }

    setSubmitting(true)
    setStartError(null)
    try {
      const res = await fetch("/api/admin/newsletter/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, tone, length }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const { message } = summarizeApiError(res, data, "Failed to start generation")
        setStartError(message)
        toast.error(message)
        setSubmitting(false)
        return
      }

      const { jobId: id } = await res.json()
      setJobId(id)
    } catch (err) {
      const message = err instanceof Error ? err.message : "We couldn't reach the server. Please try again."
      setStartError(message)
      toast.error(message)
      setSubmitting(false)
    }
  }

  const [isCancelling, setIsCancelling] = useState(false)

  async function handleCancelJob() {
    if (!jobId || isCancelling) return
    setIsCancelling(true)
    try {
      await fetch("/api/admin/programs/generate/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      })
    } catch {
      // Best-effort cancel
    }
    resetState()
    setIsCancelling(false)
    onOpenChange(false)
  }

  function handleClose(open: boolean) {
    if (jobId && aiJob.status !== "completed" && aiJob.status !== "failed") {
      return
    }
    if (!open) resetState()
    onOpenChange(open)
  }

  const isGenerating = !!jobId && aiJob.status !== "completed" && aiJob.status !== "failed"

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!isGenerating}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            Generate Newsletter with AI
          </DialogTitle>
          <DialogDescription>
            Describe what your newsletter should cover and AI will generate the subject, preview text, and content.
          </DialogDescription>
        </DialogHeader>

        {/* Error state */}
        {aiJob.status === "failed" && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-200">
            <AlertCircle className="size-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800">Generation failed</p>
              <p className="text-xs text-red-600 mt-1">{aiJob.error ?? "Something went wrong. Please try again."}</p>
            </div>
          </div>
        )}

        <FormErrorBanner message={startError} />

        {/* Generating state */}
        {isGenerating ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">Generating your newsletter...</p>
            <p className="text-xs text-muted-foreground">{elapsed}s elapsed — this usually takes 15-30 seconds</p>
            <button
              type="button"
              onClick={handleCancelJob}
              disabled={isCancelling}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-surface transition-colors disabled:opacity-50"
            >
              {isCancelling ? <Loader2 className="size-3 animate-spin" /> : null}
              {isCancelling ? "Cancelling..." : "Cancel Generation"}
            </button>
          </div>
        ) : (
          <>
            {/* Tab strip */}
            <div className="flex border-b border-border mb-4">
              <button
                type="button"
                role="tab"
                onClick={() => setMode("prompt")}
                className={cn(
                  "px-4 py-2 text-sm font-medium border-b-2",
                  mode === "prompt" ? "border-primary text-primary" : "border-transparent text-muted-foreground",
                )}
              >
                From prompt
              </button>
              <button
                type="button"
                role="tab"
                onClick={() => setMode("blog")}
                className={cn(
                  "px-4 py-2 text-sm font-medium border-b-2",
                  mode === "blog" ? "border-primary text-primary" : "border-transparent text-muted-foreground",
                )}
              >
                From blog post
              </button>
            </div>

            {mode === "prompt" && (
              <>
                {/* Confirmation warning */}
                {hasExistingContent && confirmed && (
                  <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
                    <p className="text-sm text-warning font-medium">
                      This will replace your current draft. Click Generate again to confirm.
                    </p>
                  </div>
                )}

                {/* Prompt */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    What should the newsletter be about?
                  </label>
                  <textarea
                    value={prompt}
                    onChange={(e) => {
                      setPrompt(e.target.value)
                      setConfirmed(false)
                    }}
                    placeholder="e.g., Monthly training tips for off-season athletes, highlight our new program offerings"
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{prompt.length}/2000</p>
                </div>
              </>
            )}

            {/* Tone — shared between both modes */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Tone</label>
              <div className="flex gap-1 bg-surface rounded-lg p-1">
                {tones.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTone(t.value)}
                    className={cn(
                      "flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                      tone === t.value
                        ? "bg-white text-primary shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Length — shared between both modes */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Length</label>
              <div className="flex gap-1 bg-surface rounded-lg p-1">
                {lengths.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => setLength(l.value)}
                    className={cn(
                      "flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                      length === l.value
                        ? "bg-white text-primary shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {l.label}
                    <span className="block text-[10px] text-muted-foreground font-normal">{l.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Blog mode — blog picker + submit */}
            {mode === "blog" && (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Pick a published blog post</label>
                  <ul className="mt-2 border border-border rounded-md divide-y divide-border max-h-60 overflow-y-auto">
                    {blogs.length === 0 && (
                      <li className="px-3 py-2 text-sm text-muted-foreground">No published posts yet.</li>
                    )}
                    {blogs.map((b) => (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedBlogId(b.id)}
                          className={cn(
                            "w-full text-left px-3 py-2 text-sm hover:bg-surface/50",
                            selectedBlogId === b.id && "bg-primary/5",
                          )}
                        >
                          <div className="font-medium text-primary">{b.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(b.published_at).toLocaleDateString()}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  disabled={!selectedBlogId}
                  onClick={async () => {
                    if (!selectedBlogId) return
                    setStartError(null)
                    try {
                      const res = await fetch("/api/admin/newsletter/generate-from-blog", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ blog_post_id: selectedBlogId, tone, length }),
                      })
                      if (!res.ok) {
                        const data = await res.json().catch(() => ({}))
                        const { message } = summarizeApiError(res, data, "Failed to generate from blog")
                        setStartError(message)
                        toast.error(message)
                        return
                      }
                      onOpenChange(false)
                      router.push("/admin/newsletter")
                    } catch {
                      const message = "We couldn't reach the server. Please try again."
                      setStartError(message)
                      toast.error(message)
                    }
                  }}
                  className={cn(
                    "w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-primary text-white font-medium",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  )}
                >
                  Generate from blog
                </button>
              </div>
            )}

            {/* Generate button — prompt mode only */}
            {mode === "prompt" && (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={prompt.length < 10 || submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {hasExistingContent && confirmed ? "Confirm & Generate" : "Generate Newsletter"}
              </button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
