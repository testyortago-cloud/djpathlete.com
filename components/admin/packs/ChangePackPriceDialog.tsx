"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function ChangePackPriceDialog({
  packId,
  priceCents,
  cardPayment,
  autoRenew = false,
  onSaved,
}: {
  packId: string
  priceCents: number
  cardPayment: boolean
  autoRenew?: boolean
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [total, setTotal] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const value = total.trim()
    if (!/^\d+(\.\d{1,2})?$/.test(value)) {
      setError("Enter a valid total with at most two decimal places")
      return
    }
    const cents = Math.round(Number(value) * 100)
    if (!Number.isSafeInteger(cents) || cents < 1 || cents > 99999999) {
      setError("Enter a total between $0.01 and $999,999.99")
      return
    }
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/admin/session-packs/${packId}/price`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceCents: cents }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error ?? "Could not change the pack price")
        if (data.priceSaved) onSaved()
        return
      }
      setUrl(data.url ?? null)
      setSaved(true)
      onSaved()
    } catch {
      setError("Could not reach the server. Try again")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        setOpen(next)
        if (next) {
          setTotal((priceCents / 100).toFixed(2))
          setError("")
          setSaved(false)
          setUrl(null)
          setCopied(false)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Change price
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{saved ? "Pack price updated" : "Change unpaid pack price"}</DialogTitle>
          <DialogDescription>
            {saved
              ? "The sessions and check-in history have been kept."
              : cardPayment
                ? "Enter the total for the whole pack. Saving replaces the old payment link. Send the new link to the payer."
                : "Enter the total owed for the whole pack. The sessions and check-in history will be kept."}
          </DialogDescription>
        </DialogHeader>
        {saved ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-foreground">New total: ${Number(total).toFixed(2)} USD</p>
            {url && (
              <div className="space-y-2">
                <Label htmlFor={`replacement-link-${packId}`}>Replacement payment link</Label>
                <Input
                  id={`replacement-link-${packId}`}
                  value={url}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url)
                      setCopied(true)
                      setError("")
                    } catch {
                      setError("Select the link above and copy it manually")
                    }
                  }}
                >
                  {copied ? "Link copied" : "Copy new payment link"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  The old link no longer works. This new link has not been emailed.
                </p>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-error">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor={`pack-total-${packId}`}>New pack total (USD)</Label>
              <Input
                id={`pack-total-${packId}`}
                type="text"
                inputMode="decimal"
                value={total}
                onChange={(event) => setTotal(event.target.value)}
                disabled={busy}
              />
            </div>
            {autoRenew && (
              <p className="text-sm text-muted-foreground">
                Auto-renew is on. Future renewals of this pack will use the corrected total too.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-error">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : cardPayment ? "Save price and replace link" : "Save price"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
