"use client"

import { Search } from "lucide-react"
import { useCommandPalette } from "@/hooks/use-command-palette"

/** Opens the admin command palette. Rendered in both the desktop and mobile sidebars. */
export function SidebarSearchTrigger({ onOpen }: { onOpen?: () => void }) {
  const { setOpen } = useCommandPalette()

  return (
    <button
      type="button"
      onClick={() => {
        onOpen?.()
        setOpen(true)
      }}
      className="flex w-full items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm text-white/60 transition-colors hover:bg-white/15 hover:text-white/80"
    >
      <Search className="size-4 shrink-0" strokeWidth={1.5} />
      <span className="flex-1 text-left">Search...</span>
      <kbd className="hidden lg:inline-flex items-center rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-medium text-white/50">
        ⌘K
      </kbd>
    </button>
  )
}
