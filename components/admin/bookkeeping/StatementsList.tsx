"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { FileText, Download, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import type { BookkeepingDocument } from "@/types/database"

/**
 * AI Bookkeeper Phase 2, Task 16 — statements management list. Renders the
 * uploaded bank/Venmo statements for the active book (download signed URL /
 * delete). Owns its own book-change refetch so it stays correct no matter
 * how the parent (AccountsManager) wires `initialDocuments`.
 */
export function StatementsList({
  bookId,
  initialDocuments,
}: {
  bookId: string
  initialDocuments: BookkeepingDocument[]
}) {
  const [documents, setDocuments] = useState<BookkeepingDocument[]>(initialDocuments)
  const [busyId, setBusyId] = useState<string | null>(null)
  const isFirstLoad = useRef(true)

  // Refetch whenever the active book changes — skip the very first render,
  // the server page already supplied initialDocuments for it (mirrors the
  // accounts refetch pattern in AccountsManager/BooksClient).
  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false
      return
    }
    if (!bookId) {
      setDocuments([])
      return
    }
    let cancelled = false
    fetch(`/api/admin/bookkeeping/documents?book_id=${bookId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load statements")
        return res.json()
      })
      .then((body: { documents: BookkeepingDocument[] }) => {
        if (!cancelled) setDocuments(body.documents ?? [])
      })
      .catch((error) => {
        if (!cancelled) toast.error(`Failed to load statements: ${(error as Error).message}`)
      })
    return () => {
      cancelled = true
    }
  }, [bookId])

  async function handleDownload(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/bookkeeping/documents/${id}/download`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Failed to sign download")
      if (typeof data.url === "string") window.open(data.url, "_blank")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm("Delete this statement? The uploaded file will be permanently removed.")
    if (!confirmed) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/bookkeeping/documents/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.text()) || "Failed to delete statement")
      setDocuments((list) => list.filter((d) => d.id !== id))
      toast.success("Statement deleted")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="font-heading text-foreground">Statements</h2>
      {documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          heading="No statements uploaded"
          description="Uploaded bank/Venmo statements will appear here for download or removal."
        />
      ) : (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <p className="font-medium text-foreground">{doc.original_filename ?? "Untitled statement"}</p>
                <p className="text-xs text-muted-foreground">
                  Uploaded {formatOccurredOn(doc.created_at.slice(0, 10))}
                  {typeof doc.row_count === "number" ? ` · ${doc.row_count} rows` : ""}
                  {typeof doc.posted_count === "number" ? ` · ${doc.posted_count} posted` : ""}
                  {" · Retained until "}
                  {formatOccurredOn(doc.retain_until)}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => handleDownload(doc.id)} disabled={busyId === doc.id}>
                  <Download className="size-4" />
                  Download
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(doc.id)}
                  disabled={busyId === doc.id}
                  className="text-error hover:text-error"
                >
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
