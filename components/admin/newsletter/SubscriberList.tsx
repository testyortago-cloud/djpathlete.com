"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  Search,
  Upload,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ToggleLeft,
  ToggleRight,
  X,
  RefreshCw,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { Subscriber } from "@/lib/db/newsletter"
import { auditCsvLines } from "@/lib/newsletter/audit"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

const IMPORT_CHUNK_SIZE = 2000

interface SubscriberListProps {
  subscribers: Subscriber[]
}

const statusTabs = ["All", "Active", "Unsubscribed"] as const
type StatusTab = (typeof statusTabs)[number]

export function SubscriberList({ subscribers }: SubscriberListProps) {
  const router = useRouter()
  const [tab, setTab] = useState<StatusTab>("All")
  const [search, setSearch] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [importResult, setImportResult] = useState<{
    imported: number
    invalid: number
    disposable: number
    duplicates: number
    total: number
  } | null>(null)
  const [parsedEmails, setParsedEmails] = useState<string[]>([])
  const [invalidLines, setInvalidLines] = useState<string[]>([])
  const [disposableEmails, setDisposableEmails] = useState<string[]>([])
  const [duplicateCount, setDuplicateCount] = useState(0)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filtered = subscribers.filter((s) => {
    if (tab === "Active" && s.unsubscribed_at) return false
    if (tab === "Unsubscribed" && !s.unsubscribed_at) return false
    if (search) {
      const q = search.toLowerCase()
      return s.email.toLowerCase().includes(q) || s.source.toLowerCase().includes(q)
    }
    return true
  })

  function formatDate(dateString: string | null) {
    if (!dateString) return "—"
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  async function handleToggleStatus(sub: Subscriber) {
    setActionLoadingId(sub.id)
    const action = sub.unsubscribed_at ? "resubscribe" : "unsubscribe"
    try {
      const res = await fetch(`/api/admin/newsletter/subscribers/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error("Failed to update")
      toast.success(action === "resubscribe" ? "Subscriber reactivated" : "Subscriber unsubscribed")
      router.refresh()
    } catch {
      toast.error("Failed to update subscriber")
    } finally {
      setActionLoadingId(null)
    }
  }

  async function handleDelete(id: string) {
    setActionLoadingId(id)
    try {
      const res = await fetch(`/api/admin/newsletter/subscribers/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete")
      toast.success("Subscriber removed")
      setConfirmDeleteId(null)
      router.refresh()
    } catch {
      toast.error("Failed to delete subscriber")
    } finally {
      setActionLoadingId(null)
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      parseCsv(text)
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  function parseCsv(text: string) {
    const lines = text.split(/[\r\n]+/)
    const audit = auditCsvLines(lines)
    setParsedEmails(audit.valid)
    setInvalidLines(audit.invalidFormat)
    setDisposableEmails(audit.disposable)
    setDuplicateCount(audit.duplicates)
    setImportResult(null)
    setImportProgress(null)
    setImportOpen(true)
  }

  async function handleImport() {
    if (parsedEmails.length === 0) return

    setImporting(true)
    setImportProgress({ done: 0, total: parsedEmails.length })
    let imported = 0
    try {
      // Chunk so any list size imports without hitting request body limits.
      for (let i = 0; i < parsedEmails.length; i += IMPORT_CHUNK_SIZE) {
        const chunk = parsedEmails.slice(i, i + IMPORT_CHUNK_SIZE)
        const res = await fetch("/api/admin/newsletter/subscribers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: chunk }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? "Import failed")
        }
        const result = await res.json()
        imported += result.added ?? chunk.length
        setImportProgress({ done: Math.min(i + chunk.length, parsedEmails.length), total: parsedEmails.length })
      }

      setImportResult({
        imported,
        invalid: invalidLines.length,
        disposable: disposableEmails.length,
        duplicates: duplicateCount,
        total: parsedEmails.length,
      })
      toast.success(`Imported ${imported} subscriber(s)`)
      router.refresh()
    } catch (err) {
      const base = err instanceof Error ? err.message : "Import failed"
      toast.error(
        imported > 0
          ? `${base} — ${imported} imported before the error. Re-run to finish (safe, no duplicates).`
          : base,
      )
      if (imported > 0) router.refresh()
    } finally {
      setImporting(false)
      setImportProgress(null)
    }
  }

  function resetImport() {
    setImportOpen(false)
    setImportResult(null)
    setParsedEmails([])
    setInvalidLines([])
    setDisposableEmails([])
    setDuplicateCount(0)
  }

  function handleDownloadTemplate() {
    const csv = "email\njohn@example.com\njane@example.com\n"
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "newsletter_subscribers_template.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleExport() {
    const rows = ["email,source,subscribed_at,status"]
    for (const s of subscribers) {
      rows.push(`"${s.email}","${s.source}","${s.subscribed_at}","${s.unsubscribed_at ? "unsubscribed" : "active"}"`)
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `subscribers_export_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleSyncGHL() {
    setSyncing(true)
    try {
      const res = await fetch("/api/admin/newsletter/subscribers/sync-ghl", {
        method: "POST",
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error ?? "Sync failed")
      }

      if (data.total === 0) {
        toast.info("No contacts found in GoHighLevel")
      } else {
        toast.success(`Synced from GHL: ${data.added} new, ${data.skipped} already existed (${data.total} total)`)
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "GHL sync failed")
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1 bg-surface rounded-lg p-1">
          {statusTabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                tab === t ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subscribers..."
              className="pl-8 pr-3 py-2 rounded-lg border border-border bg-white text-sm w-48 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <a
            href="/templates/newsletter_subscribers_template.csv"
            download
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
            title="Download CSV template"
          >
            <Download className="size-4" />
            <span className="hidden sm:inline">Template</span>
          </a>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
            title="Export subscribers"
          >
            <Download className="size-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            onClick={handleSyncGHL}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface transition-colors disabled:opacity-50"
            title="Sync subscribers from GoHighLevel"
          >
            <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
            <span className="hidden sm:inline">{syncing ? "Syncing..." : "Sync GHL"}</span>
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Upload className="size-4" />
            Import CSV
          </button>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">{search ? "No subscribers match your search." : "No subscribers yet."}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">
                    Subscribed
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-surface/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-primary">{s.email}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span
                        className={cn(
                          "inline-block px-2 py-0.5 rounded-full text-xs font-medium",
                          s.unsubscribed_at ? "bg-warning/10 text-warning" : "bg-success/10 text-success",
                        )}
                      >
                        {s.unsubscribed_at ? "Unsubscribed" : "Active"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell capitalize">
                      {s.source.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell">
                      {formatDate(s.subscribed_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Toggle status */}
                        <button
                          onClick={() => handleToggleStatus(s)}
                          disabled={actionLoadingId === s.id}
                          className={cn(
                            "p-1.5 rounded-md transition-colors",
                            s.unsubscribed_at
                              ? "text-muted-foreground hover:text-success hover:bg-success/10"
                              : "text-muted-foreground hover:text-warning hover:bg-warning/10",
                          )}
                          title={s.unsubscribed_at ? "Reactivate" : "Unsubscribe"}
                        >
                          {actionLoadingId === s.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : s.unsubscribed_at ? (
                            <ToggleLeft className="size-4" />
                          ) : (
                            <ToggleRight className="size-4" />
                          )}
                        </button>

                        {/* Delete */}
                        {confirmDeleteId === s.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(s.id)}
                              disabled={actionLoadingId === s.id}
                              className="px-2 py-1 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                            >
                              {actionLoadingId === s.id ? <Loader2 className="size-3 animate-spin" /> : "Delete"}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:bg-surface transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(s.id)}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-border bg-surface/30">
            <p className="text-xs text-muted-foreground">
              Showing {filtered.length} of {subscribers.length} subscribers
            </p>
          </div>
        </div>
      )}

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="size-5 text-primary" />
              Import Subscribers
            </DialogTitle>
            <DialogDescription>Review parsed emails before importing.</DialogDescription>
          </DialogHeader>

          {importResult ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-success/10 border border-success/20">
                <CheckCircle2 className="size-5 text-success shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">Import complete</p>
                  <p className="text-muted-foreground mt-1">
                    {importResult.imported} subscriber(s) imported
                    {importResult.duplicates > 0 && `, ${importResult.duplicates} duplicate(s) removed`}
                    {importResult.disposable > 0 && `, ${importResult.disposable} disposable excluded`}
                    {importResult.invalid > 0 && `, ${importResult.invalid} invalid row(s) skipped`}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Tip: use “Sync GHL” to push these into GoHighLevel.
                  </p>
                </div>
              </div>
              <button
                onClick={resetImport}
                className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Parsed summary */}
              <div className="p-3 rounded-lg bg-surface border border-border space-y-0.5">
                <p className="text-sm font-medium text-foreground">{parsedEmails.length} valid email(s) ready to import</p>
                {duplicateCount > 0 && (
                  <p className="text-xs text-muted-foreground">{duplicateCount} duplicate(s) removed</p>
                )}
                {disposableEmails.length > 0 && (
                  <p className="text-xs text-warning">
                    {disposableEmails.length} disposable/throwaway address(es) excluded
                  </p>
                )}
                {invalidLines.length > 0 && (
                  <p className="text-xs text-warning">{invalidLines.length} invalid row(s) will be skipped</p>
                )}
              </div>

              {/* Preview emails */}
              {parsedEmails.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-white">
                  {parsedEmails.slice(0, 50).map((email, idx) => (
                    <div
                      key={idx}
                      className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border last:border-0"
                    >
                      {email}
                    </div>
                  ))}
                  {parsedEmails.length > 50 && (
                    <div className="px-3 py-1.5 text-xs text-muted-foreground italic">
                      ...and {parsedEmails.length - 50} more
                    </div>
                  )}
                </div>
              )}

              {/* Invalid rows */}
              {invalidLines.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-warning mb-1">Invalid rows:</p>
                  <div className="max-h-24 overflow-y-auto rounded-lg border border-warning/20 bg-warning/5">
                    {invalidLines.slice(0, 10).map((line, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-1 text-xs text-warning border-b border-warning/10 last:border-0"
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Download template */}
              <button
                onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <Download className="size-3.5" />
                Download CSV template
              </button>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={resetImport}
                  disabled={importing}
                  className="flex-1 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-surface transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={parsedEmails.length === 0 || importing}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  {importing
                    ? importProgress
                      ? `Importing ${importProgress.done}/${importProgress.total}...`
                      : "Importing..."
                    : `Import ${parsedEmails.length} Email(s)`}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
