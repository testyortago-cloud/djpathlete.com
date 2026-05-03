import { ListTree } from "lucide-react"

export interface TocEntry {
  id: string
  text: string
}

interface TableOfContentsProps {
  entries: TocEntry[]
}

/**
 * Renders an in-page table of contents from h2 anchor ids.
 * - On lg+: a sticky sidebar to the right of the article body.
 * - On mobile: a collapsed <details> block at the top of the article.
 *
 * Caller is responsible for only mounting this when entries.length >= 2.
 */
export function TableOfContents({ entries }: TableOfContentsProps) {
  if (entries.length < 2) return null

  return (
    <>
      {/* Mobile: collapsed details at top of article */}
      <details className="lg:hidden mb-6 rounded-lg border border-border bg-surface/40 px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-primary inline-flex items-center gap-2">
          <ListTree className="size-4" />
          On this page
        </summary>
        <ul className="mt-3 space-y-1.5 text-sm">
          {entries.map((e) => (
            <li key={e.id}>
              <a
                href={`#${e.id}`}
                className="text-muted-foreground hover:text-primary hover:underline transition-colors"
              >
                {e.text}
              </a>
            </li>
          ))}
        </ul>
      </details>

      {/* Desktop: sticky side rail */}
      <aside
        aria-label="Table of contents"
        className="hidden lg:block sticky top-24 self-start max-h-[calc(100vh-8rem)] overflow-y-auto"
      >
        <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-accent mb-3">
          ─ On this page
        </p>
        <ul className="space-y-2 text-sm">
          {entries.map((e) => (
            <li key={e.id}>
              <a
                href={`#${e.id}`}
                className="text-muted-foreground hover:text-primary transition-colors block leading-snug"
              >
                {e.text}
              </a>
            </li>
          ))}
        </ul>
      </aside>
    </>
  )
}
