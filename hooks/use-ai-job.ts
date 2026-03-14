"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { db } from "@/lib/firebase"
import {
  doc,
  collection,
  onSnapshot,
  query,
  orderBy,
} from "firebase/firestore"

// ─── Types ──────────────────────────────────────────────────────────────────

export type AiJobStatus = "pending" | "processing" | "streaming" | "completed" | "failed"

export interface AiJobChunk {
  index: number
  type: "delta" | "analysis" | "tool_start" | "tool_result" | "program_created" | "message_id" | "done" | "error"
  data: Record<string, unknown>
}

export interface ToolActivity {
  name: string
  label: string
}

export interface AiJobResult {
  status: AiJobStatus
  text: string
  chunks: AiJobChunk[]
  analysis: Record<string, unknown> | null
  programCreated: { programId: string; validationPass: boolean; durationMs: number } | null
  messageId: string | null
  error: string | null
  result: Record<string, unknown> | null
  activeTools: ToolActivity[]
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useAiJob(jobId: string | null): AiJobResult & { reset: () => void } {
  const [status, setStatus] = useState<AiJobStatus>("pending")
  const [text, setText] = useState("")
  const [chunks, setChunks] = useState<AiJobChunk[]>([])
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null)
  const [programCreated, setProgramCreated] = useState<AiJobResult["programCreated"]>(null)
  const [messageId, setMessageId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [activeTools, setActiveTools] = useState<ToolActivity[]>([])

  // Track processed chunk indices to avoid duplicates
  const processedIndices = useRef(new Set<number>())

  const reset = useCallback(() => {
    setStatus("pending")
    setText("")
    setChunks([])
    setAnalysis(null)
    setProgramCreated(null)
    setMessageId(null)
    setError(null)
    setResult(null)
    setActiveTools([])
    processedIndices.current.clear()
  }, [])

  useEffect(() => {
    if (!jobId) return

    // Reset state for new job
    reset()

    // Listen to the job document for status changes
    const jobUnsub = onSnapshot(
      doc(db, "ai_jobs", jobId),
      (snap) => {
        if (!snap.exists()) return
        const data = snap.data()
        setStatus(data.status as AiJobStatus)
        if (data.result) setResult(data.result)
        if (data.error) setError(data.error)
      },
      (err) => {
        console.error("[useAiJob] Job listener error:", err)
        setError("Failed to connect to job updates")
        setStatus("failed")
      }
    )

    // Listen to the chunks subcollection for streaming deltas
    const chunksQuery = query(
      collection(db, "ai_jobs", jobId, "chunks"),
      orderBy("index", "asc")
    )

    const chunksUnsub = onSnapshot(
      chunksQuery,
      (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type !== "added") continue
          const chunk = change.doc.data() as AiJobChunk
          const idx = chunk.index

          // Skip already-processed chunks
          if (processedIndices.current.has(idx)) continue
          processedIndices.current.add(idx)

          setChunks((prev) => [...prev, chunk])

          switch (chunk.type) {
            case "delta":
              setText((prev) => prev + (chunk.data.text as string))
              break
            case "analysis":
              setAnalysis(chunk.data)
              break
            case "program_created":
              setProgramCreated({
                programId: chunk.data.programId as string,
                validationPass: chunk.data.validationPass as boolean,
                durationMs: chunk.data.durationMs as number,
              })
              break
            case "tool_start":
              setActiveTools((prev) => [
                ...prev,
                {
                  name: chunk.data.name as string,
                  label: (chunk.data.label as string) ?? (chunk.data.name as string),
                },
              ])
              break
            case "tool_result":
              setActiveTools((prev) =>
                prev.filter((t) => t.name !== (chunk.data.name as string))
              )
              break
            case "message_id":
              setMessageId(chunk.data.id as string)
              break
            case "error":
              setError(chunk.data.message as string)
              break
            case "done":
              // Status will be updated by job doc listener
              break
          }
        }
      },
      (err) => {
        console.error("[useAiJob] Chunks listener error:", err)
      }
    )

    return () => {
      jobUnsub()
      chunksUnsub()
    }
  }, [jobId, reset])

  return { status, text, chunks, analysis, programCreated, messageId, error, result, activeTools, reset }
}
