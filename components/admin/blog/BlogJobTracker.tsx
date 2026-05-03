"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { collection, limit, onSnapshot, query, where } from "firebase/firestore"
import { Loader2, CheckCircle2, AlertCircle, X } from "lucide-react"
import { toast } from "sonner"
import { db } from "@/lib/firebase"
import { useAiJob } from "@/hooks/use-ai-job"

type Phase = "blog" | "image" | "done" | "failed"

export function BlogJobTracker() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queuedJobId = searchParams.get("just_queued")
  const blogJobId = queuedJobId && queuedJobId !== "1" ? queuedJobId : null

  const [imageJobId, setImageJobId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>("blog")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const blogJob = useAiJob(blogJobId)
  const imageJob = useAiJob(imageJobId)

  const refreshedOnceRef = useRef(false)

  // When the blog_generation job completes, watch for the spawned image job.
  useEffect(() => {
    if (!blogJobId) return
    if (blogJob.status !== "completed") return
    if (imageJobId) return

    const q = query(
      collection(db, "ai_jobs"),
      where("parentJobId", "==", blogJobId),
      where("type", "==", "blog_image_generation"),
      limit(1),
    )
    const unsub = onSnapshot(q, (snap) => {
      const doc = snap.docs[0]
      if (doc) {
        setImageJobId(doc.id)
        setPhase("image")
      }
    })
    return () => unsub()
  }, [blogJobId, blogJob.status, imageJobId])

  // After the blog post is inserted, refresh the list once so the new draft
  // shows up while images are still generating.
  useEffect(() => {
    if (blogJob.status !== "completed") return
    if (refreshedOnceRef.current) return
    refreshedOnceRef.current = true
    router.refresh()
  }, [blogJob.status, router])

  // When the image job finishes (success or fail), refresh once more and clear the param.
  useEffect(() => {
    if (!imageJobId) return
    if (imageJob.status === "completed") {
      setPhase("done")
      toast.success("Cover image ready", { description: "Refreshed your blog list." })
      router.replace(pathname)
      router.refresh()
    } else if (imageJob.status === "failed") {
      setPhase("failed")
      setErrorMessage(imageJob.error ?? "Image generation failed.")
    }
  }, [imageJob.status, imageJob.error, imageJobId, pathname, router])

  // Failure on the blog_generation step itself.
  useEffect(() => {
    if (blogJob.status === "failed") {
      setPhase("failed")
      setErrorMessage(blogJob.error ?? "Blog generation failed.")
    }
  }, [blogJob.status, blogJob.error])

  if (!blogJobId || dismissed) return null

  const heading =
    phase === "blog"
      ? "Generating draft…"
      : phase === "image"
        ? "Generating cover image…"
        : phase === "done"
          ? "Draft ready"
          : "Generation failed"

  const subtitle =
    phase === "blog"
      ? "Writing the post and citations. This usually takes 20-40 seconds."
      : phase === "image"
        ? "Hero + inline images via fal.ai. Usually 30-60 seconds."
        : phase === "done"
          ? "Your new draft is in the list below with its cover image."
          : (errorMessage ?? "")

  const isWorking = phase === "blog" || phase === "image"

  return (
    <div className="mb-6 rounded-xl border border-border bg-white shadow-sm p-4 flex items-start gap-3">
      <div className="shrink-0 mt-0.5">
        {isWorking ? (
          <Loader2 className="size-5 animate-spin text-primary" />
        ) : phase === "done" ? (
          <CheckCircle2 className="size-5 text-success" />
        ) : (
          <AlertCircle className="size-5 text-red-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-primary">{heading}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={() => {
          setDismissed(true)
          router.replace(pathname)
        }}
        aria-label="Dismiss"
        className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
