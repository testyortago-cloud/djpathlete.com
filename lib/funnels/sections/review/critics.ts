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
import type { RenderedPage } from "@/lib/funnels/render-image"
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
  /**
   * Whether this lens is shown screenshots of the rendered page.
   *
   * A PROPERTY OF THE TABLE, not an `if (source === "art")` in the fan-out, so
   * that adding a fourth critic cannot silently start spending vision tokens
   * on it. Exactly one lens has this today and a test pins that.
   */
  seesRender: boolean
}

export const CRITICS: readonly CriticLens[] = [
  {
    source: "art",
    label: "Art director",
    seesRender: true,
    system: `${SHARED_ENVELOPE}

YOUR LENS: how the page LOOKS as somebody scrolls it. Nobody else is looking at
this.

WHEN SCREENSHOTS OF THE PAGE ARE ATTACHED, a note at the end of the message says
so, and says how many there are and what each one covers. That note is the only
thing that tells you if you have pictures on this turn. When it is there, read
the pictures first: the document tells you what was asked for, the pictures tell
you what came out. Look for what only a picture can show:
- a band with nothing in it, or nearly nothing, taking up a whole screen
- text you cannot read against what sits behind it
- a list whose items do not line up with each other
- words that overflow their box, collide, or get cut off
- a heading marooned from its own content by a wide empty gap
- an image that crops badly or is stretched out of shape

That same note names any part of the page a browser FILLS IN when a visitor
loads it — a form, a live testimonial feed, a live list of questions, a checkout
or booking button, a quiz. Those parts are blank in the pictures and full of
content on the real page. Never report one of them as empty, and never write a
quote, a name, a number or any other content to put in one.

WHEN THAT NOTE IS NOT THERE you have no pictures, and you judge the page from
the document alone. Say so by saying nothing: no "in the screenshot", no "as
rendered", no claim about a colour, a gap or a position nobody showed you. A
made-up observation costs more than a missing one, because the editor
downstream cannot tell the two apart.

Rhythm you can judge either way: where the page goes flat, tone and padding that
never change, variants clearly taken as defaults rather than chosen, a middle
stretch where every band is interchangeable with the one above it. And the
opposite failure: alternating so hard that nothing stands out, or a second
section loud enough to compete with the hero.

WHAT A PICTURE DOES NOT TELL YOU: which typeface was used. Three of this
builder's font choices resolve to whatever face the machine happens to have, so
the letterforms in it are not the ones a visitor sees.
NEVER FILE A FINDING ABOUT THE TYPEFACE or which font was chosen. Size, weight,
spacing and line length are real and are fair game.

The other two reviewers cover the words and the offer. Say nothing about either
except where LAYOUT is what makes them fail — a strong testimonial buried in
the middle of five identical bands is your finding; a weak testimonial is not.`,
  },
  {
    source: "copy",
    label: "Copywriter",
    seesRender: false,
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
    seesRender: false,
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
 * The user message: the same page for all three critics, and byte-identical
 * across all three on any turn with no render — which is every degrade path.
 * The art lens's own call has `renderNote()` appended to this when there are
 * pictures with it; see below for why that amendment is safe.
 *
 * The three calls were once byte-identical, so that agreement between two
 * critics meant two perspectives reaching the same conclusion rather than one
 * having been shown more than the other. That still holds for the DOCUMENT:
 * every lens sees the same JSON and the same deterministic findings.
 *
 * The art director additionally receives screenshots of the rendered page
 * (2026-09-14). This is a deliberate amendment, not an oversight. The artefact
 * the old rule guarded against is giving one critic MORE OF THE SAME
 * information, which manufactures false agreement; a picture is a DIFFERENT
 * MODALITY matched to one lens's question. The copywriter reading a picture of
 * prose would be strictly worse off and the offer critic has no use for one, so
 * cross-lens agreement still means what it always meant.
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
 * What the art critic is told about the pictures it is looking at.
 *
 * Appended ONLY to the lens that receives them, and it is the ONLY place that
 * says pictures exist. The system prompt is a cached prefix and Anthropic's
 * cache is a strict prefix match, so a sentence in it that is true on some
 * turns and false on others is a silent cache invalidator — and, worse, was
 * read as true on the turns it was false: the brief used to open "YOU HAVE
 * PICTURES", which is sent on every degrade path (no browser, launch failure,
 * screenshot failure) where nothing is attached at all. Measured on one real
 * document: 5 of 5 art findings cited "the screenshot" when there was no
 * screenshot. Per-turn claims belong here, in the user message, where the
 * per-turn content already is.
 *
 * Telling the other two lenses about screenshots they cannot see would have
 * them reasoning about evidence they do not have, which is worse still.
 */
function renderNote(render: RenderedPage): string {
  const slices = render.images.length - 1
  const lines = [
    "",
    "## The page as a browser drew it",
    "",
    `${render.images.length} screenshots of this page are attached to this message: a whole-page view ` +
      `first, then ${slices} slice${slices === 1 ? "" : "s"} from the top of the page to the bottom.`,
  ]
  if (render.truncated) {
    lines.push(
      "",
      "The page is longer than what was captured — the last slice is NOT the end of the page. " +
        "Do not comment on how the page ends.",
    )
  }
  if (!render.typographyFaithful) {
    lines.push("", "The webfonts did not load for these pictures, so the type is a fallback face.")
  }
  // HALF OF WHAT STOPS A FABRICATED TESTIMONIAL. These regions are empty divs
  // in a scripts-off screenshot and full of real content on the live page; the
  // art critic filed them as high-severity empty bands and the reviser invented
  // a named person's quote to fill one.
  //
  // THIS NOTE ON ITS OWN WAS MEASURED AND WAS NOT ENOUGH — the critic still
  // filed the band as empty, because it could see that it was. The other half
  // is `islandPlaceholderCss` (render-image.ts §islands), which paints each one
  // as a labelled dashed box so the picture and this note now agree.
  if (render.dynamicRegions.length > 0) {
    lines.push(
      "",
      "### Parts of this page that are NOT in the pictures",
      "",
      "These parts are interactive. The browser fills them in when a visitor loads the page. In these " +
        "screenshots each one is drawn as a dashed box with a line of text saying what goes there, and " +
        "on the page itself it holds real content:",
      "",
      ...render.dynamicRegions.map((region) => `- ${region}`),
      "",
      "Do NOT report any of them as empty, blank, thin or unfinished — that is this picture, not the " +
        "page. Do NOT write a quote, a name, a number, a question or any other content to fill one; " +
        "content you invent for these would go out under this coach's name. The dashed box is not " +
        "part of the design either, so do not comment on its outline, its colour or its wording. " +
        "The box is also a PLACEHOLDER SIZE, not the real one — the live content decides how tall " +
        "the band ends up — so do not report the space above, below or around one as too much, too " +
        "little or unbalanced, and do not judge that section's padding from it. Judge what " +
        "surrounds them.",
    )
  } else {
    lines.push(
      "",
      "Nothing on this page is filled in later by the browser, so every part of it is in these " +
        "pictures. A band that looks empty here is empty on the page.",
    )
  }
  return lines.join("\n")
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
export interface CriticPanelResult {
  findings: Finding[]
  /**
   * Tokens the panel actually spent, summed across the lenses that answered.
   *
   * Reported rather than dropped because this stage roughly triples the AI
   * spend of a first draft, and every other model call on the build route is
   * already accounted for. A cost that only shows up on the invoice is a cost
   * nobody can attribute.
   */
  tokensUsed: number
}

export async function runCritics(
  doc: SectionDoc,
  auditFindings: Finding[],
  render?: RenderedPage | null,
): Promise<CriticPanelResult> {
  const message = userMessage(doc, auditFindings)
  // A failed render is an absent render. `images: []` would switch the
  // transport to the `messages` form for a list with no image in it.
  const usable = render && render.images.length > 0 ? render : null

  const settled = await Promise.allSettled(
    CRITICS.map(async (critic) => {
      const showPictures = critic.seesRender && usable !== null
      const result = await callAgent(
        critic.system,
        showPictures ? `${message}\n${renderNote(usable)}` : message,
        criticFindingsSchema,
        {
          model: SECTION_REVIEW_CRITIC_MODEL,
          maxTokens: SECTION_REVIEW_CRITIC_MAX_TOKENS,
          ...(showPictures ? { images: usable.images } : {}),
        },
      )
      // `source` is stamped HERE, never read from the model. A model asked to
      // label its own lens occasionally labels it as one of the other two, and
      // the merge would then silently collapse two independent observations
      // into one — losing exactly the cross-lens agreement that made the
      // finding worth trusting.
      return {
        findings: result.content.findings.map((finding): Finding => ({ ...finding, source: critic.source })),
        tokensUsed: result.tokens_used ?? 0,
      }
    }),
  )

  const findings: Finding[] = []
  let tokensUsed = 0
  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      findings.push(...result.value.findings)
      tokensUsed += result.value.tokensUsed
      continue
    }
    console.error(`[funnels/review] critic "${CRITICS[index].source}" failed:`, result.reason)
  }
  return { findings, tokensUsed }
}
