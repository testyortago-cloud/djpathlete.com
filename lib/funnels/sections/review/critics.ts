// lib/funnels/sections/review/critics.ts — three lenses, run in parallel.
//
// ---------------------------------------------------------------------------
// THE LENSES ARE THE DESIGN. THREE CRITICS SHARING ONE BRIEF ARE ONE CRITIC.
// ---------------------------------------------------------------------------
// The obvious way to build a review panel is to run the same "find problems
// with this page" prompt N times and count agreement. That produces three
// reports of the same finding, reads as thoroughness, and adds nothing a
// single call would not have found — while costing three calls and making the
// merged list look longer than the page's actual problem count.
//
// So each critic below is handed a question the other two cannot answer, and
// is TOLD what the others cover so it does not wander into their territory. An
// art director who starts editing prose is a duplicate; an art director who
// notices that a good testimonial is buried in five identical bands is finding
// something nobody else can see.
//
// They run on Sonnet, and not because critique is the easy part. A critic
// emits FINDINGS — prose in a fixed envelope. Nothing it returns has to
// satisfy `opSchema`, nothing it returns can reject a batch, and a critic that
// writes a slightly worse sentence costs a slightly worse sentence. The
// reviser is the call that must produce structurally valid ops against a
// ten-kind registry where one malformed op rejects every other op sent with
// it, and that is where the Opus budget goes. Same shape as
// `lib/agents/self-critique.ts`.

import { callAgent } from "@/lib/ai/anthropic"
import {
  SECTION_REVIEW_CRITIC_MAX_TOKENS,
  SECTION_REVIEW_CRITIC_MODEL,
} from "@/lib/funnels/sections/builder-config"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import { criticFindingsSchema, type Finding, type FindingSource } from "@/lib/funnels/sections/review/findings"

const SHARED_ENVELOPE = `
You are reviewing a landing page for a strength-and-conditioning coaching
business. The page is a TYPED DOCUMENT, not HTML: each section has a kind, a
variant, four style knobs (headline size, align, tone, pad) and typed props.

You report findings. You do not fix anything — a separate editor acts on what
you send, and it can only act on what you make specific.

Each finding needs:
  code        a short kebab-case slug for the KIND of problem ("vague-headline")
  severity    "high" when it costs the page conversions or credibility,
              "medium" when it makes the page worse, "low" for polish
  sectionIds  the section ids it concerns; [] for a whole-page problem
  issue       ONE sentence naming what is wrong, quoting the copy if it is copy
  suggestion  ONE sentence naming what to do instead, concretely

What makes a finding useful:
- Name the section and quote the words. "The copy is weak" is unactionable;
  "the hero headline 'Train smarter' would fit any gym in the country" is not.
- The ten section kinds are: hero, proof, bullets, steps, testimonial, pricing,
  faq, form, cta, footer. Never suggest anything outside that list.
- IF THE PAGE IS GOOD IN YOUR AREA, RETURN AN EMPTY LIST. A critic that always
  finds three things is a critic whose findings mean nothing, and the editor
  downstream will churn a good page to satisfy you.
- Say nothing about anything outside your lens. Two other reviewers are reading
  this same page right now and their notes are merged with yours; overlap costs
  the editor attention it should be spending on real problems.
`.trim()

export interface CriticLens {
  /** Stamped onto every finding this lens produces. */
  source: Exclude<FindingSource, "audit">
  label: string
  system: string
}

export const CRITICS: readonly CriticLens[] = [
  {
    source: "art",
    label: "Art director",
    system: `${SHARED_ENVELOPE}

YOUR LENS: how the page LOOKS as somebody scrolls it. Nobody else is looking at
this.

Ask where the page goes flat. A landing page needs a rhythm — bands that
alternate, sections that breathe differently, a shape the eye can follow down
the screen. Look for tone that never changes, padding that never changes,
variants that were clearly taken as defaults rather than chosen, alignment that
flips without meaning anything, and a middle section of the page where every
band is interchangeable with the one above it.

Look for the opposite failure too: a page alternating so hard that nothing
stands out, or a second section loud enough to compete with the hero.

The other two reviewers cover the words and the offer. Say nothing about either
except where LAYOUT is what makes them fail — a strong testimonial buried in
the middle of five identical bands is your finding; a weak testimonial is not.`,
  },
  {
    source: "copy",
    label: "Copywriter",
    system: `${SHARED_ENVELOPE}

YOUR LENS: the words. Nobody else is reading them closely.

Ask of every headline: could this sit on a competitor's page unchanged? If it
could, it says nothing. Look for abstraction where a number belongs, hedging,
throat-clearing openers, three sections making the same point in different
words, jargon a parent booking for their teenager would not use, and subheads
that restate the headline instead of advancing it.

This is a coach who works with real athletes in Tampa Bay. The voice is direct,
concrete and slightly blunt — "we tell you what we'd do in your position", not
"we leverage evidence-based methodologies". Flag anything that reads like a
brochure, and anything that promises a result no coach can promise.

The other two reviewers cover the layout and the offer. Judge the writing.`,
  },
  {
    source: "conversion",
    label: "Conversion strategist",
    system: `${SHARED_ENVELOPE}

YOUR LENS: whether somebody who wants this can actually act on it. Nobody else
is asking.

Ask what this page's ONE job is, and whether every part of it serves that job.
Look for an offer that is never stated plainly, a price or a commitment the
page avoids mentioning, an objection a real person would have that nothing
answers (what it costs, how long it takes, am I fit enough, what if I am
injured, how do I cancel, what happens after I click), proof that arrives too
late to change anyone's mind, a form asking for more than it needs, and a
button whose label describes the mechanism rather than the outcome ("Submit"
rather than "Book my call").

WEIGH WHAT IS MISSING AS HEAVILY AS WHAT IS PRESENT. A page with no answer to
"what does this cost" has a hole in it even when every word on it is correct.

The other two reviewers cover the layout and the prose. Judge the offer.`,
  },
]

function findingsBlock(findings: Finding[]): string {
  if (findings.length === 0) return "(A structural check found nothing mechanical.)"
  return findings
    .map(
      (finding) =>
        `- [${finding.severity}] ${finding.code} (${finding.sectionIds.join(", ") || "whole page"}): ${finding.issue}`,
    )
    .join("\n")
}

/**
 * The user message, identical for all three critics.
 *
 * Identical ON PURPOSE, beyond saving the obvious: the lens lives entirely in
 * the system prompt, so the only variable between the three calls is the
 * instruction. If two critics ever return the same finding, that is genuine
 * agreement between two perspectives rather than an artefact of one having
 * been shown more of the page than the other.
 *
 * The deterministic findings go in so the critics do not spend their budget
 * rediscovering that six sections share a padding value — and, more usefully,
 * so an art director reading "sections 2 and 3 share a tone" can spend its
 * attention on what to do about it instead.
 */
function userMessage(doc: SectionDoc, auditFindings: Finding[]): string {
  return `## The page

${JSON.stringify(doc, null, 2)}

## Already found by a structural check — do NOT repeat these

${findingsBlock(auditFindings)}

Report what your lens finds. Return JSON only.`
}

/**
 * All three lenses, concurrently.
 *
 * NEVER THROWS. A critic that fails is a critic whose findings are missing,
 * not a turn that dies: this stage runs after the owner's page has already
 * been saved, and there is no failure in here worth showing them an error for.
 *
 * `Promise.allSettled`, never `Promise.all` — one rejection under `all`
 * discards the two calls that succeeded, which turns a partial outage into a
 * total one for no reason.
 */
export async function runCritics(doc: SectionDoc, auditFindings: Finding[]): Promise<Finding[]> {
  const message = userMessage(doc, auditFindings)

  const settled = await Promise.allSettled(
    CRITICS.map(async (critic) => {
      const result = await callAgent(critic.system, message, criticFindingsSchema, {
        model: SECTION_REVIEW_CRITIC_MODEL,
        maxTokens: SECTION_REVIEW_CRITIC_MAX_TOKENS,
      })
      // `source` is stamped HERE, never read from the model. A model asked to
      // label its own lens occasionally labels it as one of the other two, and
      // the merge would then silently collapse two independent observations
      // into one — losing exactly the cross-lens agreement that made the
      // finding worth trusting.
      return result.content.findings.map((finding): Finding => ({ ...finding, source: critic.source }))
    }),
  )

  const out: Finding[] = []
  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      out.push(...result.value)
      continue
    }
    console.error(`[funnels/review] critic "${CRITICS[index].source}" failed:`, result.reason)
  }
  return out
}
