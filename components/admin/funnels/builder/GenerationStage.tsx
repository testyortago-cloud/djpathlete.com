"use client"

// components/admin/funnels/builder/GenerationStage.tsx — the ~30 seconds of a
// build turn, made watchable.
//
// WHAT IT REPLACED, AND WHY THAT MATTERED. A spinner and the words "Working on
// it…", held for the whole model call. The owner's complaint was that it is
// boring, but the real cost is trust: a page builder that goes silent for half
// a minute gives you no way to tell "thinking" from "hung", and no reason to
// believe the thing it eventually hands back came from what you asked for.
//
// ---------------------------------------------------------------------------
// EVERY BLOCK ON THIS SCREEN IS SOMETHING THE MODEL ACTUALLY WROTE.
// ---------------------------------------------------------------------------
// This is the property to protect when changing this file. The wireframe grows
// one block per `section` event, and those events come out of the JSON the
// model is emitting, parsed mid-flight by `stream-progress.ts`. Nothing here is
// on a timer, nothing is interpolated, and no block appears before its section
// exists.
//
// It would be very easy to "improve" this by easing blocks in on a curve, or by
// pre-drawing the eight sections a landing page usually has and filling them
// in. Don't. The moment the display stops being a function of the stream it
// becomes a progress bar that lies — and it will lie visibly the first time a
// turn runs long or the model writes six sections instead of eight.
//
// The one honest approximation is the token meter, and it announces itself:
// `exact: false` renders with a `~`. See `BuildStreamEvent`.

import { Check, Loader2 } from "lucide-react"
import { BUILD_PHASES, BUILD_PHASE_LABELS, type BuildPhase, type Finding } from "@/lib/funnels/sections/build-stream"
import type { StreamedSection } from "@/lib/funnels/sections/stream-progress"
import type { SectionDoc } from "./types"

export interface GenerationStageProps {
  phase: BuildPhase
  sections: StreamedSection[]
  tokens: { count: number; exact: boolean } | null
  /**
   * The document as it stands. `update_section` ops name a section by id and
   * carry no `kind` — only the current document knows what kind that id is, so
   * the block can be drawn in the right shape instead of falling back to a
   * generic box.
   */
  doc: SectionDoc | null
  /** 2 while the model's first answer is being rewritten after a rejection. */
  attempt: number
  /**
   * What the reviewers have caught so far, in arrival order.
   *
   * The review adds 30-40 seconds AFTER the page is already on screen, so
   * without this the owner watches a spinner over a finished page for longer
   * than the build itself took. Naming each problem as it is found is what
   * makes that time legible.
   */
  findings: Finding[]
}

/** High reads as a real problem; the rest are shades of polish. */
const SEVERITY_DOT: Record<Finding["severity"], string> = {
  high: "bg-[var(--error)]",
  medium: "bg-[var(--warning)]",
  low: "bg-muted-foreground/40",
}

/**
 * The phases that belong to a build, and the ones that belong to a review.
 *
 * THE CHECKLIST HAS TO KNOW WHICH RUN IT IS DRAWING. A Polish press starts at
 * `reviewing`, so a single list would tick "Reading your brief", "Planning the
 * page" and "Writing sections" as complete for a run in which the builder was
 * never called — and an ordinary edit turn, which stops at `checking`, would
 * show two review steps that never complete and look stalled.
 *
 * Split from `BUILD_PHASES` rather than hardcoded, so a phase added there
 * without being placed here shows up as a missing step rather than silently
 * disappearing from the display.
 */
const REVIEW_PHASES: readonly BuildPhase[] = BUILD_PHASES.filter(
  (phase) => phase === "reviewing" || phase === "polishing",
)
const BUILD_ONLY_PHASES: readonly BuildPhase[] = BUILD_PHASES.filter((phase) => !REVIEW_PHASES.includes(phase))

export function GenerationStage({ phase, sections, tokens, doc, attempt, findings }: GenerationStageProps) {
  // A run that opened on a review phase is a Polish; anything else is a build
  // that may or may not go on to be reviewed.
  const isReviewOnly = REVIEW_PHASES.includes(phase) && sections.length === 0 && attempt === 1
  const track = isReviewOnly ? REVIEW_PHASES : BUILD_ONLY_PHASES
  const inTrack = track.indexOf(phase)
  // A build turn that has moved into the review phases: every build step is
  // done, so the last one stays ticked rather than the track resetting.
  const currentIndex = inTrack === -1 ? track.length : inTrack

  return (
    <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
      {/*
        POLITE, AND ONLY THE PHASE. An assertive region, or one that also
        announced each section, would interrupt a screen-reader user eight
        times in twenty seconds to narrate a decorative wireframe. The phase is
        the part that carries meaning; the blocks are `aria-hidden`.
      */}
      <p className="flex items-center gap-2 text-xs font-medium text-foreground" aria-live="polite">
        <Loader2 className="size-3.5 animate-spin text-accent motion-reduce:animate-none" aria-hidden />
        {BUILD_PHASE_LABELS[phase]}
        {attempt > 1 ? (
          <span className="rounded bg-[var(--warning)]/15 px-1.5 py-0.5 font-normal text-foreground">
            second attempt
          </span>
        ) : null}
      </p>

      <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-hidden>
        {track.map((candidate, index) => {
          const done = index < currentIndex
          const active = index === currentIndex
          return (
            <li
              key={candidate}
              className={`flex items-center gap-1 text-[0.65rem] uppercase tracking-wide ${
                active ? "text-accent" : done ? "text-muted-foreground" : "text-muted-foreground/50"
              }`}
            >
              {done ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}
              {BUILD_PHASE_LABELS[candidate]}
            </li>
          )
        })}
      </ol>

      {sections.length > 0 ? (
        <div className="mt-3 space-y-1.5 border-t border-border pt-3" aria-hidden>
          {sections.map((section) => (
            <WireframeBlock key={section.key} section={section} doc={doc} />
          ))}
        </div>
      ) : null}

      {findings.length > 0 ? (
        // Not `aria-hidden`, unlike the wireframe above: these are words with
        // meaning, and a screen-reader user waiting through the review has the
        // same right to know what it found. `aria-live` is deliberately absent
        // — the phase line above already announces, and a second live region
        // firing per finding would talk over it.
        <ul className="mt-3 space-y-1 border-t border-border pt-3">
          {findings.map((finding, index) => (
            <li key={`${finding.code}-${index}`} className="flex items-start gap-2 text-[0.7rem] text-muted-foreground">
              <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${SEVERITY_DOT[finding.severity]}`} aria-hidden />
              <span className="min-w-0">{finding.issue}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {tokens ? (
        <p className="mt-3 border-t border-border pt-2 font-mono text-[0.65rem] text-muted-foreground" aria-hidden>
          {/*
            The tilde is not decoration. While the stream is running this is a
            count of text-delta events, which tracks tokens closely on this
            provider but is not the provider's own number; the exact figure
            replaces it at `finish`. Showing an estimate as a measurement would
            undercut the one thing this whole display is for.
          */}
          {tokens.exact ? "" : "~"}
          {tokens.count.toLocaleString()} tokens
        </p>
      ) : null}
    </div>
  )
}

/**
 * The kind a block should be drawn as.
 *
 * `set_page` and `add_section` carry their own `kind`. `update_section` carries
 * only an `id`, so the kind is looked up in the document being edited — that
 * lookup is the entire reason `doc` is a prop.
 */
function resolveKind(section: StreamedSection, doc: SectionDoc | null): string | null {
  if (section.kind) return section.kind
  if (!section.id || !doc) return null
  return doc.sections.find((candidate) => candidate.id === section.id)?.kind ?? null
}

function WireframeBlock({ section, doc }: { section: StreamedSection; doc: SectionDoc | null }) {
  const kind = resolveKind(section, doc)

  return (
    <div className="rounded-lg border border-border bg-surface/40 p-2 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
          {kind ?? section.id ?? "section"}
        </span>
        {section.op === "update_section" ? <span className="text-[0.6rem] text-muted-foreground">editing</span> : null}
      </div>

      <div className="mt-1.5">
        <Skeleton kind={kind} />
      </div>

      {section.headline ? (
        <p className="mt-1.5 truncate text-[0.7rem] text-foreground" title={section.headline}>
          {section.headline}
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The shapes.
//
// Crude on purpose — a wireframe, not a preview. The real preview arrives with
// the `result` event and is rendered by `PreviewPane` from the compiled
// document; anything more faithful here would be a second, worse renderer that
// has to be kept in step with `render.ts` forever.
// ---------------------------------------------------------------------------

function Bar({ className = "" }: { className?: string }) {
  return <div className={`h-1.5 rounded-full bg-muted-foreground/25 ${className}`} />
}

function Pill() {
  return <div className="h-3 w-16 rounded-full bg-accent/40" />
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-1.5">{children}</div>
}

function Cell() {
  return (
    <div className="flex-1 space-y-1 rounded border border-border/60 bg-white/60 p-1.5">
      <Bar className="w-2/3" />
      <Bar className="w-full" />
    </div>
  )
}

function Skeleton({ kind }: { kind: string | null }) {
  switch (kind) {
    case "hero":
      return (
        <div className="space-y-1.5">
          <Bar className="h-2.5 w-4/5" />
          <Bar className="w-3/5" />
          <div className="pt-1">
            <Pill />
          </div>
        </div>
      )
    case "bullets":
    case "proof":
      return (
        <Row>
          <Cell />
          <Cell />
          <Cell />
        </Row>
      )
    case "steps":
      return (
        <div className="space-y-1.5">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center gap-1.5">
              <div className="size-3 shrink-0 rounded-full bg-accent/30" />
              <Bar className="w-full" />
            </div>
          ))}
        </div>
      )
    case "testimonial":
      return (
        <Row>
          <Cell />
          <Cell />
        </Row>
      )
    case "pricing":
      return (
        <Row>
          <Cell />
          <Cell />
          <Cell />
        </Row>
      )
    case "faq":
      return (
        <div className="space-y-1.5">
          <Bar className="w-5/6" />
          <Bar className="w-2/3" />
          <Bar className="w-3/4" />
        </div>
      )
    case "form":
      return (
        <div className="space-y-1.5">
          {[0, 1].map((index) => (
            <div key={index} className="space-y-1">
              <Bar className="w-1/4" />
              <div className="h-3 rounded border border-border/60 bg-white/70" />
            </div>
          ))}
          <div className="pt-0.5">
            <Pill />
          </div>
        </div>
      )
    case "cta":
      return (
        <div className="flex flex-col items-center space-y-1.5">
          <Bar className="h-2 w-2/3" />
          <Pill />
        </div>
      )
    case "footer":
      return (
        <div className="space-y-1">
          <Bar className="w-1/3" />
          <Bar className="w-1/4" />
        </div>
      )
    default:
      // A kind that has not arrived yet, or one this file has never heard of —
      // a new registry entry shipped without a shape here. Both draw as a plain
      // block rather than as nothing, so a section is never invisible just
      // because its skeleton is missing.
      return (
        <div className="space-y-1.5">
          <Bar className="w-3/4" />
          <Bar className="w-1/2" />
        </div>
      )
  }
}
