"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"

interface Props {
  hiddenCount: number
  showHidden: boolean
}

/**
 * Tiny inline toggle that flips `?show_hidden=1` in the URL. The settings
 * page reads it server-side to decide whether to render the hidden-accounts
 * table. URL-based (rather than React state) so deep links / refreshes
 * preserve the user's choice.
 */
export function HiddenAccountsToggle({ hiddenCount, showHidden }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function toggle() {
    const next = new URLSearchParams(params.toString())
    if (showHidden) next.delete("show_hidden")
    else next.set("show_hidden", "1")
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
    >
      {showHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      {showHidden ? "Hide" : "Show"} {hiddenCount} hidden account
      {hiddenCount === 1 ? "" : "s"}
    </button>
  )
}
