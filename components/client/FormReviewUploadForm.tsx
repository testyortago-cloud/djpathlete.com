"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Upload, Video, X, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { summarizeApiError, type FieldErrors } from "@/lib/errors/humanize"
import {
  useFormReviewUpload,
  FORM_REVIEW_MAX_SIZE_MB,
  FORM_REVIEW_MAX_DURATION_SECONDS,
} from "@/hooks/use-form-review-upload"

interface FormReviewUploadFormProps {
  userId: string
}

export function FormReviewUploadForm({ userId }: FormReviewUploadFormProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [dragOver, setDragOver] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitFieldErrors, setSubmitFieldErrors] = useState<FieldErrors>({})

  const { uploading, progress, validateVideo, uploadVideo } = useFormReviewUpload(userId)

  async function handleFileSelect(selectedFile: File | undefined) {
    if (!selectedFile) return
    const valid = await validateVideo(selectedFile)
    if (valid) setFile(selectedFile)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const droppedFile = e.dataTransfer.files[0]
    handleFileSelect(droppedFile)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    setSubmitFieldErrors({})

    if (!file || !title.trim()) {
      const fe: FieldErrors = {}
      if (!title.trim()) fe.title = ["Required"]
      if (!file) fe.video_path = ["Required"]
      setSubmitFieldErrors(fe)
      const msg = "Please fill in all required fields"
      setSubmitError(msg)
      toast.error(msg)
      return
    }

    try {
      // 1. Upload to Firebase Storage (shared hook)
      const videoPath = await uploadVideo(file)

      // 2. Create the form review record in Supabase
      const res = await fetch("/api/client/form-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_path: videoPath,
          title: title.trim(),
          notes: notes.trim() || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const { message, fieldErrors: fe } = summarizeApiError(res, data, "Failed to create form review")
        setSubmitError(message)
        setSubmitFieldErrors(fe)
        toast.error(message)
        return
      }

      toast.success("Form review submitted!")
      router.push("/client/form-reviews")
      router.refresh()
    } catch (err) {
      console.error("Upload error:", err)
      const message = err instanceof Error
        ? err.message
        : "We couldn't upload your video. Please check your connection and try again."
      setSubmitError(message)
      toast.error(message)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormErrorBanner
        message={submitError}
        fieldErrors={submitFieldErrors}
        labels={{ title: "Title", video_path: "Video", notes: "Notes" }}
      />
      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">Title *</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Back Squat Form Check"
          maxLength={200}
        />
      </div>

      {/* Video upload */}
      <div className="space-y-2">
        <Label>Video *</Label>
        <div
          className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
            dragOver
              ? "border-primary bg-primary/5"
              : file
                ? "border-green-300 bg-green-50"
                : "border-border hover:border-primary/40"
          }`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
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
              <Video className="size-8 text-green-600" />
              <div className="text-left">
                <p className="text-sm font-medium text-foreground">{file.name}</p>
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
            <div className="space-y-2">
              <Upload className="size-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">Drag and drop your video, or click to browse</p>
              <p className="text-xs text-muted-foreground">
                MP4, MOV, WebM, or AVI. Max {FORM_REVIEW_MAX_SIZE_MB}MB, {FORM_REVIEW_MAX_DURATION_SECONDS / 60} minutes.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Upload progress bar */}
      {uploading && (
        <div className="space-y-1">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-center">Uploading... {progress}%</p>
        </div>
      )}

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything specific you'd like feedback on? e.g. knee tracking, bar path, depth..."
          maxLength={2000}
          rows={3}
        />
      </div>

      {/* Submit */}
      <Button type="submit" disabled={uploading || !file || !title.trim()} className="w-full">
        {uploading ? (
          <>
            <Loader2 className="size-4 mr-2 animate-spin" />
            Uploading...
          </>
        ) : (
          "Submit for Review"
        )}
      </Button>
    </form>
  )
}
