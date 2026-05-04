"use client"

import { useState } from "react"
import { toast } from "sonner"
import type {
  GoogleAdsConversionAction,
  GoogleAdsConversionTrigger,
} from "@/types/database"

const TRIGGERS: Array<{ value: GoogleAdsConversionTrigger; label: string; hint: string }> = [
  {
    value: "booking_created",
    label: "Booking created",
    hint: "Fires when a GHL booking webhook lands. Default value should be a placeholder for a discovery-call lead (e.g. $50).",
  },
  {
    value: "payment_succeeded",
    label: "Payment succeeded",
    hint: "Used by Plan 1.5d's RESTATE adjustment — the actual paid value overrides the booking placeholder. Configure the same conversion action that booking_created uses.",
  },
]

interface Props {
  customerIds: string[]
  existingByTrigger: Record<GoogleAdsConversionTrigger, GoogleAdsConversionAction | undefined>
}

export function ConversionActionForm({ customerIds, existingByTrigger }: Props) {
  if (customerIds.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-xl p-6 bg-card text-sm text-muted-foreground">
        Connect a Google Ads account first (
        <a href="/admin/ads/settings" className="underline hover:text-accent">/admin/ads/settings</a>).
        Conversion actions are scoped to a Customer ID.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {TRIGGERS.map((t) => (
        <TriggerRow
          key={t.value}
          customerIds={customerIds}
          trigger={t}
          existing={existingByTrigger[t.value]}
        />
      ))}
    </div>
  )
}

interface TriggerRowProps {
  customerIds: string[]
  trigger: { value: GoogleAdsConversionTrigger; label: string; hint: string }
  existing?: GoogleAdsConversionAction
}

function TriggerRow({ customerIds, trigger, existing }: TriggerRowProps) {
  const [customerId, setCustomerId] = useState(existing?.customer_id ?? customerIds[0])
  const [conversionActionId, setConversionActionId] = useState(existing?.conversion_action_id ?? "")
  const [name, setName] = useState(existing?.name ?? "")
  const [defaultValueDollars, setDefaultValueDollars] = useState(
    existing ? (existing.default_value_micros / 1_000_000).toString() : "50",
  )
  const [pending, setPending] = useState(false)

  async function save() {
    if (pending) return
    setPending(true)
    try {
      const valueDollars = Number(defaultValueDollars)
      if (Number.isNaN(valueDollars) || valueDollars < 0) {
        throw new Error("Default value must be a non-negative number")
      }
      const res = await fetch("/api/admin/ads/conversion-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          conversion_action_id: conversionActionId.trim(),
          name: name.trim() || trigger.label,
          trigger_type: trigger.value,
          default_value_micros: Math.round(valueDollars * 1_000_000),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      toast.success(`${trigger.label} saved.`)
      window.location.reload()
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    if (!existing || pending) return
    if (!confirm(`Delete the ${trigger.label} conversion action?`)) return
    setPending(true)
    try {
      const res = await fetch(`/api/admin/ads/conversion-actions?id=${existing.id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      toast.success("Removed.")
      window.location.reload()
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="border border-border rounded-xl bg-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-primary">{trigger.label}</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{trigger.hint}</p>
        </div>
        {existing ? (
          <span className="text-[11px] font-mono uppercase tracking-wider text-success">Configured</span>
        ) : (
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Not set</span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Customer ID">
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {customerIds.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Conversion Action ID (Google Ads numeric)">
          <input
            value={conversionActionId}
            onChange={(e) => setConversionActionId(e.target.value)}
            placeholder="e.g. 998877665"
            className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-card font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </Field>
        <Field label="Display name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={trigger.label}
            className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </Field>
        <Field label="Default value (USD)">
          <input
            type="number"
            min="0"
            step="0.01"
            value={defaultValueDollars}
            onChange={(e) => setDefaultValueDollars(e.target.value)}
            className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-card font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2 pt-2">
        {existing ? (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-error hover:border-error/50 disabled:opacity-50 transition-colors"
          >
            Remove
          </button>
        ) : null}
        <button
          type="button"
          onClick={save}
          disabled={pending || !conversionActionId.trim()}
          className="text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
        >
          {pending ? "Saving..." : existing ? "Update" : "Save"}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
