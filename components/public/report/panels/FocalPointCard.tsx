import type { FocalPoint } from "@/lib/test-report/scoring"
import { cueFor } from "@/lib/test-report/cues"
import { num } from "@/lib/test-report/format"
import { BandPill } from "./BandPill"
import { ScoreTrack } from "./ScoreTrack"

/**
 * A category worth training, and the single test dragging it down.
 *
 * Naming the culprit is the whole point: "Strength 61" is not something an athlete
 * can act on, but "your bench is behind your squat" is.
 */
export function FocalPointCard({ fp }: { fp: FocalPoint }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-heading text-sm font-bold uppercase tracking-wide">{fp.category}</p>
        <BandPill band={fp.band} />
      </div>
      <p className="font-heading text-2xl font-bold leading-none">
        {fp.score}
        <span className="ml-0.5 text-sm font-normal text-muted-foreground">/100</span>
      </p>
      <ScoreTrack score={fp.score} />
      <p className="text-sm text-muted-foreground">
        Dragged by{" "}
        <strong className="font-semibold text-foreground">
          {fp.culprit.label} — {num(fp.culprit.latest)} {fp.culprit.unit}
        </strong>
        , the lowest score in this category.
      </p>
      <div className="border-t border-border pt-3">
        <p className="djp-eyebrow text-muted-foreground">What moves it</p>
        <p className="mt-1.5 text-sm leading-relaxed">{cueFor(fp)}</p>
      </div>
    </div>
  )
}
