"use client"

// components/admin/funnels/builder/PublishReview.tsx — the gate before the write.
//
// ---------------------------------------------------------------------------
// PUBLISH IS A REVIEW STEP, NOT A SUBMIT.
// ---------------------------------------------------------------------------
// The old editor published first and told the owner afterwards: FunnelEditor.tsx:182
// fires `toast.warning(...)` on the SUCCESS path, so "your video embed was
// removed" fades away over a page that is already live. Everything the
// compiler is going to change, every button that points nowhere, and the
// mobile rendering all belong on THIS side of the write.
//
// The framing line at the top is deliberate and is aimed at the one thing an
// owner reliably gets wrong at this gate: they try to audit the markup. They
// cannot, and they do not need to — the compiler's allowlist is the security
// boundary and it is not negotiable. What no compiler can check is whether the
// claims are true and whether the page reads on a phone. So the review says so.
//
// ---------------------------------------------------------------------------
// BLOCKERS COME FROM `unresolved`. WARNINGS COME FROM EVERYTHING ELSE.
// ---------------------------------------------------------------------------
// An unresolved CTA renders as a disabled placeholder (or, for session packs,
// as a LIVE checkout to the wrong place) and compiles to `ok: true,
// warnings: []` — the compiler has no signal to give about it at all. So the
// publish button's disabled state is derived from `unresolved`, never from
// `compile.ok`. Dangling anchors sit on the other side of that line by an
// explicit ruling: a dead in-page link is degraded, not lead-losing, and must
// never hold a campaign page hostage.

import { AlertTriangle, ArrowLeft, Link2Off, Loader2, Rocket, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { MESSAGING_DOCK_CLEARANCE_CLASS } from "@/components/messaging/dock-geometry"
import { PreviewPane } from "./PreviewPane"
import { ctaKindLabel, describeDanglingAnchor, describeUnresolvedCta } from "./format"
import type { DanglingAnchor, SectionDoc, UnresolvedCta } from "./types"

interface PublishReviewProps {
  className?: string
  stepId: string
  previewRevision: number
  doc: SectionDoc | null
  /** Blockers that are not unresolved CTAs: compile problems, a conflict, … */
  blockers: string[]
  unresolved: UnresolvedCta[]
  danglingAnchors: DanglingAnchor[]
  compileWarnings: string[]
  /** "CTA links were not checked this turn: …". A warning, not a blocker. */
  resolutionError: string | null
  /**
   * The funnel is not `published`, so the public route will 404 this page even
   * after a successful publish. A warning, never a blocker: the version row is
   * real and staging a page before flipping the funnel live is legitimate.
   */
  funnelIsDraft: boolean
  /** "landing page" or "funnel" — the owner's word for the thing, not ours. */
  noun: string
  /**
   * What the "Publish now" below will actually take live.
   *
   * The findings above are always about the page on screen; on a funnel the
   * button beside them publishes every page. Saying "Nothing is blocking this
   * page" over a control that publishes five is the kind of near-miss wording
   * this screen exists to remove — so the heading names the scope the BUTTON
   * has, and the copy underneath still describes what was checked.
   */
  publishScope?: "page" | "funnel"
  /** Where the funnel's status control lives, for the draft warning. */
  funnelHref: string
  /** The public URL this page WOULD have, named in the draft warning. */
  publicUrl: string
  canPublish: boolean
  /**
   * The live page already IS this document, so `canPublish` is false with
   * nothing wrong.
   *
   * It has to be said HERE and not only in the header, because this screen's
   * whole contract is that a disabled publish button has a reason printed
   * above it. Without it the review reads "Nothing is blocking this page" over
   * a dead button — a silent gate, which reads as broken.
   */
  upToDate?: boolean
  /** Which version is live. Only used to name it in the up-to-date line. */
  publishedVersion?: number | null
  publishing: boolean
  onPublish: () => void
  onCancel: () => void
  onPickCandidate: (cta: UnresolvedCta, candidateName: string) => void
}

function sectionLabel(doc: SectionDoc | null, sectionId: string): string {
  const section = doc?.sections.find((candidate) => candidate.id === sectionId)
  return section ? `the ${section.kind} section` : `section "${sectionId}"`
}

export function PublishReview({
  className,
  stepId,
  previewRevision,
  doc,
  blockers,
  unresolved,
  danglingAnchors,
  compileWarnings,
  resolutionError,
  funnelIsDraft,
  noun,
  publishScope = "page",
  funnelHref,
  publicUrl,
  canPublish,
  upToDate = false,
  publishedVersion = null,
  publishing,
  onPublish,
  onCancel,
  onPickCandidate,
}: PublishReviewProps) {
  const warningCount =
    compileWarnings.length + danglingAnchors.length + (resolutionError ? 1 : 0)

  return (
    <div className={`flex min-h-0 flex-col ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border bg-white px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-heading text-sm text-primary">Review before publishing</h2>
          <p className="truncate text-xs text-muted-foreground">
            The compiler has security covered and does not need you. Your job here is claims and mobile.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={publishing}>
          <ArrowLeft className="size-4" aria-hidden />
          Back to editing
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {blockers.length > 0 || unresolved.length > 0 ? (
          <section className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <h3 className="flex items-center gap-2 font-heading text-sm text-[var(--error)]">
              <AlertTriangle className="size-4" aria-hidden />
              {blockers.length + unresolved.length === 1
                ? "1 thing is blocking publishing"
                : `${blockers.length + unresolved.length} things are blocking publishing`}
            </h3>

            {blockers.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground">
                {blockers.map((blocker, index) => (
                  <li key={index}>{blocker}</li>
                ))}
              </ul>
            ) : null}

            {unresolved.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {unresolved.map((cta) => (
                  <li key={`${cta.sectionId}:${cta.field}:${cta.ref}`}>
                    <UnresolvedRow
                      cta={cta}
                      label={sectionLabel(doc, cta.sectionId)}
                      disabled={publishing}
                      onPick={(name) => onPickCandidate(cta, name)}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : (
          <section className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <h3 className="flex items-center gap-2 font-heading text-sm text-[var(--success)]">
              <ShieldCheck className="size-4" aria-hidden />
              {upToDate
                ? publishScope === "funnel"
                  ? "This funnel is already live"
                  : "This page is already live"
                : publishScope === "funnel"
                  ? "Nothing is blocking this funnel"
                  : "Nothing is blocking this page"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {upToDate
                ? `The live page is serving ${publishedVersion === null ? "this exact page" : `version ${publishedVersion}`}, and nothing has changed since. Publishing comes back as soon as you change something.`
                : publishScope === "funnel"
                  ? "Every button on this page points at something real. Read the claims, check the phone view below, then publish — Publish now takes the whole funnel live, and every other page is checked again as it goes."
                  : "Every button points at something real. Read the claims, check the phone view below, then publish."}
            </p>
          </section>
        )}

        {/* Publishing a PAGE does not take the FUNNEL live. Said here, before
            the write — the owner published into a draft funnel on production,
            got "Published version 1", and found a 404 at the public URL with
            nothing anywhere explaining the gap. */}
        {funnelIsDraft ? (
          <section className="rounded-xl border border-[var(--warning)] bg-white p-4 shadow-sm">
            <h3 className="flex items-center gap-2 font-heading text-sm text-[var(--warning)]">
              <AlertTriangle className="size-4" aria-hidden />
              This {noun} isn&apos;t live yet
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Publishing saves this page, but it still won&apos;t be reachable at{" "}
              <span className="font-mono">{publicUrl}</span> — the {noun} itself is a draft, and
              the public route only serves published ones.{" "}
              <Link href={funnelHref} className="text-primary underline underline-offset-2">
                Set it to Published
              </Link>{" "}
              to make this page visible.
            </p>
          </section>
        ) : null}

        {warningCount > 0 ? (
          <section className="mt-3 rounded-xl border border-border bg-white p-4 shadow-sm">
            <h3 className="font-heading text-sm text-foreground">
              {warningCount === 1 ? "1 thing to know" : `${warningCount} things to know`}
            </h3>
            <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
              {compileWarnings.map((warning, index) => (
                <li key={`w${index}`} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]" aria-hidden />
                  <span>{warning}</span>
                </li>
              ))}
              {danglingAnchors.map((anchor, index) => (
                <li key={`a${index}`} className="flex items-start gap-2">
                  <Link2Off className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{describeDanglingAnchor(anchor, sectionLabel(doc, anchor.sectionId))}</span>
                </li>
              ))}
              {resolutionError ? (
                <li className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]" aria-hidden />
                  <span>{resolutionError}</span>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}

        <section className="mt-3 rounded-xl border border-border bg-white p-4 shadow-sm">
          <h3 className="font-heading text-sm text-foreground">On a phone</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            390px wide, at full size — the same breakpoints a visitor's phone fires.
          </p>
          <div className="mt-3 h-[560px] overflow-hidden rounded-xl border border-border bg-surface/50">
            <PreviewPane
              stepId={stepId}
              device="mobile"
              revision={previewRevision}
              title="Phone preview of this page"
              className="h-full w-full"
            />
          </div>
        </section>
      </div>

      {/* CLEARANCE, NOT DECORATION. This row is pinned to the bottom of a
          100dvh app shell, and the global Messages dock is `fixed` in that same
          corner — measured in a browser, the dock covered "Publish now"
          completely and `elementFromPoint` at the button's centre returned the
          dock. jsdom cannot see that (no layout engine), so the geometry is a
          value both sides read: see components/messaging/dock-geometry.ts. */}
      <div
        className={`flex items-center justify-end gap-2 border-t border-border bg-white px-4 pt-3 ${MESSAGING_DOCK_CLEARANCE_CLASS}`}
      >
        <Button variant="outline" size="sm" onClick={onCancel} disabled={publishing}>
          Cancel
        </Button>
        <Button size="sm" onClick={onPublish} disabled={!canPublish || publishing}>
          {publishing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Rocket className="size-4" aria-hidden />
          )}
          {publishing ? "Publishing…" : "Publish now"}
        </Button>
      </div>
    </div>
  )
}

/**
 * One unresolved CTA and the real rows it could point at instead.
 *
 * The candidates are ALWAYS real rows — `resolve.ts` fills them from the OFFER
 * catalogue (the rows a new commitment may be made to), so the picker can
 * never offer something that would fail again. There is no free-text field
 * here for exactly that reason.
 */
function UnresolvedRow({
  cta,
  label,
  disabled,
  onPick,
}: {
  cta: UnresolvedCta
  label: string
  disabled: boolean
  onPick: (candidateName: string) => void
}) {
  const [choice, setChoice] = useState("")

  return (
    <div className="rounded-lg border border-border bg-surface/40 p-3">
      <p className="text-sm text-foreground">{describeUnresolvedCta(cta, label)}</p>
      {cta.candidates.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          There is no {ctaKindLabel(cta.kind)} to point it at yet. Create one first, or ask the builder to
          use a different kind of button.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`pick-${cta.sectionId}-${cta.field}`}>
            Choose the {ctaKindLabel(cta.kind)} for {label}
          </label>
          <select
            id={`pick-${cta.sectionId}-${cta.field}`}
            value={choice}
            disabled={disabled}
            onChange={(event) => setChoice(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1.5 text-sm"
          >
            <option value="">Choose a {ctaKindLabel(cta.kind)}…</option>
            {cta.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.name}>
                {candidate.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={disabled || choice === ""} onClick={() => onPick(choice)}>
            Use this
          </Button>
        </div>
      )}
    </div>
  )
}
