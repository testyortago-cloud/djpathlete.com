"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { useCommandPalette } from "@/hooks/use-command-palette"
import { getCommandPaletteItems, searchCommandPaletteItems, type CommandPaletteItem } from "./registry"
import type { PermissionActor } from "@/lib/permissions/registry"

interface AdminCommandPaletteProps {
  contentStudioEnabled?: boolean
  actor?: PermissionActor | null
}

/**
 * Global "search or jump to..." palette for the admin panel. Opens via the
 * sidebar search trigger or Cmd/Ctrl+K from anywhere, and matches on more
 * than literal page names — e.g. "create a client" surfaces Clients via the
 * synonym list in `registry.ts`, not just an exact string match on the route.
 */
export function AdminCommandPalette({ contentStudioEnabled = false, actor }: AdminCommandPaletteProps) {
  const router = useRouter()
  const { open, setOpen } = useCommandPalette()
  const [query, setQuery] = useState("")

  const items = useMemo(
    () => getCommandPaletteItems({ contentStudioEnabled, actor }),
    [contentStudioEnabled, actor],
  )

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  // Cmd/Ctrl+K opens the palette from anywhere, including while typing in a
  // form field — a modifier combo like this doesn't collide with normal
  // typing, unlike a bare-letter shortcut.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleSelect(href: string) {
    setOpen(false)
    router.push(href)
  }

  const trimmed = query.trim()
  const flatResults = trimmed ? searchCommandPaletteItems(items, query).slice(0, 8) : []

  const groups = useMemo(() => {
    const map = new Map<string, CommandPaletteItem[]>()
    for (const item of items) {
      const list = map.get(item.section)
      if (list) list.push(item)
      else map.set(item.section, [item])
    }
    return map
  }, [items])

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search admin"
      description="Search pages and actions across the admin panel"
      shouldFilter={false}
    >
      <CommandInput placeholder="Search or jump to... e.g. create a client" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {trimmed ? (
          flatResults.length > 0 && (
            <CommandGroup heading="Results">
              {flatResults.map((item) => (
                <PaletteItem key={item.href} item={item} onSelect={handleSelect} showSection />
              ))}
            </CommandGroup>
          )
        ) : (
          Array.from(groups.entries()).map(([section, sectionItems]) => (
            <CommandGroup key={section} heading={section}>
              {sectionItems.map((item) => (
                <PaletteItem key={item.href} item={item} onSelect={handleSelect} />
              ))}
            </CommandGroup>
          ))
        )}
      </CommandList>
    </CommandDialog>
  )
}

function PaletteItem({
  item,
  onSelect,
  showSection = false,
}: {
  item: CommandPaletteItem
  onSelect: (href: string) => void
  showSection?: boolean
}) {
  const Icon = item.icon
  return (
    <CommandItem value={item.href} onSelect={() => onSelect(item.href)}>
      <Icon />
      <span>{item.label}</span>
      {showSection && <CommandShortcut>{item.section}</CommandShortcut>}
    </CommandItem>
  )
}
