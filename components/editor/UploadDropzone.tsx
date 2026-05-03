"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { UploadCloud } from "lucide-react"
import { uploadToSignedUrl } from "@/lib/firebase-client-upload"

export function UploadDropzone() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [progress, setProgress] = useState<number>(0)
  const [submitting, setSubmitting] = useState(false)

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) setFile(f)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !title.trim()) {
      toast.error("Pick a file and add a title")
      return
    }
    setSubmitting(true)
    setProgress(0)
    try {
      // 1. Create submission + get signed URL
      const createRes = await fetch("/api/editor/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      })
      if (!createRes.ok) {
        const json = await createRes.json().catch(() => ({}))
        throw new Error(json.error ?? "Failed to create submission")
      }
      const { submission, upload } = await createRes.json()

      // 2. Upload file directly to Firebase Storage via the v4 signed URL.
      // uploadToSignedUrl uses XHR under the hood so we can show real progress.
      await uploadToSignedUrl(upload.uploadUrl, file, (e) => setProgress(e.percent))

      // 3. Finalize
      const finRes = await fetch(`/api/editor/submissions/${submission.id}/finalize`, {
        method: "POST",
      })
      if (!finRes.ok) {
        const json = await finRes.json().catch(() => ({}))
        throw new Error(json.error ?? "Finalize failed")
      }

      toast.success("Video submitted for review")
      router.push(`/editor/videos/${submission.id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed"
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g. Squat tutorial v1"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Anything Darren should know about this cut?"
        />
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        className="cursor-pointer rounded-md border-2 border-dashed bg-muted/40 p-12 text-center transition hover:bg-muted/60"
      >
        <UploadCloud className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-2 font-body text-sm">
          {file ? (
            <span className="font-medium">{file.name}</span>
          ) : (
            <>
              Drag a video here or <span className="text-primary underline">browse</span>
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          MP4, MOV, WebM, MKV — max 5 GB
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {submitting && progress > 0 && (
        <div className="text-xs text-muted-foreground">
          Uploaded {progress}%
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting || !file || !title.trim()}>
          {submitting ? "Submitting..." : "Submit for review"}
        </Button>
      </div>
    </form>
  )
}
