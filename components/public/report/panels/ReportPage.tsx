/**
 * One printed page. `break-after: page` (see `.test-report` in globals.css) is what
 * makes Save-PDF produce the pages the browser shows.
 *
 * The page no longer owns a header — bands do. A band carries its own eyebrow, which
 * is why `panels/SectionHeading` was deleted.
 */
export function ReportPage({ children }: { children: React.ReactNode }) {
  return <section className="report-page relative flex min-h-screen flex-col">{children}</section>
}

/** One banded section. `tone` picks the ground; padding and rules come from CSS. */
export function ReportBand({
  tone = "plain",
  className = "",
  children,
}: {
  tone?: "plain" | "green" | "alt"
  className?: string
  children: React.ReactNode
}) {
  const toneClass = tone === "green" ? "report-band-green" : tone === "alt" ? "report-band-alt" : ""
  return <div className={`report-band ${toneClass} ${className}`.trim()}>{children}</div>
}
