/**
 * Arena section header — mono eyebrow with a hairline running out to the right
 * edge. A real h2 so screen-reader heading navigation reaches every section;
 * .djp-eyebrow overrides the base heading styles, so the visual is unchanged.
 */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <h2 className="djp-eyebrow shrink-0">{children}</h2>
      <div aria-hidden className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
    </div>
  )
}
