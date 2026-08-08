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
 *
 * `isAlsoHero` says this card's culprit is ALSO page 1's biggest mover. Hero
 * selection and culprit selection are independent, so one test can win both — and
 * it is the LIKELY case, not an edge case, because the weakest area is what the
 * coach has been training. Left alone that reads as a bug: the same test named as
 * a triumph and as a shortfall two bands apart. The collision is genuinely
 * informative though ("your biggest gain is still your weakest area"), so the copy
 * OWNS it rather than the component hiding one of the two facts.
 *
 * The direction comes from the culprit's own `deltaPct` rather than a second prop:
 * when the two collide, culprit IS the mover, and `BiggestMover.direction` is
 * derived from exactly this sign. "Your biggest gain" would be a lie on a report
 * where nothing improved, which is the fallback the mover falls back to.
 */
export function FocalPointCard({ fp, isAlsoHero = false }: { fp: FocalPoint; isAlsoHero?: boolean }) {
  const tail = !isAlsoHero
    ? ", the lowest score in this category."
    : (fp.culprit.deltaPct ?? 0) > 0
      ? ", the lowest score here despite being your biggest gain."
      : ", the lowest score here — and the change called out above."

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-sm font-bold uppercase tracking-wide">{fp.category}</h3>
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
        {tail}
      </p>
      <div className="border-t border-border pt-3">
        <p className="djp-eyebrow text-muted-foreground">What moves it</p>
        <p className="mt-1.5 text-sm leading-relaxed">{cueFor(fp)}</p>
      </div>
    </div>
  )
}
