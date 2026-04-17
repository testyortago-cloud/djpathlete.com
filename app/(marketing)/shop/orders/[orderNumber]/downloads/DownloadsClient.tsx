"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Archive,
  Download,
  FileText,
  Loader2,
  Lock,
  Mail,
  Music,
  Package,
  RefreshCw,
  Video,
} from "lucide-react"
import type { ShopOrderDownload, ShopProductFile } from "@/types/database"

type Row = { download: ShopOrderDownload; file: ShopProductFile | null }

function iconForMime(mime: string) {
  if (mime.includes("pdf")) return FileText
  if (mime.includes("zip")) return Archive
  if (mime.startsWith("video/")) return Video
  if (mime.startsWith("audio/")) return Music
  return FileText
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function DownloadsClient({
  orderNumber,
  rows,
}: {
  orderNumber: string
  rows: Row[]
}) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [unlocked, setUnlocked] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!unlocked || rows.length > 0) return
    const poll = setInterval(() => router.refresh(), 5000)
    const stop = setTimeout(() => clearInterval(poll), 120_000)
    return () => {
      clearInterval(poll)
      clearTimeout(stop)
    }
  }, [unlocked, rows.length, router])

  function unlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setUnlocked(true)
  }

  async function downloadOne(id: string) {
    setBusyId(id)
    try {
      const res = await fetch("/api/shop/downloads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_number: orderNumber, email, download_id: id }),
      })
      if (!res.ok) {
        if (res.status === 403) toast.error("Email doesn't match this order")
        else if (res.status === 410) toast.error("Access expired or limit reached")
        else toast.error("Download failed")
        return
      }
      const { url } = await res.json()
      window.location.href = url
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="pt-28 pb-20 lg:pt-36 lg:pb-28 px-4 sm:px-8 min-h-[80vh]">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px w-12 bg-accent" />
            <p className="text-sm font-medium text-accent uppercase tracking-widest font-body">
              Shop
            </p>
          </div>
          <h1 className="text-3xl sm:text-4xl font-heading font-semibold text-primary tracking-tight">
            {unlocked ? "Your downloads" : "Access your downloads"}
          </h1>
          <p className="mt-3 text-sm font-body text-muted-foreground">
            Order{" "}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-primary">
              {orderNumber}
            </code>
          </p>
        </div>

        {/* ── Unlock form ── */}
        {!unlocked && (
          <form
            onSubmit={unlock}
            className="rounded-2xl border border-border bg-background p-6 sm:p-8"
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Lock className="size-4" />
              </div>
              <div>
                <h2 className="font-heading text-lg font-semibold text-primary">
                  Verify it&apos;s you
                </h2>
                <p className="text-sm font-body text-muted-foreground">
                  Enter the email you used at checkout.
                </p>
              </div>
            </div>

            <label htmlFor="downloads-email" className="sr-only">
              Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="downloads-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-border bg-background pl-10 pr-3 py-2.5 text-sm font-body text-primary placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <button
              type="submit"
              className="mt-4 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium font-body text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Show my downloads
            </button>
          </form>
        )}

        {/* ── Empty (processing) state ── */}
        {unlocked && rows.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-10 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Loader2 className="size-6 animate-spin" />
            </div>
            <h2 className="mt-5 font-heading text-xl font-semibold text-primary">
              Your order is still processing
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm font-body text-muted-foreground">
              Files appear here the moment payment confirms — usually within a few seconds. We&apos;ll
              also email you the download link. This page auto-refreshes while you wait.
            </p>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="mt-6 inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium font-body text-primary hover:bg-surface transition-colors"
            >
              <RefreshCw className="size-3.5" />
              Refresh now
            </button>
          </div>
        )}

        {/* ── Downloads list ── */}
        {unlocked && rows.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
              <Package className="size-4 text-accent shrink-0" />
              <p className="text-xs sm:text-sm font-body text-primary">
                <span className="font-medium">
                  {rows.length} file{rows.length === 1 ? "" : "s"} ready.
                </span>{" "}
                <span className="text-muted-foreground">
                  Links expire once you exceed the download limit or the access window ends.
                </span>
              </p>
            </div>

            <ul className="space-y-3">
              {rows.map(({ download, file }) => {
                if (!file) return null
                const Icon = iconForMime(file.mime_type)
                const busy = busyId === download.id
                const remaining =
                  download.max_downloads != null
                    ? Math.max(0, download.max_downloads - download.download_count)
                    : null
                const exhausted = remaining === 0
                const expired =
                  download.access_expires_at != null &&
                  new Date(download.access_expires_at) < new Date()
                const disabled = busy || exhausted || expired

                return (
                  <li
                    key={download.id}
                    className="flex items-center gap-4 rounded-2xl border border-border bg-background p-4 sm:p-5 transition-shadow hover:shadow-sm"
                  >
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-body font-medium text-primary">
                        {file.display_name}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-body text-muted-foreground">
                        <span>{formatSize(file.file_size_bytes)}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {download.download_count} download
                          {download.download_count === 1 ? "" : "s"}
                          {download.max_downloads != null
                            ? ` of ${download.max_downloads}`
                            : ""}
                        </span>
                        {expired && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-destructive">Access expired</span>
                          </>
                        )}
                        {!expired && exhausted && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-destructive">Limit reached</span>
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => downloadOne(download.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium font-body text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Download className="size-4" />
                      )}
                      <span className="hidden sm:inline">
                        {busy ? "Preparing…" : "Download"}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            <p className="pt-2 text-xs font-body text-muted-foreground text-center">
              Trouble downloading? Email{" "}
              <a
                href="mailto:support@darrenjpaul.com"
                className="text-primary underline underline-offset-2 hover:no-underline"
              >
                support@darrenjpaul.com
              </a>{" "}
              with your order number.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
