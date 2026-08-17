// lib/funnels/sections/review/reviser.ts — the one call that changes the page.
//
// ---------------------------------------------------------------------------
// IT REUSES `SECTION_BUILDER_BLOCK_A` VERBATIM, AND THAT IS THE WHOLE POINT.
// ---------------------------------------------------------------------------
// Block A already describes the ten kinds, every prop shape, the CtaTarget
// union, the op grammar, the eight application rules and the leadgen craft
// rules — all GENERATED FROM THE REGISTRY, so it cannot drift from what
// `applyOps` will accept. It is a module-level const built once at import, so
// reusing it is free.
//
// Writing a second, shorter description of the section kinds here would be the
// exact move `registry.ts` exists to prevent: the reviser would be told about
// a registry that ages independently of the one the builder is told about, and
// the first symptom would be a reviser emitting ops for a variant that no
// longer exists — rejecting the whole batch, silently, on pages that were fine.
//
// `opSchema` is IMPORTED, never restated, for the same reason `prompt.ts` says
// so at length: this repo has shipped three separate bugs from restating a
// schema instead of importing it.

import { z } from "zod"
import { callAgent } from "@/lib/ai/anthropic"
import { opSchema, type SectionOp } from "@/lib/funnels/sections/apply"
import {
  SECTION_BUILDER_MAX_OPS,
  SECTION_BUILDER_MODEL,
  SECTION_REVIEW_MAX_SUMMARY_LENGTH,
  SECTION_REVIEW_REVISER_MAX_TOKENS,
} from "@/lib/funnels/sections/builder-config"
import { SECTION_BUILDER_BLOCK_A } from "@/lib/funnels/sections/prompt"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import type { Finding } from "@/lib/funnels/sections/review/findings"

export const reviseResultSchema = z.object({
  /**
   * Plain prose for the owner's transcript. What changed and why, in their
   * terms — this is the only part of the review most owners will ever read.
   *
   * ---------------------------------------------------------------------------
   * DELIBERATELY UNCONSTRAINED. NO `.min()`, NO `.max()`. DO NOT ADD ONE.
   * ---------------------------------------------------------------------------
   * It carried `.min(1).max(600)`, and that is the bug that took the review
   * stage down in production: a reviser that fixed sixteen findings wrote 1,048
   * characters, and the single `too_big` issue on THIS FIELD made
   * `generateObject` throw away the nine valid ops it came with. The owner saw
   * "The reviewer could not finish."
   *
   * The limit still exists — `clampSummary` applies
   * `SECTION_REVIEW_MAX_SUMMARY_LENGTH` after the call, where an over-long
   * summary costs a truncation instead of the whole revision. `ops` keeps its
   * `.max()` because an op batch over the limit is a functional problem and
   * `applyOps` has to reject it.
   */
  summary: z.string().default(""),
  ops: z.array(opSchema).max(SECTION_BUILDER_MAX_OPS),
})

export type ReviseResult = z.infer<typeof reviseResultSchema>

/** Said when the model returns ops with no prose at all. Never empty: `appendTurn` stores this as the turn's message. */
const SUMMARY_FALLBACK = "Applied the reviewers' fixes to the page."

/**
 * The transcript's length limit, applied where it cannot cost anything.
 *
 * Cuts at the last sentence that fits, so the summary ends on a full stop rather
 * than mid-word; falls back to the last whole word with an ellipsis when one
 * sentence is longer than the entire budget.
 */
export function clampSummary(raw: string): string {
  const text = raw.trim()
  if (text === "") return SUMMARY_FALLBACK
  if (text.length <= SECTION_REVIEW_MAX_SUMMARY_LENGTH) return text

  const room = text.slice(0, SECTION_REVIEW_MAX_SUMMARY_LENGTH - 1)
  const sentence = Math.max(room.lastIndexOf(". "), room.lastIndexOf("? "), room.lastIndexOf("! "))
  if (sentence >= SECTION_REVIEW_MAX_SUMMARY_LENGTH / 2) return room.slice(0, sentence + 1)

  const word = room.lastIndexOf(" ")
  return `${(word >= SECTION_REVIEW_MAX_SUMMARY_LENGTH / 2 ? room.slice(0, word) : room).trimEnd()}…`
}

export const REVISER_SYSTEM = `${SECTION_BUILDER_BLOCK_A}

---

## You are now the EDITOR, not the author

The page above already exists. A structural check and three reviewers have read
it and reported what is wrong with it. Your job is to fix what they found, and
nothing else.

- ACT ON THE FINDINGS. Do not go looking for new problems. The reviewers were
  thorough, and a fourth opinion applied silently is how a page drifts away
  from what its owner actually asked for.
- PREFER \`update_section\` OVER \`set_page\`, always. \`set_page\` is a rewrite,
  it is reported to the owner as one, and it discards the section ids that
  anchor links point at.
- A FINDING YOU DISAGREE WITH IS A FINDING YOU SKIP, and say so in the summary.
  Emitting an op you believe is wrong to satisfy a reviewer is worse than
  leaving the page alone.
- RHYTHM FINDINGS ARE USUALLY FIXED WITH \`style\`, NOT \`props\`. A tone seam
  needs one section's \`style.tone\` changed; it does not need its copy
  rewritten. Reach for the smallest op that answers the finding.
- IF THE FINDINGS ARE ALL LOW SEVERITY AND THE PAGE READS WELL, RETURN AN EMPTY
  OPS ARRAY and say the page is in good shape. That is a correct outcome, not a
  failure to do your job.

\`summary\` is shown to the owner in their chat transcript. Plain prose, no
markdown, past tense, one short paragraph: what you changed and why.`

function findingsBlock(findings: Finding[]): string {
  if (findings.length === 0) return "(Nothing was found. Return an empty ops array.)"
  return findings
    .map(
      (finding, index) =>
        `${index + 1}. [${finding.severity}] ${finding.code} — ${finding.sectionIds.join(", ") || "whole page"}\n` +
        `   Problem: ${finding.issue}\n` +
        `   Suggested: ${finding.suggestion}`,
    )
    .join("\n\n")
}

/**
 * One Opus call: document plus findings in, ops out.
 *
 * THROWS on a provider failure, deliberately. Unlike the critics — where a
 * missing lens degrades the review — a reviser that failed produced no ops at
 * all, and the pipeline needs to tell the difference between "nothing to
 * change" and "could not be asked". `pipeline.ts` catches it and gives the
 * page back untouched.
 */
export async function runReviser(
  doc: SectionDoc,
  findings: Finding[],
): Promise<ReviseResult & { tokensUsed: number }> {
  const message = `## The page as it stands

${JSON.stringify(doc, null, 2)}

## What the reviewers found

${findingsBlock(findings)}

Emit the ops that fix these. Return JSON only.`

  // `clampSummary` is applied HERE rather than in the schema, so a summary the
  // model wrote too long costs a truncated sentence and not the ops. See
  // `reviseResultSchema.summary`.
  const { content, tokens_used } = await callAgent(REVISER_SYSTEM, message, reviseResultSchema, {
    model: SECTION_BUILDER_MODEL,
    maxTokens: SECTION_REVIEW_REVISER_MAX_TOKENS,
    // NOT cached, and not an oversight. `cacheSystemPrompt` puts ONE
    // breakpoint on the whole system string, and Anthropic caching is a strict
    // prefix match. Block A is frozen, but everything after the `---` is this
    // module's own tail — stable today, and a silent full cache WRITE every
    // single turn the moment someone interpolates a finding into it. The
    // builder pays for its cache because Block A is the whole of its system
    // string; here the win is smaller and the trap is one edit away.
  })
  return { ...content, summary: clampSummary(content.summary), tokensUsed: tokens_used ?? 0 }
}

export type { SectionOp }
