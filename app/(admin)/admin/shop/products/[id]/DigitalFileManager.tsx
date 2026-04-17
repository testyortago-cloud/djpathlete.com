// app/(admin)/admin/shop/products/[id]/DigitalFileManager.tsx
"use client"
import { useState } from "react"
import { toast } from "sonner"
import type { ShopProductFile } from "@/types/database"

export function DigitalFileManager({
  productId,
  initialFiles,
}: {
  productId: string
  initialFiles: ShopProductFile[]
}) {
  const [files, setFiles] = useState(initialFiles)
  const [uploading, setUploading] = useState(false)

  async function onUpload(f: File) {
    setUploading(true)
    try {
      const signRes = await fetch("/api/uploads/shop-pdf", {
        method: "POST",
        body: JSON.stringify({
          file_name: f.name, content_type: f.type, file_size_bytes: f.size,
        }),
      })
      if (!signRes.ok) throw new Error("sign failed")
      const { upload_url, storage_path } = await signRes.json()
      const put = await fetch(upload_url, {
        method: "PUT", body: f, headers: { "Content-Type": f.type },
      })
      if (!put.ok) throw new Error("upload failed")
      const attach = await fetch(`/api/admin/shop/products/${productId}/files`, {
        method: "POST",
        body: JSON.stringify({
          file_name: f.name, display_name: f.name,
          storage_path, file_size_bytes: f.size, mime_type: f.type,
        }),
      })
      const { file } = await attach.json()
      setFiles((prev) => [...prev, file])
      toast.success("Uploaded")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function onDelete(fileId: string) {
    if (!confirm("Delete this file?")) return
    const res = await fetch(
      `/api/admin/shop/products/${productId}/files/${fileId}`,
      { method: "DELETE" },
    )
    if (res.ok) setFiles((p) => p.filter((f) => f.id !== fileId))
  }

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border p-4">
        <input
          type="file"
          accept="application/pdf,application/zip,video/mp4,audio/mpeg"
          onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          disabled={uploading}
        />
        <span>{uploading ? "Uploading…" : "Drop or choose a file (PDF/ZIP/MP4/MP3, max 500MB)"}</span>
      </label>
      <ul className="space-y-2">
        {files.map((f) => (
          <li key={f.id} className="flex items-center justify-between rounded border border-border px-3 py-2">
            <div>
              <div className="font-medium">{f.display_name}</div>
              <div className="text-xs text-muted-foreground">
                {f.file_name} · {(f.file_size_bytes / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
            <button onClick={() => onDelete(f.id)} className="text-sm text-destructive">Delete</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
