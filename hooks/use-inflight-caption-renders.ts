"use client"

import { useEffect, useState } from "react"
import { collection, onSnapshot, query, where } from "firebase/firestore"
import { db } from "@/lib/firebase"

// Live set of videoUploadIds that currently have an in-flight (pending/processing/
// streaming) captioned-cut render, read straight from Firestore. `ai_jobs` is
// client-readable (firestore.rules), and the type==/status-in query needs no
// composite index (the `in` decomposes into equality disjuncts). This lets the
// Pipeline board DISCOVER renders that started AFTER it was server-rendered — e.g.
// kicked off from the video drawer while the board is open. Empty until the first
// snapshot; on a listener error it stays empty and the board falls back to its other
// refresh paths (RenderWatcher / manual navigation). Mirrors the in-flight status set
// used by deriveRenderSignals on the server so the two stay consistent.
export function useInFlightCaptionRenderVideoIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const q = query(
      collection(db, "ai_jobs"),
      where("type", "==", "video_caption_render"),
      where("status", "in", ["pending", "processing", "streaming"]),
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next = new Set<string>()
        for (const d of snap.docs) {
          const input = d.data()?.input as { videoUploadId?: unknown } | undefined
          if (typeof input?.videoUploadId === "string") next.add(input.videoUploadId)
        }
        setIds(next)
      },
      (err) => {
        console.error("[useInFlightCaptionRenderVideoIds] listener error:", err)
      },
    )
    return () => unsub()
  }, [])

  return ids
}
