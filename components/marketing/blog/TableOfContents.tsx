import { ListTree } from "lucide-react"

export interface TocEntry {
  id: string
  text: string
}

interface TableOfContentsProps {
  entries: TocEntry[]
  /**
   * - "mobile": collapsed `<details>` block (intended to sit above the article)
   * - "desktop": numbered sticky rail (intended for a side aside on lg+)
   * - omitted: renders both with internal hide/show classes (legacy)
   */
  variant?: "mobile" | "desktop"
}

export function TableOfContents({ entries, variant }: TableOfContentsProps) {
  if (entries.length < 2) return null

  if (variant === "mobile") {
    return (
      <details className="mb-8 rounded-md border border-border/70 bg-white/60 px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-primary inline-flex items-center gap-2">
          <ListTree className="size-4" />
          On this page
        </summary>
        <ol className="mt-3 space-y-1.5 text-sm list-decimal list-inside marker:font-mono marker:text-accent">
          {entries.map((e) => (
            <li key={e.id} className="text-muted-foreground">
              <a
                href={`#${e.id}`}
                className="text-muted-foreground hover:text-primary hover:underline transition-colors"
              >
                {e.text}
              </a>
            </li>
          ))}
        </ol>
      </details>
    )
  }

  if (variant === "desktop") {
    return (
      <aside
        aria-label="Table of contents"
        className="sticky top-24 self-start max-h-[calc(100vh-8rem)] overflow-y-auto pr-2"
      >
        <p className="djp-issue-no text-[10.5px] uppercase tracking-[0.22em] text-accent mb-5 inline-flex items-center gap-2">
          <span className="inline-block w-6 h-px bg-current" />
          Contents
        </p>
        <ol className="space-y-3 text-sm border-l border-border/70 pl-5">
          {entries.map((e, idx) => (
            <li key={e.id} className="relative">
              <span
                aria-hidden
                className="absolute -left-[1.55rem] top-0.5 djp-issue-no text-[10px] text-muted-foreground tabular-nums"
              >
                {String(idx + 1).padStart(2, "0")}
              </span>
              <a
                href={`#${e.id}`}
                className="text-muted-foreground hover:text-primary transition-colors block leading-snug"
              >
                {e.text}
              </a>
            </li>
          ))}
        </ol>
      </aside>
    )
  }

  // Legacy: render both with internal breakpoint hiding (kept so existing
  // callers that don't pass variant continue to work).
  return (
    <>
      <div className="lg:hidden">
        <TableOfContents entries={entries} variant="mobile" />
      </div>
      <div className="hidden lg:block">
        <TableOfContents entries={entries} variant="desktop" />
      </div>
    </>
  )
}
