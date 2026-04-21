"use client"

import { useState } from "react"
import { Check, X, Loader2 } from "lucide-react"
import { toast } from "sonner"

interface BulkActionsBarProps {
  selectedIds: Set<string>
  onClear: () => void
  onApproved: () => void
}

export function BulkActionsBar({ selectedIds, onClear, onApproved }: BulkActionsBarProps) {
  const [busy, setBusy] = useState(false)

  if (selectedIds.size === 0) return null

  async function approveAll() {
    setBusy(true)
    try {
      const ids = Array.from(selectedIds)
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          const res = await fetch(`/api/admin/social/posts/${id}/approve`, { method: "POST" })
          if (!res.ok) throw new Error(`${id} ${res.status}`)
          return res
        }),
      )
      const failed = results.filter((r) => r.status === "rejected").length
      if (failed > 0) toast.error(`${failed} of ${ids.length} failed`)
      else toast.success(`Approved ${ids.length}`)
      onApproved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-40 bg-primary text-primary-foreground shadow-lg rounded-full px-4 py-2 flex items-center gap-3">
      <span className="text-sm font-medium">{selectedIds.size} selected</span>
      <button
        type="button"
        onClick={approveAll}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full bg-success/20 text-white hover:bg-success/30 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
        Approve {selectedIds.size}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-60"
      >
        <X className="size-3" /> Clear
      </button>
    </div>
  )
}
