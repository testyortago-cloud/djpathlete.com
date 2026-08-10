// components/admin/funnels/builder/format.ts — prose for the builder UI.
//
// Pure string helpers, kept out of the components so both the chat receipt and
// the pre-publish review say the same thing about the same object, and so the
// wording is testable without rendering anything.
//
// These deliberately RE-IMPLEMENT `describeUnresolved` / `describeDanglingAnchor`
// from `lib/funnels/sections/resolve.ts` rather than importing them: that module
// pulls in four DAL files and the Supabase SDK, which cannot ship to the browser.
// The phrasing here is owner-facing anyway ("points at nothing"), where the
// lib's is log-facing.

import type { DanglingAnchor, DiffReceipt, UnresolvedCta } from "./types"

const KIND_LABEL: Record<UnresolvedCta["kind"], string> = {
  program: "program",
  session_pack: "session pack",
  event: "event",
}

export function ctaKindLabel(kind: UnresolvedCta["kind"]): string {
  return KIND_LABEL[kind] ?? kind
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * "Changed: Hero (headline size). Untouched: 8 sections."
 *
 * The untouched count is the half that matters. An owner cannot read a DOM
 * diff, so the only way they can tell an edit was surgical rather than a
 * silent rewrite of their whole page is to be told how much was left alone.
 */
export function formatReceipt(receipt: DiffReceipt): string {
  const changed = receipt.changed.map((entry) =>
    entry.reasons.length > 0 ? `${entry.label} (${entry.reasons.join(", ")})` : entry.label,
  )
  const parts: string[] = []
  parts.push(changed.length > 0 ? `Changed: ${changed.join(", ")}.` : "Changed: nothing.")
  parts.push(`Untouched: ${plural(receipt.unchangedCount, "section", "sections")}.`)
  if (receipt.themeChanged) parts.push("Page theme updated.")
  return parts.join(" ")
}

/** One unresolved CTA, in the owner's language. */
export function describeUnresolvedCta(cta: UnresolvedCta, sectionLabel: string): string {
  const what = `The ${ctaKindLabel(cta.kind)} button in ${sectionLabel} points at "${cta.ref}"`
  return cta.reason === "ambiguous"
    ? `${what}, and more than one ${ctaKindLabel(cta.kind)} has that name.`
    : `${what}, which is not a ${ctaKindLabel(cta.kind)} on this account.`
}

/** One dangling in-page anchor. A warning — never a blocker. */
export function describeDanglingAnchor(anchor: DanglingAnchor, sectionLabel: string): string {
  return `A link in ${sectionLabel} jumps to "#${anchor.target}", which is not a section on this page — it will scroll nowhere.`
}

/**
 * The chat message a candidate pick turns into.
 *
 * THE PICKER IS A SENTENCE, NOT A WRITE. Every write path to the document goes
 * through the build route, which takes prose and emits ops; there is no
 * property-edit endpoint in this stage (`funnel_step_turns.source` reserves
 * `'inspector'` for one, and nothing writes it yet). So picking a candidate
 * composes the instruction the owner would otherwise have had to type, and the
 * turn is logged, reversible and visible like every other.
 */
export function candidatePickMessage(cta: UnresolvedCta, candidateName: string): string {
  return (
    `In the section with id "${cta.sectionId}", change the call-to-action at "${cta.field}" so its ` +
    `target is {"kind":"${cta.kind}","ref":"${candidateName}"}. ` +
    `Change nothing else on the page.`
  )
}

/** The chat message the "Fix it for me" button sends after a 422 from publish. */
export function fixPublishProblemsMessage(problems: string[]): string {
  return (
    `Publishing this page was refused. The compiler reported:\n` +
    problems.map((problem) => `- ${problem}`).join("\n") +
    `\n\nFix these so the page can be published, and change nothing else.`
  )
}
