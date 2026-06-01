"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAiJob } from "@/hooks/use-ai-job"

/**
 * Invisible live-watcher for in-flight captioned-cut renders. One <JobWatch> per
 * render job listens via useAiJob (Firestore onSnapshot); when a job reaches a
 * terminal state we refresh the route so the server re-derives the Videos lane and
 * the card advances out of the Rendering column. Isolating Firebase here keeps
 * VideoCard free of Firestore imports.
 */
export function RenderWatcher({ jobIds }: { jobIds: string[] }) {
  const router = useRouter()
  return (
    <>
      {jobIds.map((id) => (
        <JobWatch key={id} jobId={id} onDone={() => router.refresh()} />
      ))}
    </>
  )
}

function JobWatch({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const { status } = useAiJob(jobId)
  useEffect(() => {
    if (status === "completed" || status === "failed") onDone()
  }, [status, onDone])
  return null
}
