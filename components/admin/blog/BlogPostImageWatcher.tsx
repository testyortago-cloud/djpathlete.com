"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { db } from "@/lib/firebase"
import { useAiJob } from "@/hooks/use-ai-job"

interface Props {
  postId: string
  hasCoverImage: boolean
}

export function BlogPostImageWatcher({ postId, hasCoverImage }: Props) {
  const router = useRouter()
  const [jobId, setJobId] = useState<string | null>(null)
  const [hide, setHide] = useState(false)

  const job = useAiJob(jobId)

  // Find an in-flight blog_image_generation job for this post, if any.
  useEffect(() => {
    if (hasCoverImage) return
    const q = query(
      collection(db, "ai_jobs"),
      where("type", "==", "blog_image_generation"),
      where("input.blog_post_id", "==", postId),
      orderBy("createdAt", "desc"),
      limit(1),
    )
    const unsub = onSnapshot(q, (snap) => {
      const doc = snap.docs[0]
      if (!doc) return
      const status = doc.data().status as string | undefined
      if (status === "pending" || status === "processing") {
        setJobId(doc.id)
      }
    })
    return () => unsub()
  }, [postId, hasCoverImage])

  useEffect(() => {
    if (!jobId) return
    if (job.status === "completed") {
      toast.success("Cover image ready")
      router.refresh()
      setHide(true)
    } else if (job.status === "failed") {
      toast.error("Image generation failed", {
        description: job.error ?? undefined,
      })
      setHide(true)
    }
  }, [job.status, job.error, jobId, router])

  if (hasCoverImage || hide || !jobId) return null

  return (
    <div className="mb-4 rounded-lg border border-border bg-white p-3 flex items-center gap-2 text-sm">
      <Loader2 className="size-4 animate-spin text-primary" />
      <span className="text-muted-foreground">
        Generating cover image in the background — this page will refresh automatically.
      </span>
    </div>
  )
}
