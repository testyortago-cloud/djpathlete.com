"use client"

import { Copy, RefreshCw, Pencil, Sparkles } from "lucide-react"
import { toast } from "sonner"
import type { VideoTranscript } from "@/types/database"

interface TranscriptTabProps {
  transcript: VideoTranscript | null
}

export function TranscriptTab({ transcript }: TranscriptTabProps) {
  if (!transcript) {
    return (
      <div className="py-12 text-center">
        <Sparkles className="size-8 text-muted-foreground mx-auto mb-2" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">No transcript yet.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Click Transcribe on the video card to generate one.
        </p>
      </div>
    )
  }

  const isVision = transcript.source === "vision"

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(transcript!.transcript_text)
      toast.success("Transcript copied")
    } catch {
      toast.error("Copy failed")
    }
  }

  function handleStub(label: string) {
    toast.info(
      `${label} is coming in a later phase — Phase 2 ships the transcript-next-to-video fix only.`,
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center flex-wrap gap-2 px-6 py-3 border-b border-border bg-background">
        {isVision && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-medium">
            <Sparkles className="size-3" /> Vision description
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {transcript.transcript_text.length.toLocaleString()} characters · {transcript.language}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary/5 text-primary hover:bg-primary/10"
          >
            <Copy className="size-3.5" /> Copy
          </button>
          <button
            type="button"
            onClick={() => handleStub("Regenerate")}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary/5 text-muted-foreground hover:text-primary hover:bg-primary/10"
          >
            <RefreshCw className="size-3.5" /> Regenerate
          </button>
          <button
            type="button"
            onClick={() => handleStub("Edit")}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary/5 text-muted-foreground hover:text-primary hover:bg-primary/10"
          >
            <Pencil className="size-3.5" /> Edit
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <p className="text-sm text-primary leading-relaxed whitespace-pre-wrap font-body">
          {transcript.transcript_text}
        </p>
      </div>
    </div>
  )
}
