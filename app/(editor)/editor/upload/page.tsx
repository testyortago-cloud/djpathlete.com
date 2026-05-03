import { UploadDropzone } from "@/components/editor/UploadDropzone"

export const metadata = { title: "Upload Video" }

export default function EditorUploadPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl text-primary">Upload a video</h2>
        <p className="font-body text-sm text-muted-foreground">
          Add a new video for Darren to review. After upload, status moves to
          &quot;Awaiting Darren&quot; automatically.
        </p>
      </div>
      <UploadDropzone />
    </div>
  )
}
