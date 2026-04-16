"use client"

import { useState } from "react"
import { StickyNote } from "lucide-react"

interface NotesFieldProps {
  orderId: string
  initialNotes: string
}

export function NotesField({ orderId, initialNotes }: NotesFieldProps) {
  const [notes, setNotes] = useState(initialNotes)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleBlur() {
    if (notes === initialNotes) return
    setSaving(true)
    setSaved(false)
    try {
      await fetch(`/api/admin/shop/orders/${orderId}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-3">
        <StickyNote className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Admin Notes</h2>
        {saving && (
          <span className="ml-auto text-xs text-muted-foreground">Saving…</span>
        )}
        {saved && !saving && (
          <span className="ml-auto text-xs text-green-600">Saved</span>
        )}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={handleBlur}
        rows={4}
        placeholder="Internal notes (not visible to customer)"
        className="w-full rounded-lg border border-border px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </div>
  )
}
