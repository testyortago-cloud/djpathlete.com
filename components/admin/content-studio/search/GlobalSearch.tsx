"use client"

import { useEffect, useRef, useState } from "react"
import { Search } from "lucide-react"
import { SearchResultsDropdown } from "./SearchResultsDropdown"
import type { SearchResults } from "@/lib/content-studio/search"

const DEBOUNCE_MS = 200
const EMPTY: SearchResults = { videos: [], transcripts: [], posts: [] }

export function GlobalSearch() {
  const [value, setValue] = useState("")
  const [results, setResults] = useState<SearchResults>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!value.trim()) {
      setResults(EMPTY)
      setOpen(false)
      return
    }
    setLoading(true)
    setOpen(true)
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/content-studio/search?q=${encodeURIComponent(value.trim())}`,
          { signal: controller.signal },
        )
        if (!res.ok) throw new Error("Search failed")
        const body = (await res.json()) as SearchResults
        setResults(body)
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults(EMPTY)
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return
      if (containerRef.current.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  return (
    <div ref={containerRef} className="relative w-80">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => value.trim() && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false)
        }}
        placeholder="Search videos, transcripts, posts..."
        aria-label="Global search"
        className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-border bg-background placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {open && (
        <SearchResultsDropdown
          q={value}
          results={results}
          loading={loading}
          onSelect={() => setOpen(false)}
        />
      )}
    </div>
  )
}
