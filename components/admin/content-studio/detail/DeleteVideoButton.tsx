"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { readApiError } from "@/lib/errors/humanize"

interface DeleteVideoButtonProps {
  videoUploadId: string
  title: string
  /** Posts from this video that have not gone out yet (deleted with it). */
  unsentCount: number
  /** Posts already published (kept, and still live on the platform). */
  publishedCount: number
}

export function DeleteVideoButton({ videoUploadId, title, unsentCount, publishedCount }: DeleteVideoButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/videos/${videoUploadId}`, { method: "DELETE" })
      if (!res.ok) throw new Error(await readApiError(res, "Could not delete the video"))
      toast.success(`Deleted "${title}"`)
      router.push("/admin/content")
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-error/30 bg-white px-3 text-xs font-semibold text-error shadow-sm hover:bg-error/5"
      >
        <Trash2 className="size-3.5" /> Delete video
      </button>
      <AlertDialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This removes the video
                  {unsentCount > 0
                    ? ` and its ${unsentCount} ${unsentCount === 1 ? "post" : "posts"} that have not gone out yet`
                    : ""}
                  . Nothing from it will be posted. This cannot be undone.
                </p>
                {publishedCount > 0 && (
                  <p>
                    {publishedCount} {publishedCount === 1 ? "post has" : "posts have"} already been published. They
                    stay on Instagram and the other sites. Delete those in each app if you want them gone.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-error px-4 text-sm font-semibold text-white shadow-sm hover:bg-error/90 disabled:opacity-60"
            >
              {busy ? "Deleting…" : "Delete video"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
