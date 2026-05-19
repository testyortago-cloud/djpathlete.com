"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Pencil } from "lucide-react"

interface Props {
  campaignId: string
  campaignName: string
  /** Current daily budget in micros (1,000,000 micros = $1). null = unknown / not yet synced. */
  initialBudgetMicros: number | null
}

const MICROS_PER_DOLLAR = 1_000_000

function dollarsFromMicros(micros: number | null): string {
  if (micros == null) return ""
  return (micros / MICROS_PER_DOLLAR).toFixed(2)
}

function formatDisplay(micros: number | null): string {
  if (micros == null) return "—"
  return `$${(micros / MICROS_PER_DOLLAR).toFixed(2)}/day`
}

export function CampaignBudgetEdit({ campaignId, campaignName, initialBudgetMicros }: Props) {
  const router = useRouter()
  const [micros, setMicros] = useState<number | null>(initialBudgetMicros)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(dollarsFromMicros(initialBudgetMicros))
  const [pending, startTransition] = useTransition()

  function startEdit() {
    setDraft(dollarsFromMicros(micros))
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setDraft(dollarsFromMicros(micros))
  }

  function save() {
    const parsed = Number.parseFloat(draft)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("Enter a positive dollar amount.")
      return
    }
    const nextMicros = Math.round(parsed * MICROS_PER_DOLLAR)
    if (nextMicros === micros) {
      setEditing(false)
      return
    }
    const previousDollars = micros != null ? (micros / MICROS_PER_DOLLAR).toFixed(2) : "—"
    if (
      !confirm(
        `Change daily budget for "${campaignName}" from $${previousDollars} to $${parsed.toFixed(2)}? This is pushed to Google Ads immediately and applies to every campaign sharing this budget.`,
      )
    ) {
      return
    }

    const previousMicros = micros
    setMicros(nextMicros)
    setEditing(false)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/ads/campaigns/${campaignId}/budget`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ daily_budget_dollars: parsed }),
        })
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
          shared_campaign_count?: number
        }
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        const shared = body.shared_campaign_count ?? 1
        toast.success(
          shared > 1
            ? `Budget updated. Note: ${shared} campaigns share this budget — all affected.`
            : `Budget updated to $${parsed.toFixed(2)}/day.`,
        )
        router.refresh()
      } catch (err) {
        setMicros(previousMicros)
        toast.error(`Update failed: ${(err as Error).message}`)
      }
    })
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 justify-end">
        <span className="font-mono text-xs text-muted-foreground">$</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="1"
          max="5000"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save()
            if (e.key === "Escape") cancel()
          }}
          className="w-20 text-right font-mono text-xs border border-border rounded px-1.5 py-0.5 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={`Daily budget for ${campaignName}`}
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="text-[10px] px-1.5 py-0.5 rounded border border-success/40 text-success hover:bg-success/10 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      disabled={pending}
      title="Click to edit daily budget — change pushes to Google Ads"
      className="group inline-flex items-center gap-1 font-mono text-xs hover:text-accent disabled:opacity-50 transition-colors"
    >
      <span>{pending ? "Saving…" : formatDisplay(micros)}</span>
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
    </button>
  )
}
