// functions/src/lib/assemblyai.ts
// Thin wrapper over AssemblyAI's v2 transcript REST API.
// Docs: https://www.assemblyai.com/docs/api-reference/transcripts

const BASE_URL = "https://api.assemblyai.com/v2"

export interface TranscriptSubmission {
  audio_url: string
  webhook_url: string
  language_code?: string
  speaker_labels?: boolean
}

export interface TranscriptJob {
  id: string
  status: "queued" | "processing" | "completed" | "error"
  text?: string
  error?: string
  audio_duration?: number
  language_code?: string
}

function getApiKey(): string {
  const key = process.env.ASSEMBLYAI_API_KEY
  if (!key) {
    throw new Error("ASSEMBLYAI_API_KEY environment variable is required")
  }
  return key
}

export async function submitTranscription(input: TranscriptSubmission): Promise<TranscriptJob> {
  const response = await fetch(`${BASE_URL}/transcript`, {
    method: "POST",
    headers: {
      authorization: getApiKey(),
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`AssemblyAI submit failed (${response.status}): ${text}`)
  }
  return (await response.json()) as TranscriptJob
}

export async function getTranscript(id: string): Promise<TranscriptJob> {
  const response = await fetch(`${BASE_URL}/transcript/${id}`, {
    headers: { authorization: getApiKey() },
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`AssemblyAI get failed (${response.status}): ${text}`)
  }
  return (await response.json()) as TranscriptJob
}
