/**
 * One page of the report. `break-after: page` (see the `.test-report` rules in
 * globals.css) is what makes Save-PDF produce the same pages the browser shows —
 * the whole point of the paged treatment.
 */
export function ReportPage({
  eyebrow,
  title,
  pageNumber,
  footer,
  children,
}: {
  eyebrow: string
  title?: string
  pageNumber?: string
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="report-page relative flex min-h-screen flex-col gap-6 px-6 py-10 md:px-12 md:py-14">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="djp-eyebrow text-primary">{eyebrow}</p>
          {title && <h2 className="mt-2 font-heading text-3xl font-bold md:text-4xl">{title}</h2>}
        </div>
        {pageNumber && <span className="font-mono text-xs text-muted-foreground">{pageNumber}</span>}
      </header>
      <div className="flex-1">{children}</div>
      {footer && <footer className="border-t border-border pt-4 text-xs text-muted-foreground">{footer}</footer>}
    </section>
  )
}
