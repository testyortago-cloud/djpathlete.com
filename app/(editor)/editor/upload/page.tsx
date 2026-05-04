import { UploadDropzone } from "@/components/editor/UploadDropzone"

export const metadata = { title: "Upload Video" }

export default function EditorUploadPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="border-b border-border pb-4 space-y-1">
        <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
          Workshop · New upload
        </p>
        <h1 className="font-heading text-2xl text-primary">Upload a video</h1>
        <p className="font-body text-sm text-muted-foreground">
          Add a new video for Darren to review. After upload, status moves to
          &quot;Awaiting Darren&quot; automatically.
        </p>
      </header>
      <UploadDropzone />
    </div>
  )
}
