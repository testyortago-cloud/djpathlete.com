"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { StrategyBrief } from "@/types/database"

export function BriefEditor({ brief }: { brief: StrategyBrief }) {
  const router = useRouter()
  const [rationale, setRationale] = useState(brief.rationale)
  const [audienceFocus, setAudienceFocus] = useState(brief.audience_focus)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const res = await fetch(`/api/admin/strategy/brief/${brief.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rationale, audience_focus: audienceFocus }),
    })
    setBusy(false)
    if (!res.ok) {
      alert((await res.json()).error)
      return
    }
    router.refresh()
  }

  async function approve() {
    setBusy(true)
    const res = await fetch(`/api/admin/strategy/brief/${brief.id}/approve`, { method: "POST" })
    setBusy(false)
    if (!res.ok) {
      alert((await res.json()).error)
      return
    }
    router.refresh()
  }

  async function reject() {
    setBusy(true)
    const res = await fetch(`/api/admin/strategy/brief/${brief.id}/reject`, { method: "POST" })
    setBusy(false)
    if (!res.ok) {
      alert((await res.json()).error)
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-4 rounded border border-border p-4">
      <div className="font-mono text-xs text-muted-foreground">
        Week of {brief.week_of} · priority: {brief.priority_channel}
      </div>

      <label className="block text-sm">
        <span className="font-heading">Audience focus</span>
        <textarea
          className="mt-1 w-full rounded border border-border p-2 font-body"
          rows={2}
          value={audienceFocus}
          onChange={(e) => setAudienceFocus(e.target.value)}
        />
      </label>

      <label className="block text-sm">
        <span className="font-heading">Rationale</span>
        <textarea
          className="mt-1 w-full rounded border border-border p-2 font-body"
          rows={8}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
      </label>

      <details className="text-sm">
        <summary className="cursor-pointer">Themes · keywords · hooks · CTAs · don&apos;t do</summary>
        <pre className="mt-2 overflow-auto rounded bg-surface p-3 font-mono text-xs">
{JSON.stringify(
  {
    themes: brief.themes,
    keywords_to_chase: brief.keywords_to_chase,
    hooks_to_test: brief.hooks_to_test,
    ctas: brief.ctas,
    dont_do: brief.dont_do,
  },
  null,
  2,
)}
        </pre>
      </details>

      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="rounded bg-surface px-3 py-1 text-sm">
          Save draft
        </button>
        <button onClick={approve} disabled={busy} className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground">
          Approve
        </button>
        <button onClick={reject} disabled={busy} className="rounded border border-error px-3 py-1 text-sm text-error">
          Reject
        </button>
      </div>
    </div>
  )
}
