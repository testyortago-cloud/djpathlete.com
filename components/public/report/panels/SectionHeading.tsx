/**
 * Mono eyebrow with a hairline out to the right edge. A real h3 so heading
 * navigation reaches every section (the page title is the h2). Deliberately a
 * copy of the Arena card's heading rather than an import — the public report
 * must not depend on the admin-only Arena tree.
 */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <h3 className="djp-eyebrow shrink-0">{children}</h3>
      <div aria-hidden className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
    </div>
  )
}
