"use client"

import { useState, useEffect, useRef } from "react"
import { Sparkles, Loader2, AlertCircle, ChevronDown, X, Plus, Link, FileText, Upload } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useAiJob } from "@/hooks/use-ai-job"
import { cn } from "@/lib/utils"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { summarizeApiError } from "@/lib/errors/humanize"

interface GeneratedBlogData {
  title: string
  slug: string
  excerpt: string
  content: string
  category: string
  tags: string[]
  meta_description: string
}

interface BlogGenerateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerated: (data: GeneratedBlogData) => void
  hasExistingContent?: boolean
  /** Pre-fills the prompt field when the dialog opens (e.g. from topic suggestions). */
  initialPrompt?: string
}

const registers = [
  { value: "formal", label: "Formal", desc: "Tightened, citation-heavy" },
  { value: "casual", label: "Casual", desc: "Conversational, default" },
] as const

const lengths = [
  { value: "short", label: "Short", desc: "~500 words" },
  { value: "medium", label: "Medium", desc: "~1000 words" },
  { value: "long", label: "Long", desc: "~1500 words" },
] as const

export function BlogGenerateDialog({ open, onOpenChange, onGenerated, hasExistingContent, initialPrompt }: BlogGenerateDialogProps) {
  const router = useRouter()
  const [mode, setMode] = useState<"prompt" | "video">("prompt")
  const [videos, setVideos] = useState<Array<{ id: string; title: string; created_at: string }>>([])
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState(initialPrompt ?? "")

  // Reseed prompt when initialPrompt becomes available (e.g. on dialog open from a topic-suggestion deep link)
  useEffect(() => {
    if (initialPrompt) setPrompt(initialPrompt)
  }, [initialPrompt])
  const [register, setRegister] = useState<"formal" | "casual">("casual")
  const [length, setLength] = useState<"short" | "medium" | "long">("medium")
  const [jobId, setJobId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [refsOpen, setRefsOpen] = useState(false)
  const [urls, setUrls] = useState<string[]>([])
  const [urlInput, setUrlInput] = useState("")
  const [notes, setNotes] = useState("")
  const [refFiles, setRefFiles] = useState<{ name: string; content: string }[]>([])
  const [startError, setStartError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      const data = aiJob.result as unknown as GeneratedBlogData
      onGenerated(data)
      toast.success("Blog post generated! Review and edit before publishing.")
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

  // Fetch transcribed videos when switching to video mode
  useEffect(() => {
    if (mode !== "video" || !open) return
    let cancelled = false
    fetch("/api/admin/videos?status=transcribed")
      .then((r) => r.json())
      .then((body: { videos: Array<{ id: string; title: string; created_at: string }> }) => {
        if (!cancelled) setVideos(body.videos)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [mode, open])

  function resetState() {
    setMode("prompt")
    setVideos([])
    setSelectedVideoId(null)
    setPrompt("")
    setRegister("casual")
    setLength("medium")
    setJobId(null)
    setSubmitting(false)
    setConfirmed(false)
    setElapsed(0)
    setRefsOpen(false)
    setUrls([])
    setUrlInput("")
    setNotes("")
    setRefFiles([])
    setStartError(null)
    aiJob.reset()
  }

  function handleAddUrl() {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    try {
      new URL(trimmed)
    } catch {
      toast.error("Please enter a valid URL")
      return
    }
    if (urls.length >= 5) {
      toast.error("Maximum 5 links allowed")
      return
    }
    if (urls.includes(trimmed)) {
      toast.error("This URL is already added")
      return
    }
    setUrls((prev) => [...prev, trimmed])
    setUrlInput("")
  }

  const [extracting, setExtracting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragCounter = useRef(0)

  async function processFiles(files: File[]) {
    for (const file of files) {
      if (refFiles.length >= 5) {
        toast.error("Maximum 5 files allowed")
        break
      }

      const allowed = /\.(pdf|doc|docx|txt|md|csv)$/i.test(file.name)
      if (!allowed) {
        toast.error(`${file.name} — unsupported file type`)
        continue
      }

      const isDocument = /\.(pdf|doc|docx)$/i.test(file.name)

      if (isDocument) {
        if (file.size > 15 * 1024 * 1024) {
          toast.error(`${file.name} exceeds 15MB limit`)
          continue
        }
        setExtracting(true)
        try {
          const formData = new FormData()
          formData.append("file", file)
          const res = await fetch("/api/upload/extract-text", {
            method: "POST",
            body: formData,
          })
          if (!res.ok) {
            const data = await res.json()
            throw new Error(data.error ?? "Extraction failed")
          }
          const { name, content, truncated } = await res.json()
          setRefFiles((prev) => [...prev, { name, content }])
          if (truncated) {
            toast.info(`${file.name} was truncated to 50,000 characters`)
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed to extract text")
        } finally {
          setExtracting(false)
        }
      } else {
        if (file.size > 5 * 1024 * 1024) {
          toast.error(`${file.name} exceeds 5MB limit`)
          continue
        }
        const content = await file.text()
        setRefFiles((prev) => [...prev, { name: file.name, content }])
      }
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files
    if (!fileList) return
    await processFiles(Array.from(fileList))
    e.target.value = ""
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.types.includes("Files")) {
      setDragging(true)
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setDragging(false)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setDragging(false)
    if (refFiles.length >= 5 || extracting) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      await processFiles(files)
    }
  }

  const hasReferences = urls.length > 0 || notes.trim().length > 0 || refFiles.length > 0

  async function handleGenerate() {
    if (hasExistingContent && !confirmed) {
      setConfirmed(true)
      return
    }

    setSubmitting(true)
    setStartError(null)
    try {
      const res = await fetch("/api/admin/blog/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          register,
          length,
          ...(hasReferences
            ? {
                references: {
                  urls: urls.length > 0 ? urls : undefined,
                  notes: notes.trim() || undefined,
                  file_contents: refFiles.length > 0 ? refFiles : undefined,
                },
              }
            : {}),
        }),
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
      return // Don't close while generating (use cancel button instead)
    }
    if (!open) resetState()
    onOpenChange(open)
  }

  const isGenerating = !!jobId && aiJob.status !== "completed" && aiJob.status !== "failed"

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" showCloseButton={!isGenerating}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            Generate with AI
          </DialogTitle>
          <DialogDescription>Describe the blog post you want and AI will generate a complete draft.</DialogDescription>
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
            <p className="text-sm font-medium text-foreground">Generating your blog post...</p>
            <p className="text-xs text-muted-foreground">{elapsed}s elapsed — this usually takes 20-40 seconds</p>
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
                onClick={() => setMode("video")}
                className={cn(
                  "px-4 py-2 text-sm font-medium border-b-2",
                  mode === "video" ? "border-primary text-primary" : "border-transparent text-muted-foreground",
                )}
              >
                From video
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
              <label className="block text-sm font-semibold text-foreground mb-1.5">
                What should the post be about?
              </label>
              <textarea
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value)
                  setConfirmed(false)
                }}
                placeholder="e.g., Recovery strategies for youth athletes after competition season"
                rows={3}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-muted-foreground/60"
              />
              <p className="text-xs text-muted-foreground mt-1">{prompt.length}/2000</p>
            </div>

            {/* References (collapsible) */}
            <div>
              <button
                type="button"
                onClick={() => setRefsOpen(!refsOpen)}
                className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors w-full"
              >
                <ChevronDown className={cn("size-4 transition-transform", !refsOpen && "-rotate-90")} />
                Add research &amp; references
                <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                {hasReferences && (
                  <span className="ml-auto text-xs text-primary font-medium">
                    {urls.length + refFiles.length + (notes.trim() ? 1 : 0)} added
                  </span>
                )}
              </button>

              {refsOpen && (
                <div className="mt-2 space-y-3 border border-border rounded-lg p-3 bg-surface/50 overflow-hidden">
                  <p className="text-xs text-muted-foreground">
                    Add links, notes, or documents for the AI to reference. If left empty, the AI will auto-research
                    from PubMed and Semantic Scholar.
                  </p>

                  {/* URLs */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-1">
                      <Link className="size-3.5" />
                      Links
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="url"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            handleAddUrl()
                          }
                        }}
                        placeholder="https://pubmed.ncbi.nlm.nih.gov/..."
                        className="flex-1 px-2.5 py-1.5 rounded-md border border-border bg-white text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={handleAddUrl}
                        disabled={!urlInput.trim()}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-surface transition-colors disabled:opacity-40"
                      >
                        <Plus className="size-3" />
                        Add
                      </button>
                    </div>
                    {urls.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {urls.map((url, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white border border-border text-xs group min-w-0 overflow-hidden"
                          >
                            <Link className="size-3 text-muted-foreground shrink-0" />
                            <span className="truncate flex-1 min-w-0 text-muted-foreground">{url}</span>
                            <button
                              type="button"
                              onClick={() => setUrls((prev) => prev.filter((_, i) => i !== idx))}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="size-3.5 text-muted-foreground hover:text-red-500" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-1">
                      <FileText className="size-3.5" />
                      Notes &amp; excerpts
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Paste research excerpts, study findings, key points..."
                      rows={3}
                      className="w-full px-2.5 py-1.5 rounded-md border border-border bg-white text-xs resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">{notes.length}/10,000</p>
                  </div>

                  {/* File upload */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-1">
                      <FileText className="size-3.5" />
                      Documents
                    </label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,.csv,.pdf,.doc,.docx"
                      multiple
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <div
                      onDragEnter={handleDragEnter}
                      onDragLeave={handleDragLeave}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onClick={() => {
                        if (refFiles.length < 5 && !extracting) fileInputRef.current?.click()
                      }}
                      className={cn(
                        "flex flex-col items-center justify-center gap-1.5 px-4 py-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors",
                        dragging
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
                        (refFiles.length >= 5 || extracting) && "opacity-40 cursor-not-allowed",
                      )}
                    >
                      {extracting ? (
                        <>
                          <Loader2 className="size-5 animate-spin" />
                          <span className="text-xs">Extracting text...</span>
                        </>
                      ) : dragging ? (
                        <>
                          <Upload className="size-5" />
                          <span className="text-xs font-medium">Drop files here</span>
                        </>
                      ) : (
                        <>
                          <Upload className="size-5" />
                          <span className="text-xs">
                            Drag & drop or{" "}
                            <span className="text-primary font-medium underline underline-offset-2">browse</span>
                          </span>
                          <span className="text-[10px] text-muted-foreground">PDF, DOC, TXT, MD, or CSV</span>
                        </>
                      )}
                    </div>
                    {refFiles.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {refFiles.map((file, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white border border-border text-xs group min-w-0 overflow-hidden"
                          >
                            <FileText className="size-3 text-muted-foreground shrink-0" />
                            <span className="truncate flex-1 min-w-0">{file.name}</span>
                            <span className="text-muted-foreground text-[10px] shrink-0">
                              {(file.content.length / 1024).toFixed(1)}KB
                            </span>
                            <button
                              type="button"
                              onClick={() => setRefFiles((prev) => prev.filter((_, i) => i !== idx))}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="size-3.5 text-muted-foreground hover:text-red-500" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
              </>
            )}

            {/* Register — shared between both modes */}
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">Register</label>
              <div className="grid grid-cols-2 gap-0 rounded-lg border border-border overflow-hidden">
                {registers.map((r, idx) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRegister(r.value)}
                    className={cn(
                      "px-3 py-2.5 text-sm font-medium transition-all",
                      idx < registers.length - 1 && "border-r border-border",
                      register === r.value
                        ? "bg-primary/10 text-primary"
                        : "bg-white text-muted-foreground hover:bg-surface hover:text-foreground",
                    )}
                  >
                    {r.label}
                    <span
                      className={cn(
                        "block text-[11px] font-normal mt-0.5",
                        register === r.value ? "text-primary/70" : "text-muted-foreground",
                      )}
                    >
                      {r.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Length — shared between both modes */}
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">Length</label>
              <div className="grid grid-cols-3 gap-0 rounded-lg border border-border overflow-hidden">
                {lengths.map((l, idx) => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => setLength(l.value)}
                    className={cn(
                      "px-3 py-2.5 text-sm font-medium transition-all",
                      idx < lengths.length - 1 && "border-r border-border",
                      length === l.value
                        ? "bg-primary/10 text-primary"
                        : "bg-white text-muted-foreground hover:bg-surface hover:text-foreground",
                    )}
                  >
                    {l.label}
                    <span
                      className={cn(
                        "block text-[11px] font-normal mt-0.5",
                        length === l.value ? "text-primary/70" : "text-muted-foreground",
                      )}
                    >
                      {l.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Video mode — video picker + submit */}
            {mode === "video" && (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Pick a transcribed video</label>
                  <ul className="mt-2 border border-border rounded-md divide-y divide-border max-h-60 overflow-y-auto">
                    {videos.length === 0 && (
                      <li className="px-3 py-2 text-sm text-muted-foreground">No transcribed videos yet.</li>
                    )}
                    {videos.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedVideoId(v.id)}
                          className={cn(
                            "w-full text-left px-3 py-2 text-sm hover:bg-surface/50",
                            selectedVideoId === v.id && "bg-primary/5",
                          )}
                        >
                          <div className="font-medium text-primary">{v.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(v.created_at).toLocaleDateString()}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  disabled={!selectedVideoId}
                  onClick={async () => {
                    if (!selectedVideoId) return
                    setStartError(null)
                    try {
                      const res = await fetch("/api/admin/blog-posts/generate-from-video", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        // register is sent for Phase 1 consistency; the from-video route currently ignores it
                        body: JSON.stringify({ video_upload_id: selectedVideoId, register, length }),
                      })
                      if (!res.ok) {
                        const data = await res.json().catch(() => ({}))
                        const { message } = summarizeApiError(res, data, "Failed to generate from video")
                        setStartError(message)
                        toast.error(message)
                        return
                      }
                      const body = (await res.json()) as { jobId: string; blog_post_id: string }
                      onOpenChange(false)
                      router.push(`/admin/blog/${body.blog_post_id}/edit`)
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
                  Generate from video
                </button>
              </div>
            )}

            {/* Generate button — prompt mode only */}
            {mode === "prompt" && (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={prompt.length < 10 || submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed mt-1"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {hasExistingContent && confirmed ? "Confirm & Generate" : "Generate Blog Post"}
              </button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
