"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ExternalLink, Pencil } from "lucide-react"

interface Props {
  campaignId: string
  customerId: string
  externalCampaignId: string
  initialName: string
}

const MAX_LENGTH = 255

function googleAdsCampaignUrl(customerId: string, campaignId: string): string {
  return `https://ads.google.com/aw/campaigns?campaignId=${campaignId}&__c=${customerId}`
}

export function CampaignNameEdit({
  campaignId,
  customerId,
  externalCampaignId,
  initialName,
}: Props) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initialName)
  const [pending, startTransition] = useTransition()

  function startEdit() {
    setDraft(name)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setDraft(name)
  }

  function save() {
    const trimmed = draft.trim()
    if (trimmed.length === 0) {
      toast.error("Name cannot be empty.")
      return
    }
    if (trimmed.length > MAX_LENGTH) {
      toast.error(`Name must be ${MAX_LENGTH} characters or fewer.`)
      return
    }
    if (trimmed === name) {
      setEditing(false)
      return
    }
    if (
      !confirm(
        `Rename campaign\n\n  from: "${name}"\n  to:   "${trimmed}"\n\nThis is pushed to Google Ads immediately.`,
      )
    ) {
      return
    }

    const previous = name
    setName(trimmed)
    setEditing(false)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/ads/campaigns/${campaignId}/name`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        })
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        toast.success("Campaign renamed.")
        router.refresh()
      } catch (err) {
        setName(previous)
        toast.error(`Rename failed: ${(err as Error).message}`)
      }
    })
  }

  if (editing) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={draft}
            autoFocus
            maxLength={MAX_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save()
              if (e.key === "Escape") cancel()
            }}
            className="flex-1 min-w-0 text-sm border border-border rounded px-2 py-1 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label="Campaign name"
          />
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="text-[10px] px-1.5 py-1 rounded border border-success/40 text-success hover:bg-success/10 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="text-[10px] px-1.5 py-1 rounded border border-border text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        <p className="text-xs text-muted-foreground font-mono">
          {customerId} · {externalCampaignId}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="inline-flex items-center gap-1.5">
        <a
          href={googleAdsCampaignUrl(customerId, externalCampaignId)}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-1.5 font-medium text-primary leading-snug hover:text-accent hover:underline transition-colors"
          title="Open in Google Ads"
        >
          <span>{pending ? `${name} (saving…)` : name}</span>
          <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-70 transition-opacity" />
        </a>
        <button
          type="button"
          onClick={startEdit}
          disabled={pending}
          aria-label={`Rename ${name}`}
          title="Rename — change is pushed to Google Ads"
          className="text-muted-foreground hover:text-accent disabled:opacity-50 transition-colors"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground font-mono mt-0.5">
        {customerId} · {externalCampaignId}
      </p>
    </div>
  )
}
