/** The reference's pull-quote coaching cue, with its provenance caption. */
export function CueBlock({ cue }: { cue: string }) {
  return (
    <blockquote className="rounded-xl border-l-2 border-primary bg-card p-5">
      <p className="font-body text-base italic leading-relaxed">{cue}</p>
      <p className="djp-eyebrow mt-3 text-muted-foreground">
        Generated from this athlete&apos;s own test scores — every score drives a specific instruction.
      </p>
    </blockquote>
  )
}
