"use client"

import { useState, useRef } from "react"
import { Upload, Loader2, CheckCircle, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { uploadVideoFile, type UploadProgressEvent } from "@/lib/firebase-client-upload"
import { cn } from "@/lib/utils"

interface VideoUploaderProps {
  onUploaded: (videoUploadId: string) => void
}

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; filename: string; percent: number }
  | { status: "done"; filename: string }
  | { status: "error"; message: string }

export function VideoUploader({ onUploaded }: VideoUploaderProps) {
  const [state, setState] = useState<UploadState>({ status: "idle" })
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (!file.type.startsWith("video/")) {
      setState({ status: "error", message: "Please upload a video file (.mp4, .mov, .webm)" })
      return
    }

    setState({ status: "uploading", filename: file.name, percent: 0 })

    try {
      const { videoUploadId } = await uploadVideoFile(file, {
        title: file.name.replace(/\.[^.]+$/, ""),
        onProgress: (event: UploadProgressEvent) => {
          setState({ status: "uploading", filename: file.name, percent: event.percent })
        },
      })
      setState({ status: "done", filename: file.name })
      toast.success(`${file.name} uploaded`)
      onUploaded(videoUploadId)
    } catch (error) {
      const message = (error as Error).message ?? "Upload failed"
      setState({ status: "error", message })
      toast.error(`Upload failed: ${message}`)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border">
      <label
        htmlFor="video-uploader-input"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = e.dataTransfer.files[0]
          if (file) void handleFile(file)
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 p-8 cursor-pointer rounded-xl border-2 border-dashed transition",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
        )}
      >
        <input
          ref={inputRef}
          id="video-uploader-input"
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />

        {state.status === "idle" && (
          <>
            <Upload className="size-8 text-primary" />
            <p className="font-medium text-primary">Drop a video here or click to choose</p>
            <p className="text-xs text-muted-foreground">MP4, MOV, WebM — we&apos;ll handle the rest</p>
          </>
        )}
        {state.status === "uploading" && (
          <>
            <Loader2 className="size-8 text-warning animate-spin" />
            <p className="font-medium text-primary">Uploading {state.filename}</p>
            <div className="w-full max-w-sm h-2 rounded-full bg-primary/10 overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${state.percent}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{state.percent}%</p>
          </>
        )}
        {state.status === "done" && (
          <>
            <CheckCircle className="size-8 text-success" />
            <p className="font-medium text-primary">{state.filename} uploaded</p>
            <p className="text-xs text-muted-foreground">Click anywhere to upload another</p>
          </>
        )}
        {state.status === "error" && (
          <>
            <AlertCircle className="size-8 text-error" />
            <p className="font-medium text-error">{state.message}</p>
            <p className="text-xs text-muted-foreground">Click anywhere to try again</p>
          </>
        )}
      </label>
    </div>
  )
}
