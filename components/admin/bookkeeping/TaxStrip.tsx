"use client"

// Compact tax set-aside strip for the books page (owner request 2026-08-03:
// "put the tax in the books page"). Shows the same per-business-book forecast
// as the Insights card — one shared route keeps the two from ever disagreeing;
// the detailed breakdown stays on Insights. Household books render nothing.
// The rate is CPA-entered: when unset the strip offers inline entry instead of
// inventing a number.
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Landmark } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatCents } from "@/lib/bookkeeping/money"
import type { TaxForecast } from "@/lib/bookkeeping/tax-forecast"

interface StripPayload {
  business: boolean
  forecast?: TaxForecast
}

export function TaxStrip({ bookId }: { bookId: string }) {
  const [payload, setPayload] = useState<StripPayload | null>(null)
  const [editing, setEditing] = useState(false)
  const [rateInput, setRateInput] = useState("")
  const [saving, setSaving] = useState(false)
  // Stale-response guard (scanRequestIdRef pattern): a book switch mid-flight
  // must not let the old book's forecast land on the new book's strip.
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    try {
      const res = await fetch(`/api/admin/bookkeeping/tax-forecast?book_id=${encodeURIComponent(bookId)}`)
      const data = (await res.json().catch(() => null)) as StripPayload | null
      if (requestId !== requestIdRef.current) return
      setPayload(res.ok && data && typeof data.business === "boolean" ? data : null)
    } catch {
      if (requestId !== requestIdRef.current) return
      setPayload(null) // strip is a nicety — it hides on failure, never errors
    }
  }, [bookId])

  useEffect(() => {
    setEditing(false)
    if (bookId) void load()
  }, [bookId, load])

  async function saveRate() {
    const percent = Number.parseFloat(rateInput)
    if (!Number.isFinite(percent) || percent < 0.01 || percent > 100) {
      toast.error("Enter a rate between 0.01 and 100")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/insights/tax-rate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ percent }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? "Failed to save the rate")
      }
      toast.success("Tax rate saved")
      setEditing(false)
      await load()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!payload?.business || !payload.forecast) return null
  const f = payload.forecast
  const rateSet = f.rate_percent !== null && f.estimated_tax_cents !== null

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
      <span className="flex items-center gap-2 text-foreground">
        <Landmark aria-hidden className="size-4 text-accent" />
        {rateSet ? (
          <>
            Set aside for tax so far:{" "}
            <span className="font-heading font-semibold tabular-nums">~{formatCents(f.estimated_tax_cents as number)}</span>
          </>
        ) : (
          "Tax estimate needs one number — the rate from your accountant."
        )}
      </span>

      {rateSet && (
        <span className="text-muted-foreground">
          next payment date <span className="text-foreground">{f.next_safe_harbor.label}</span>
        </span>
      )}

      {editing || !rateSet ? (
        <span className="flex items-center gap-2">
          <Input
            type="number"
            min={0.01}
            max={100}
            step="0.01"
            value={rateInput}
            disabled={saving}
            onChange={(e) => setRateInput(e.target.value)}
            placeholder="Rate %"
            aria-label="Tax rate percent"
            className="h-8 w-24 text-sm"
          />
          <Button size="sm" disabled={saving} onClick={() => void saveRate()}>
            Save
          </Button>
          {editing && (
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => {
            setRateInput(f.rate_percent !== null ? String(f.rate_percent) : "")
            setEditing(true)
          }}
          className="text-xs text-primary underline underline-offset-2"
        >
          rate {f.rate_percent}% — change
        </button>
      )}

      <Link
        href="/admin/books/insights"
        className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Details
      </Link>
    </div>
  )
}
