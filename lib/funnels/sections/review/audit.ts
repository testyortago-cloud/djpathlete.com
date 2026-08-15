// lib/funnels/sections/review/audit.ts — the deterministic half of review.
//
// No model, no IO, no randomness: `auditDoc` is a pure function of the
// document. That is not tidiness. Every finding in here is a property of the
// page that can be settled by looking at it, and a model asked "do sections 2
// and 3 share a tone" will occasionally say no — which, for a missing finding,
// is indistinguishable from a clean page.
//
// ---------------------------------------------------------------------------
// ALL THREE OF THE OWNER'S COMPLAINTS ARE IN THIS FILE.
// ---------------------------------------------------------------------------
// "The spacing looks off"   -> `tone-run`. Two adjacent sections at the same
//                              tone paint as ONE band with both sections'
//                              padding stacked into a single void, because
//                              styles.ts had no rule between sections at all.
// "Boring"                  -> `pad-monotony`. The real page used pad "normal"
//                              for five sections running.
// "Formatting issues"       -> `align-thrash` and `markdown-leak`.
//
// The critics exist for the half that genuinely needs judgement. They are not
// asked about any of the above, because asking a model to count is how you get
// a page that is fine four times out of five.

import { z } from "zod"
import { effectiveTone } from "@/lib/funnels/sections/doc"
import { SECTION_REGISTRY, type Section, type SectionDoc, type SectionKind } from "@/lib/funnels/sections/registry"
import type { AuditCode, Finding } from "@/lib/funnels/sections/review/findings"

function finding(
  code: AuditCode,
  severity: Finding["severity"],
  sectionIds: string[],
  issue: string,
  suggestion: string,
): Finding {
  return { code, severity, sectionIds, issue, suggestion, source: "audit" }
}

// ---------------------------------------------------------------------------
// Copy extraction
//
// PROSE ONLY, AND CTA LABELS ARE DELIBERATELY EXCLUDED.
//
// The real production page uses "Book your consultation" as both the hero
// button and the closing CTA button, and that repetition is REQUIRED by the
// one-offer-one-action rule the prompt already states. A naive
// same-string-twice check flags the page for obeying its own instructions —
// so `walk` refuses to descend into any key that holds an action rather than
// a sentence.
// ---------------------------------------------------------------------------

/** Keys whose string values are prose a human reads as a sentence. */
const PROSE_KEYS = new Set([
  "headline",
  "sub",
  "heading",
  "intro",
  "body",
  "blurb",
  "eyebrow",
  "legal",
  "footnote",
  "quote",
  "q",
  "a",
  "title",
])

/** Keys holding a CTA or a link — an ACTION, never prose. Never descended into. */
const ACTION_KEYS = new Set(["cta", "primaryCta", "secondaryCta", "links"])

interface ProseEntry {
  /** The prop key that held it, e.g. `headline`. Array indices are stripped. */
  key: string
  text: string
}

function proseOf(section: Section): ProseEntry[] {
  const out: ProseEntry[] = []

  function walk(value: unknown, key: string | null): void {
    if (typeof value === "string") {
      if (key !== null && PROSE_KEYS.has(key)) out.push({ key, text: value })
      return
    }
    if (Array.isArray(value)) {
      // An array element inherits nothing: its own object keys name it.
      for (const item of value) walk(item, null)
      return
    }
    if (value === null || typeof value !== "object") return
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      if (ACTION_KEYS.has(childKey)) continue
      walk(child, childKey)
    }
  }

  walk(section.props, null)
  return out
}

/** The fields a trailing full stop reads wrong on. */
const HEADLINE_KEYS = ["headline", "heading", "eyebrow"] as const

function headlinesOf(section: Section): string[] {
  const props = section.props as Record<string, unknown>
  return HEADLINE_KEYS.map((key) => props[key]).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  )
}

// ---------------------------------------------------------------------------
// Copy-length caps, DERIVED from the registry schemas.
//
// The same move `prompt.ts` makes for `UUID_FIELD_PATHS`: a hand-typed table
// of maximums is a second copy of the schema, and it goes stale the day a
// bound changes with nothing going red. Memoised per kind because
// `z.toJSONSchema` is not cheap and `auditDoc` runs it once per section.
// ---------------------------------------------------------------------------

interface JsonNode {
  type?: string
  properties?: Record<string, JsonNode>
  items?: JsonNode
  maxLength?: number
  anyOf?: JsonNode[]
  oneOf?: JsonNode[]
  allOf?: JsonNode[]
}

const CAPS_BY_KIND = new Map<SectionKind, Map<string, number>>()

function collectMaxLengths(node: JsonNode, key: string, out: Map<string, number>): void {
  if (node.maxLength !== undefined && key !== "") {
    // The LARGEST bound wins where a key appears in two union branches: a
    // finding that fires because the other branch is tighter would be wrong.
    const existing = out.get(key)
    if (existing === undefined || node.maxLength > existing) out.set(key, node.maxLength)
  }
  for (const [childKey, child] of Object.entries(node.properties ?? {})) collectMaxLengths(child, childKey, out)
  if (node.items) collectMaxLengths(node.items, key, out)
  for (const member of [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])]) {
    collectMaxLengths(member, key, out)
  }
}

function capsFor(kind: SectionKind): Map<string, number> {
  const cached = CAPS_BY_KIND.get(kind)
  if (cached) return cached
  const out = new Map<string, number>()
  // `unrepresentable: "any"` for the same reason prompt.ts passes it: the
  // default is "throw", and this runs inside a request.
  const schema = z.toJSONSchema(SECTION_REGISTRY[kind].propsSchema, {
    io: "input",
    unrepresentable: "any",
  }) as JsonNode
  collectMaxLengths(schema, "", out)
  CAPS_BY_KIND.set(kind, out)
  return out
}

// ---------------------------------------------------------------------------
// CTA targets
// ---------------------------------------------------------------------------

/**
 * A stable identity for a CTA target, for counting DISTINCT ACTIONS.
 *
 * An `anchor` returns the empty string and is skipped: pointing at a section
 * of the same page is navigation within one offer, not a second offer. Without
 * that exemption, the correct pattern of a hero button that jumps to the form
 * would be reported as divergence on every well-built page.
 */
function targetKey(target: Record<string, unknown>): string {
  const kind = String(target.kind)
  switch (kind) {
    case "url":
      return `url:${String(target.href)}`
    case "step":
      return `step:${String(target.stepSlug)}`
    case "anchor":
      return ""
    case "booking":
      return "booking"
    default:
      return `${kind}:${String(target.ref ?? "")}`
  }
}

/**
 * Every CTA target in a section that counts as an OFFER.
 *
 * Recognised by SHAPE — an object carrying both `label` and an object
 * `target` — rather than by a list of known key names. `ctaWithLabelSchema` is
 * reused at hero, pricing plan, cta and footer link sites, and a hardcoded key
 * list would silently miss the day an eleventh kind adds a fifth.
 *
 * ---------------------------------------------------------------------------
 * FOOTER `links` ARE SKIPPED, AND NOT AS A CONVENIENCE.
 * ---------------------------------------------------------------------------
 * `LEADGEN_RULES` says, in the same breath as the one-offer-one-action rule:
 * "If the owner asks for a second action, put it in the footer as a link, not
 * as a competing button." The footer link row is therefore the SANCTIONED
 * place for a second destination — counting it as divergence would raise a
 * high-severity finding on every page carrying a Privacy or Terms link, and
 * send the reviser off to point them all at the checkout.
 *
 * The production fixture has `links: []`, so nothing in this suite would have
 * caught it. `footer.links` is the only `links` field in the whole registry.
 */
function ctaTargetsOf(section: Section): string[] {
  const out: string[] = []

  function walk(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (value === null || typeof value !== "object") return
    const record = value as Record<string, unknown>
    const target = record.target
    if (typeof record.label === "string" && target !== null && typeof target === "object") {
      const key = targetKey(target as Record<string, unknown>)
      if (key !== "") out.push(key)
      return
    }
    for (const [childKey, child] of Object.entries(record)) {
      if (childKey === "links") continue
      walk(child)
    }
  }

  walk(section.props)
  return out
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const MARKDOWN_PATTERNS: ReadonlyArray<{ pattern: RegExp; what: string }> = [
  { pattern: /\*\*/, what: "bold markers (**)" },
  { pattern: /(?:^|\s)__\S/, what: "underscore emphasis (__)" },
  { pattern: /`/, what: "a backtick" },
  { pattern: /^\s*#{1,6}\s/, what: "a markdown heading (#)" },
  { pattern: /^\s*[-*]\s+\S/, what: "a markdown list dash" },
  { pattern: /^\s*\d+\.\s+\S/, what: "a markdown numbered list" },
]

const HEADLINE_RANK: Record<string, number> = { sm: 0, md: 1, lg: 2, xl: 3 }

/** Below this, a repeated line is a coincidence ("Free", "Book now"). */
const ECHO_MIN_LENGTH = 20

/** A copy field this close to its cap will read as a wall and cannot be edited. */
const LENGTH_STRAIN_RATIO = 0.95

/** Alignment changes at or above this read as inconsistency, not as pacing. */
const ALIGN_CHANGE_LIMIT = 3

/** Sections at one pad value, at or above this, read as one undifferentiated run. */
const PAD_RUN_LIMIT = 4

const SECTION_COUNT_MIN = 6
const SECTION_COUNT_MAX = 9

/**
 * Everything wrong with a page that can be decided by inspection.
 *
 * Pure and total: it never throws, never reads IO, and returns the same list
 * for the same document. The pipeline runs it twice — once to brief the
 * critics and once, after revision, as the gate — and both readings have to be
 * comparable for the second to mean anything.
 */
export function auditDoc(doc: SectionDoc): Finding[] {
  const findings: Finding[] = []
  const sections = doc.sections
  const tones = sections.map((section) => effectiveTone(section, doc.theme))

  // --- tone-run: "the spacing looks off" ---------------------------------
  //
  // Reported per SEAM rather than per run, so a three-section run names both
  // seams and the reviser can retone the middle one to fix both at once.
  for (let index = 1; index < sections.length; index += 1) {
    if (tones[index] !== tones[index - 1]) continue
    const before = sections[index - 1]
    const after = sections[index]
    findings.push(
      finding(
        "tone-run",
        "high",
        [before.id, after.id],
        `"${before.id}" and "${after.id}" both render at the ${tones[index]} tone, so they paint as one continuous band with both sections' padding stacked into a single gap and no visible boundary between them.`,
        `Give one of them a different style.tone so the page has a seam there — muted beside default, or accent to mark a turn in the argument.`,
      ),
    )
  }

  // --- pad-monotony: "boring" --------------------------------------------
  //
  // Compared on the RESOLVED value, not the raw one. `render.ts` emits
  // `data-pad="normal"` for a section that set no pad, so a page mixing
  // `undefined` and `"normal"` renders as one flat run of identical bands — and
  // a raw comparison would call that variety and report nothing. The three
  // sibling rules (`tone-run` via `effectiveTone`, `align-thrash`,
  // `headline-scale`) all resolve their defaults; this one was the odd one out.
  const pads = sections.map((section) => section.style.pad ?? "normal")
  let runStart = 0
  for (let index = 1; index <= sections.length; index += 1) {
    const continues = index < sections.length && pads[index] === pads[runStart]
    if (continues) continue
    const length = index - runStart
    if (length >= PAD_RUN_LIMIT) {
      const value = pads[runStart]
      findings.push(
        finding(
          "pad-monotony",
          "medium",
          sections.slice(runStart, index).map((section) => section.id),
          `${length} sections in a row use pad "${value}", so the middle of the page has no rhythm — every band is the same height and there is nothing for the eye to catch on.`,
          `Vary style.pad: roomy for the sections carrying the argument, tight for the connective ones. Padding is how a page paces itself.`,
        ),
      )
    }
    runStart = index
  }

  // --- align-thrash: "formatting issues" ---------------------------------
  const aligns = sections.map((section) => section.style.align ?? "left")
  const changes = aligns.reduce(
    (count, align, index) => (index > 0 && align !== aligns[index - 1] ? count + 1 : count),
    0,
  )
  if (changes >= ALIGN_CHANGE_LIMIT) {
    findings.push(
      finding(
        "align-thrash",
        "medium",
        [],
        `Text alignment changes ${changes} times down the page. Each flip is defensible on its own; together they read as inconsistency rather than as intent.`,
        `Pick one alignment as the page's default and depart from it only to mark something. A centred hero and a centred closing CTA around a left-aligned body is a pattern; alternating is not.`,
      ),
    )
  }

  // --- headline-scale ----------------------------------------------------
  const heroIndex = sections.findIndex((section) => section.kind === "hero")
  if (heroIndex !== -1) {
    const heroRank = HEADLINE_RANK[sections[heroIndex].style.headline ?? "md"]
    const bigger = sections.filter(
      (section, index) => index !== heroIndex && HEADLINE_RANK[section.style.headline ?? "md"] > heroRank,
    )
    if (bigger.length > 0) {
      findings.push(
        finding(
          "headline-scale",
          "medium",
          [sections[heroIndex].id, ...bigger.map((section) => section.id)],
          `The hero's headline is not the largest on the page — ${bigger.map((section) => `"${section.id}"`).join(", ")} outrank it.`,
          `Raise the hero's style.headline above every other section's, or lower theirs. The first screen has to win.`,
        ),
      )
    }
  }

  // --- markdown-leak, headline-punctuation, length-strain ----------------
  for (const section of sections) {
    const caps = capsFor(section.kind)

    for (const { key, text } of proseOf(section)) {
      for (const { pattern, what } of MARKDOWN_PATTERNS) {
        if (!pattern.test(text)) continue
        findings.push(
          finding(
            "markdown-leak",
            "high",
            [section.id],
            `"${section.id}" has ${what} in its copy ("${text.slice(0, 60)}"). The renderer escapes text, so this reaches a live page as literal characters.`,
            `Write plain prose. Emphasis is the stylesheet's job and a list is the bullets or steps section kind.`,
          ),
        )
        break
      }

      const cap = caps.get(key)
      if (cap !== undefined && text.length > cap * LENGTH_STRAIN_RATIO) {
        findings.push(
          finding(
            "length-strain",
            "low",
            [section.id],
            `"${section.id}" fills ${text.length} of the ${cap} characters allowed for ${key}, so it reads as a wall of text and any edit will overflow the bound.`,
            `Cut it to roughly two thirds of the limit. The bound is a ceiling, not a target.`,
          ),
        )
      }
    }

    for (const headline of headlinesOf(section)) {
      if (!headline.trim().endsWith(".")) continue
      findings.push(
        finding(
          "headline-punctuation",
          "low",
          [section.id],
          `"${section.id}" ends a headline with a full stop ("${headline.slice(0, 60)}"). Headlines are labels, not sentences.`,
          `Drop the trailing period. Keep question marks — those are doing work.`,
        ),
      )
    }
  }

  // --- copy-echo ---------------------------------------------------------
  const firstSeenIn = new Map<string, string>()
  for (const section of sections) {
    for (const { text } of proseOf(section)) {
      const normalised = text.trim().toLowerCase().replace(/\s+/g, " ")
      if (normalised.length < ECHO_MIN_LENGTH) continue
      const first = firstSeenIn.get(normalised)
      if (first === undefined) {
        firstSeenIn.set(normalised, section.id)
        continue
      }
      // Within ONE section a repeat is usually a deliberate parallel
      // construction across list items; across two it is a reader being told
      // the same thing twice.
      if (first === section.id) continue
      findings.push(
        finding(
          "copy-echo",
          "medium",
          [first, section.id],
          `"${first}" and "${section.id}" say the same thing word for word ("${text.slice(0, 60)}").`,
          `Cut one or rewrite it. A repeated line tells the reader they have already read this part of the page.`,
        ),
      )
    }
  }

  // --- cta-divergence ----------------------------------------------------
  const targets = new Set(sections.flatMap(ctaTargetsOf))
  if (targets.size > 1) {
    findings.push(
      finding(
        "cta-divergence",
        "high",
        [],
        `The page offers ${targets.size} different actions (${[...targets].join(", ")}). A page that asks for a waitlist and a consultation and a purchase converts on none of them.`,
        `Pick one action and point every button at it. A genuine second option belongs in the footer as a link, not as a competing button.`,
      ),
    )
  }

  // --- live-faq-on-campaign ----------------------------------------------
  //
  // Only the FAQ. A LIVE TESTIMONIAL IS CORRECT and deliberately not flagged:
  // the prompt explicitly prefers live testimonials over authored copies when
  // the owner already has the content. The site-wide FAQ is different because
  // it answers "what is DJP Athlete" for a stranger rather than an objection
  // to this specific offer.
  for (const section of sections) {
    if (section.kind !== "faq") continue
    if ((section.props as { source?: string }).source !== "live") continue
    findings.push(
      finding(
        "live-faq-on-campaign",
        "high",
        [section.id],
        `"${section.id}" pulls the site-wide FAQ, which answers "what is DJP Athlete" for someone who has never heard of the business — not the objections of someone deciding about THIS offer.`,
        `Switch to source "inline" and write the objections to this specific thing: what it costs, how long it takes, whether it suits their level, what happens if they are injured, how to cancel.`,
      ),
    )
  }

  // --- proof-below-fold --------------------------------------------------
  const proofIndex = sections.findIndex(
    (section) => section.kind === "proof" || section.kind === "testimonial",
  )
  if (proofIndex === -1 || proofIndex > Math.floor(sections.length / 2)) {
    findings.push(
      finding(
        "proof-below-fold",
        "high",
        proofIndex === -1 ? [] : [sections[proofIndex].id],
        proofIndex === -1
          ? `The page carries no proof section and no testimonial at all, so nothing on it is evidence.`
          : `The first proof on the page is at position ${proofIndex + 1} of ${sections.length}. Social proof that far down is read only by people who had already decided.`,
        `Put a proof strip directly under the first screen, or a testimonial before the halfway point.`,
      ),
    )
  }

  // --- section-count -----------------------------------------------------
  if (sections.length < SECTION_COUNT_MIN || sections.length > SECTION_COUNT_MAX) {
    findings.push(
      finding(
        "section-count",
        "low",
        [],
        `The page has ${sections.length} sections. A capture page wants ${SECTION_COUNT_MIN} to ${SECTION_COUNT_MAX}: fewer gives a visitor nothing to believe, more gives them more chances to leave.`,
        sections.length < SECTION_COUNT_MIN
          ? `Add the missing beat — proof, objection handling, or a how-it-works.`
          : `Cut the sections you cannot justify. Length is not thoroughness.`,
      ),
    )
  }

  return findings
}
