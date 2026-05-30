// render-worker/src/lib/assemblyai-words.ts
import type { TranscriptWord } from "./caption-paging.js"

const BASE_URL = "https://api.assemblyai.com/v2"

interface AssemblyTranscriptResponse {
  id: string
  status: string
  words?: { text: string; start: number; end: number }[]
  error?: string
}

/**
 * Fetch word-level timestamps for a completed AssemblyAI transcript. The
 * create-route guard guarantees this id exists; a failed/empty response here is
 * a hard error (no auto-resubmit).
 */
export async function fetchTranscriptWords(transcriptId: string): Promise<TranscriptWord[]> {
  const key = process.env.ASSEMBLYAI_API_KEY
  if (!key) throw new Error("ASSEMBLYAI_API_KEY not set")

  const res = await fetch(`${BASE_URL}/transcript/${transcriptId}`, {
    headers: { authorization: key },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`AssemblyAI fetch failed (${res.status}): ${text}`)
  }
  const body = (await res.json()) as AssemblyTranscriptResponse
  if (body.status === "error") {
    throw new Error(`AssemblyAI transcript error: ${body.error ?? "unknown error"}`)
  }
  if (!body.words || body.words.length === 0) {
    throw new Error("AssemblyAI transcript has no word timestamps")
  }
  return body.words.map((w) => ({ text: w.text, start: w.start, end: w.end }))
}
