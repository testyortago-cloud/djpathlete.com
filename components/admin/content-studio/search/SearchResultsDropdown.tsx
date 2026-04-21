"use client"

import Link from "next/link"
import { Film, FileText, Megaphone, Loader2 } from "lucide-react"
import type { SearchResults } from "@/lib/content-studio/search"

interface SearchResultsDropdownProps {
  q: string
  results: SearchResults
  loading: boolean
  onSelect: () => void
}

function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string
  icon: React.ReactNode
  count: number
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <section className="py-2">
      <h4 className="px-3 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1">
        {icon} {title} ({count})
      </h4>
      <ul className="mt-1">{children}</ul>
    </section>
  )
}

export function SearchResultsDropdown({ q, results, loading, onSelect }: SearchResultsDropdownProps) {
  const total = results.videos.length + results.transcripts.length + results.posts.length
  if (loading) {
    return (
      <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-border rounded-md shadow-lg z-40 px-3 py-3 text-sm text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="size-3 animate-spin" /> Searching…
      </div>
    )
  }
  if (total === 0) {
    return (
      <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-border rounded-md shadow-lg z-40 px-3 py-3 text-sm text-muted-foreground">
        No results for &quot;{q}&quot;.
      </div>
    )
  }
  return (
    <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-border rounded-md shadow-lg z-40 max-h-96 overflow-y-auto">
      <Section title="Videos" icon={<Film className="size-3" />} count={results.videos.length}>
        {results.videos.map((v) => (
          <li key={v.id}>
            <Link
              href={`/admin/content/${v.id}`}
              onClick={onSelect}
              className="block px-3 py-1.5 text-sm text-primary hover:bg-surface/40 truncate"
            >
              {v.title ?? v.original_filename}
              <span className="ml-2 text-[11px] text-muted-foreground">{v.status}</span>
            </Link>
          </li>
        ))}
      </Section>
      <Section title="Transcripts" icon={<FileText className="size-3" />} count={results.transcripts.length}>
        {results.transcripts.map((t) => (
          <li key={t.id}>
            <Link
              href={`/admin/content/${t.video_upload_id}?drawerTab=transcript`}
              onClick={onSelect}
              className="block px-3 py-1.5 hover:bg-surface/40"
            >
              <p className="text-sm text-primary line-clamp-2">{t.snippet}</p>
              {t.video_filename && <p className="text-[11px] text-muted-foreground truncate">{t.video_filename}</p>}
            </Link>
          </li>
        ))}
      </Section>
      <Section title="Posts" icon={<Megaphone className="size-3" />} count={results.posts.length}>
        {results.posts.map((p) => (
          <li key={p.id}>
            <Link
              href={`/admin/content/post/${p.id}`}
              onClick={onSelect}
              className="block px-3 py-1.5 hover:bg-surface/40"
            >
              <p className="text-sm text-primary line-clamp-2">{p.content}</p>
              <p className="text-[11px] text-muted-foreground">
                {p.platform} · {p.approval_status} · {p.source_video_filename ?? "Manual"}
              </p>
            </Link>
          </li>
        ))}
      </Section>
    </div>
  )
}
