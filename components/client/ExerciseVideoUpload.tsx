"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Upload, Video, X, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useFormReviewUpload, FORM_REVIEW_MAX_SIZE_MB } from "@/hooks/use-form-review-upload"

interface ExerciseVideoUploadProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  assignmentId: string
  programExerciseId: string
  exerciseId: string
  exerciseName: string
  weekNumber: number
  onUploaded?: () => void
}

export function ExerciseVideoUpload({
  open,
  onOpenChange,
  userId,
  assignmentId,
  programExerciseId,
  exerciseId,
  exerciseName,
  weekNumber,
  onUploaded,
}: ExerciseVideoUploadProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const { uploading, progress, validateVideo, uploadVideo } = useFormReviewUpload(userId)
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState("")

  async function handleFileSelect(selected: File | undefined) {
    if (!selected) return
    const valid = await validateVideo(selected)
    if (valid) setFile(selected)
  }

  async function handleSubmit() {
    if (!file) return
    try {
      const videoPath = await uploadVideo(file)
      const res = await fetch("/api/client/form-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_path: videoPath,
          assignment_id: assignmentId,
          program_exercise_id: programExerciseId,
          exercise_id: exerciseId,
          week_number: weekNumber,
          notes: note.trim() || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to submit recording")
      }
      toast.success("Recording submitted to your coach!")
      setFile(null)
      setNote("")
      onUploaded?.()
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload your video. Please try again.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (uploading ? null : onOpenChange(o))}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Upload recording</DialogTitle>
        <DialogDescription className="text-xs">
          {exerciseName} — Week {weekNumber}. Your coach will review it in Form Reviews.
        </DialogDescription>

        {/* Video picker */}
        <div
          className="relative border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer border-border hover:border-primary/40"
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files?.[0])}
          />
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <Video className="size-7 text-green-600" />
              <div className="text-left">
                <p className="text-sm font-medium text-foreground truncate max-w-[180px]">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setFile(null)
                }}
                className="p-1 rounded-full hover:bg-muted"
              >
                <X className="size-4 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Upload className="size-7 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">Tap to record or choose a video</p>
              <p className="text-xs text-muted-foreground">MP4, MOV, WebM, or AVI. Max {FORM_REVIEW_MAX_SIZE_MB}MB, 5 min.</p>
            </div>
          )}
        </div>

        {uploading && (
          <div className="space-y-1">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-muted-foreground text-center">Uploading... {progress}%</p>
          </div>
        )}

        <Textarea
          placeholder="Optional note for your coach (e.g. felt my knee cave on rep 3)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
          className="resize-none"
        />

        <Button onClick={handleSubmit} disabled={uploading || !file} className="w-full">
          {uploading ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Uploading...
            </>
          ) : (
            "Submit recording"
          )}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
