"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

interface Props {
  customerId: string
  active: boolean
}

export function AccountToggleButton({ customerId, active }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [optimisticActive, setOptimisticActive] = useState(active)

  async function toggle() {
    const next = !optimisticActive
    if (
      !next &&
      !confirm(
        `Hide ${customerId} from the admin? The assistant will stop suggesting changes for it. Historical data is kept; re-enable any time.`,
      )
    ) {
      return
    }
    setOptimisticActive(next)
    startTransition(async () => {
      const res = await fetch(`/api/admin/ads/accounts/${customerId}/toggle-active`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: next }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setOptimisticActive(!next)
        toast.error(json.error ?? `HTTP ${res.status}`)
        return
      }
      toast.success(next ? "Re-enabled." : "Hidden.")
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={
        optimisticActive
          ? "text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-error hover:border-error/50 transition-colors disabled:opacity-50"
          : "text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
      }
    >
      {pending ? "Saving…" : optimisticActive ? "Hide" : "Re-enable"}
    </button>
  )
}
