// lib/funnels/sections/review/findings.ts — one shape, four producers, one
// consumer.
//
// A page comes out of the builder and four different reviewers look at it: a
// deterministic auditor that can decide things by inspection, and three
// critics that cannot. They all report in THIS shape, so the reviser reads one
// list and never has to care where a note came from.
//
// ---------------------------------------------------------------------------
// THIS FILE IS A LEAF. IT MAY IMPORT `zod` AND NOTHING ELSE.
// ---------------------------------------------------------------------------
// `build-stream.ts` carries a `finding` event, and `build-stream.ts` is
// imported by the builder UI — so this module follows it into the browser
// bundle. `builder-config.ts` documents what happens when a "leaf" quietly
// acquires the Anthropic SDK: it constructed a provider at module scope inside
// anything that imported it, made `reassemble()` un-importable in the browser,
// and forced a whole stage to route the owner's publish click through a server
// action instead. The header claiming client-safety while the import graph said
// otherwise was the worse half of that, because it stopped the next reader
// checking. findings.test.ts asserts the import list rather than trusting this
// comment.

import { z } from "zod"

export const SEVERITIES = ["high", "medium", "low"] as const
export type Severity = (typeof SEVERITIES)[number]

/** Lower sorts first. */
export const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

export const FINDING_SOURCES = ["audit", "art", "copy", "conversion"] as const
export type FindingSource = (typeof FINDING_SOURCES)[number]

/**
 * The deterministic auditor's closed code set.
 *
 * CRITICS ARE NOT LIMITED TO THESE, and that asymmetry is deliberate. A critic
 * constrained to a dozen pre-named problems can only ever find the dozen
 * problems somebody already thought of, which is precisely the work the
 * auditor does for free and precisely not the reason to spend a model call.
 * So `Finding.code` is a free string and only the auditor's own codes are
 * enumerated — the enum exists to keep `audit.ts` honest, not to fence the
 * critics in.
 */
export const AUDIT_CODES = [
  "tone-run",
  "pad-monotony",
  "align-thrash",
  "headline-scale",
  "markdown-leak",
  "proof-below-fold",
  "cta-divergence",
  "live-faq-on-campaign",
  "copy-echo",
  "headline-punctuation",
  "length-strain",
  "section-count",
] as const
export type AuditCode = (typeof AUDIT_CODES)[number]

export const findingSchema = z.object({
  /** Kebab-case slug for the KIND of problem, so two reports of it can dedupe. */
  code: z.string().min(1).max(60),
  severity: z.enum(SEVERITIES),
  /** The sections it concerns. Empty means the whole page. */
  sectionIds: z.array(z.string().max(40)).max(24),
  /** One sentence: what is wrong. */
  issue: z.string().min(1).max(400),
  /** One sentence: what to do instead. */
  suggestion: z.string().min(1).max(400),
  source: z.enum(FINDING_SOURCES),
})

export type Finding = z.infer<typeof findingSchema>

/**
 * What a critic returns.
 *
 * `source` is OMITTED here and stamped by the caller. A model asked to label
 * its own lens will occasionally label it as one of the other two, and dedupe
 * would then silently merge two independent observations into one — losing
 * exactly the cross-lens agreement that would have made the finding credible.
 */
export const criticFindingsSchema = z.object({
  findings: z.array(findingSchema.omit({ source: true })).max(12),
})

export type CriticFindings = z.infer<typeof criticFindingsSchema>

/**
 * Order-insensitive identity: what makes two findings the same finding.
 *
 * Sorted, because the auditor names a seam `[before, after]` in page order
 * while a critic may name the same two sections in either order, and two
 * reports of one problem must collapse to one.
 */
function key(finding: Finding): string {
  return `${finding.code}::${[...finding.sectionIds].sort().join(",")}`
}

/**
 * Flatten, dedupe, sort by severity, truncate.
 *
 * THE SORT HAS TO HAPPEN BEFORE THE SLICE. Truncation drops the least severe,
 * so a merge that truncated in arrival order would let three chatty
 * low-severity copy notes push a `cta-divergence` off the end of the list —
 * and the reviser would never see the one finding that actually costs money.
 *
 * Ties keep the first-seen finding, which puts the auditor's wording ahead of
 * a critic's for the same code: the auditor can name section ids exactly and a
 * critic is paraphrasing.
 */
export function mergeFindings(lists: Finding[][], max: number): Finding[] {
  const byKey = new Map<string, Finding>()
  for (const list of lists) {
    for (const finding of list) {
      const existing = byKey.get(key(finding))
      if (existing === undefined) {
        byKey.set(key(finding), finding)
        continue
      }
      if (SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[existing.severity]) {
        byKey.set(key(finding), finding)
      }
    }
  }
  return [...byKey.values()]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, max)
}
