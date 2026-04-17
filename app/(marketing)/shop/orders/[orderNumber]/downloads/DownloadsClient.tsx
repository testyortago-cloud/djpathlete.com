"use client"
import { useState } from "react"
import { toast } from "sonner"
import type { ShopOrderDownload, ShopProductFile } from "@/types/database"

type Row = { download: ShopOrderDownload; file: ShopProductFile | null }

export function DownloadsClient({
  orderNumber,
  rows,
}: {
  orderNumber: string
  rows: Row[]
}) {
  const [email, setEmail] = useState("")
  const [unlocked, setUnlocked] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  function unlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Verification happens server-side on each sign call.
    setUnlocked(true)
  }

  async function downloadOne(id: string) {
    setBusyId(id)
    const res = await fetch("/api/shop/downloads/sign", {
      method: "POST",
      body: JSON.stringify({ order_number: orderNumber, email, download_id: id }),
    })
    setBusyId(null)
    if (!res.ok) {
      if (res.status === 403) toast.error("Email doesn't match this order")
      else if (res.status === 410) toast.error("Access expired or limit reached")
      else toast.error("Download failed")
      return
    }
    const { url } = await res.json()
    window.location.href = url
  }

  if (!unlocked) {
    return (
      <form onSubmit={unlock} className="mx-auto max-w-md px-4 py-12">
        <h1 className="font-heading text-2xl">Order {orderNumber}</h1>
        <p className="mt-2 text-muted-foreground">
          Enter the email you used at checkout to access your downloads.
        </p>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-4 w-full rounded border px-3 py-2"
        />
        <button
          type="submit"
          className="mt-4 rounded bg-primary px-4 py-2 text-primary-foreground"
        >
          Show downloads
        </button>
      </form>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="font-heading text-2xl">Your downloads</h1>
      <ul className="mt-6 space-y-3">
        {rows.map(({ download, file }) => (
          <li
            key={download.id}
            className="flex items-center justify-between rounded border border-border p-4"
          >
            <div>
              <div className="font-medium">{file!.display_name}</div>
              <div className="text-xs text-muted-foreground">
                Downloaded {download.download_count}
                {download.max_downloads != null ? ` / ${download.max_downloads}` : ""} times
              </div>
            </div>
            <button
              disabled={busyId === download.id}
              onClick={() => downloadOne(download.id)}
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              {busyId === download.id ? "Preparing\u2026" : "Download"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
