import { BAND_LABELS, type Band } from "@/lib/test-report/scoring"

const TONE: Record<Band, string> = {
  strength: "bg-[var(--success)]/15 text-[var(--success)]",
  developing: "bg-primary/15 text-primary",
  priority: "bg-[var(--error)]/15 text-[var(--error)]",
}

/** STRENGTH / DEVELOPING / PRIORITY status pill from the reference report. */
export function BandPill({ band }: { band: Band }) {
  return (
    <span className={`band-pill inline-flex rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${TONE[band]}`}>
      {BAND_LABELS[band]}
    </span>
  )
}
