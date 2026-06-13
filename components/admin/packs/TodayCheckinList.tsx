"use client"

import Image from "next/image"
import { useState } from "react"
import { toast } from "sonner"
import { Check, QrCode, Copy, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface ClientRow {
  clientUserId: string
  name: string
  remaining: number
}

export function TodayCheckinList({
  clients,
  qrDataUrl,
  checkinUrl,
}: {
  clients: ClientRow[]
  qrDataUrl: string | null
  checkinUrl: string | null
}) {
  const [query, setQuery] = useState("")
  const [showQr, setShowQr] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, number>>({})

  const filtered = clients.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))

  async function checkIn(c: ClientRow) {
    setBusy(c.clientUserId)
    try {
      const res = await fetch("/api/admin/session-packs/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientUserId: c.clientUserId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Could not check in")
        return
      }
      if (data.reason === "duplicate") toast.info(`${c.name} already checked in`)
      else toast.success(`${c.name} checked in — ${data.remaining} left`)
      setDone((d) => ({ ...d, [c.clientUserId]: data.remaining ?? c.remaining - 1 }))
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      {qrDataUrl && checkinUrl && (
        <div className="bg-white rounded-xl border border-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-primary flex items-center gap-2">
                <QrCode className="size-4" strokeWidth={1.5} />
                Self check-in QR
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Clients scan this, tap their name, and the credit comes off automatically.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowQr((v) => !v)}>
              {showQr ? "Hide" : "Show"} QR
            </Button>
          </div>
          {showQr && (
            <div className="mt-4 flex flex-col items-center gap-3">
              <Image src={qrDataUrl} alt="Check-in QR code" width={240} height={240} unoptimized className="rounded-lg border border-border" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(checkinUrl)
                  toast.success("Link copied")
                }}
              >
                <Copy className="size-4" />
                Copy check-in link
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-border p-6">
        <div className="relative mb-4">
          <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients…"
            className="pl-9"
          />
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active-pack clients{query ? " match that search" : " yet"}.</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((c) => {
              const remaining = done[c.clientUserId] ?? c.remaining
              return (
                <li key={c.clientUserId} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-foreground">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{remaining} sessions left</p>
                  </div>
                  <Button size="sm" onClick={() => checkIn(c)} disabled={busy === c.clientUserId}>
                    <Check className="size-4" />
                    Check in
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
