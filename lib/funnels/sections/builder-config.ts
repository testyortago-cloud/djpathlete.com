// lib/funnels/sections/builder-config.ts — tunables for the AI page builder.
//
// Same shape as lib/admin-ai-config.ts: a flat list of exported consts, each
// with a one-line doc comment, so a number that needs changing is changed in
// exactly one place and every call site sees it. Nothing here imports the
// prompt or the registry — this file is a leaf, so `prompt.ts`, the route
// (Stage 1.8) and the UI can all read it without an import cycle.
//
// ---------------------------------------------------------------------------
// "THE UI CAN READ IT" WAS FALSE FOR THREE STAGES. IT IS NOW TRUE BY
// CONSTRUCTION, AND THE ONE IMPORT BELOW IS THE WHOLE OF THE FIX.
// ---------------------------------------------------------------------------
// The line above used to read `from "@/lib/ai/anthropic"` — a module that
// imports `@anthropic-ai/sdk` and `ai` and constructs an Anthropic provider AT
// MODULE SCOPE. So this "leaf" pulled the entire SDK, and evaluated a provider
// constructor, into anything that imported it. It was not a theoretical cost:
//
//     lib/funnels/sections/doc.ts -> lib/validators/funnel.ts -> HERE -> the SDK
//
// which made `reassemble()` un-importable in the browser and forced Stage 1.9
// to route the owner's publish click through a server action instead. A header
// that claims client-safety while the import graph says otherwise is the worse
// half of that: it stops the next reader checking.
//
// `@/lib/ai/models` holds the ids and imports NOTHING. Keep it that way, and
// keep this file's imports to leaves of that kind — the failure mode of getting
// it wrong is a client bundle that silently gained an SDK and still builds
// green. (`reassemble` itself stays server-side regardless: `doc.ts` also
// reaches `parse5` and `postcss` through `lib/funnels/compile`. This import is
// the one that had a header lie attached to it, not the only one that exists.)

import { MODEL_OPUS_5, MODEL_SONNET } from "@/lib/ai/models"

/**
 * The model the page builder runs on.
 *
 * UNVERIFIED AGAINST THE LIVE API. Nothing in this repo has yet made a real
 * `generateObject` call against `claude-opus-5`; whether the installed
 * `@ai-sdk/anthropic` + `ai` versions drive that id correctly through the
 * pinned `structuredOutputMode: "jsonTool"` path needs a smoke call, which
 * belongs to the stage that first calls the model. If it does not work,
 * switch to `SECTION_BUILDER_FALLBACK_MODEL` below — one line, no other
 * change — rather than repointing the shared constants in lib/ai/models.ts.
 */
export const SECTION_BUILDER_MODEL = MODEL_OPUS_5

/** Proven-in-this-repo fallback: every existing agent runs on this today. */
export const SECTION_BUILDER_FALLBACK_MODEL = MODEL_SONNET

/**
 * Max characters of ONE owner message.
 *
 * Deliberately not `AI_CHAT_MAX_MESSAGE_LENGTH` (5000). That cap is sized for
 * a chat question; this input is routinely a whole page brief with the
 * owner's existing sales copy pasted in, and the registry's own per-field
 * bounds already add up past 5000 for a single page: one hero (160 + 300) +
 * six bullets (6 x 400) + three pricing plans (3 x ~1500 with eight features
 * each) + twelve FAQ answers (12 x 1000) is over 20k characters of authored
 * text the owner might legitimately paste in one go. 12000 is the compromise:
 * comfortably past "paste your current landing page" (~2000 words) while
 * still bounding one turn's input tokens to roughly 3k, so a single message
 * can never dominate the cached ~3.5k-token system prompt.
 */
export const SECTION_BUILDER_MAX_MESSAGE_LENGTH = 12_000

/**
 * How many prior turns of PROSE go into Block C (the plan says 8).
 * Prose only: the document itself is sent in full every turn, so replaying
 * old ops would be redundant AND would teach the model to re-emit them.
 */
export const SECTION_BUILDER_HISTORY_TURNS = 8

/**
 * Ceiling for any per-call `maxTokens` below. `generateObject` is
 * NON-STREAMING, so the whole response must come back inside one HTTP
 * request; asking for a very large budget invites SDK-level timeouts on a
 * slow generation. `callAgent`'s own DEFAULT_MAX_TOKENS is 32000 and MUST be
 * overridden on every builder call for this reason.
 */
export const SECTION_BUILDER_MAX_TOKENS_CEILING = 16_000

// ---------------------------------------------------------------------------
// THE TWO CONSTANTS BELOW ARE UNUSED, AND THAT IS NOT AN OVERSIGHT.
//
// Both belong to the plan's FAN-OUT design: a first draft was to be a "plan the
// page" call followed by one "build the sections" call per section. Stage 1.8
// built a SINGLE call per turn instead (anti-drift: a per-section call cannot
// see the sections beside it, and the win the fan-out was for — sections
// landing as they arrive — needs streaming, which the single-JSON response
// shape precludes). Nothing calls these today.
//
// DO NOT "wire them up" to make the warning go away. Wiring
// SECTION_BUILDER_SECTION_MAX_TOKENS into the route is the exact defect fix
// round 1 removed: as a PER-SECTION budget 6000 is generous, as the budget for
// a whole first-draft page it truncates the response and dead-ends an owner's
// first turn. They come back only WITH the fan-out, and the budget that bounds
// a whole-page call is SECTION_BUILDER_EDIT_MAX_TOKENS below.
// ---------------------------------------------------------------------------

/** maxTokens for the "plan the page" call — prose plus a short outline. */
export const SECTION_BUILDER_PLAN_MAX_TOKENS = 4_000

/** maxTokens for ONE section of a fanned-out first draft. NOT a page budget. */
export const SECTION_BUILDER_SECTION_MAX_TOKENS = 6_000

/**
 * maxTokens for ONE WHOLE-PAGE call — both an iterative edit and, since there
 * is no fan-out, a first draft. Sized for the worst realistic response: a
 * `set_page` carrying all 24 sections.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS 14_000 AND NOT THE 8_000 IT SHIPPED AT: `max_tokens` BUYS
 * THINKING AND OUTPUT OUT OF THE SAME PURSE ON THIS MODEL.
 * ---------------------------------------------------------------------------
 * `callAgent` (lib/ai/anthropic.ts) passes `maxOutputTokens` and
 * `structuredOutputMode: "jsonTool"` and NO `thinking` configuration, and
 * `@ai-sdk/anthropic` only sends `thinking` when the caller supplies it. On
 * `claude-opus-5` — unlike Opus 4.8 and earlier — omitting it runs adaptive
 * thinking BY DEFAULT, and `max_tokens` caps thinking plus response text
 * TOGETHER. So the budget an 8-section page needs is not the budget the JSON
 * needs; it is that plus however much the model thought first.
 *
 * MEASURED, NOT ASSUMED: a real first draft against this model returned 8
 * sections in ~30s at the old 8_000 and parsed clean, so this is HEADROOM at
 * the top of the range (a `set_page` carrying all 24 sections, where the JSON
 * alone is several times an 8-section page), NOT a fix for a turn-one dead
 * end. What truncation looks like if the headroom is ever removed again:
 * `generateObject` throws a parse error, the one retry asks the same
 * oversized question and throws the same way, and the owner's first turn on a
 * brand-new page dead-ends with nothing to click.
 *
 * TWO THINGS THAT LOOK LIKE CHEAPER FIXES AND ARE NOT:
 *   - `providerOptions.anthropic.thinking: { type: "disabled" }` would free
 *     the whole budget for output. It is FORBIDDEN here: with thinking off,
 *     Opus 5 occasionally writes a tool call into visible text instead of
 *     calling the tool, which through `jsonTool` is a silent no-op turn.
 *   - `temperature` / `top_p` are rejected with a 400 by this model. Do not
 *     add them. `callAgent` passes neither today; keep it that way.
 *
 * Raising it further is bounded by `SECTION_BUILDER_MAX_TOKENS_CEILING`
 * (16_000) and by that ceiling's reason: `generateObject` is NON-STREAMING,
 * so a bigger budget is a longer single HTTP request. 14_000 keeps a margin
 * under the ceiling rather than sitting on it.
 */
export const SECTION_BUILDER_EDIT_MAX_TOKENS = 14_000

/**
 * Max ops in one response. Matched to the 1..24 section bound in
 * `sectionDocSchema`: a batch that names more sections than a document can
 * hold is a runaway, not an edit.
 */
export const SECTION_BUILDER_MAX_OPS = 24

/** Max characters of the prose `reply` shown in chat. */
export const SECTION_BUILDER_MAX_REPLY_LENGTH = 1_200

/**
 * Rate limit: max builder calls per user per window. Lower than the admin
 * chatbot's 10/min in requests-per-minute terms would be wrong (an owner
 * iterating on copy fires several turns a minute), but each call is far more
 * expensive, so the window is longer instead of the count being higher.
 */
export const SECTION_BUILDER_RATE_LIMIT_MAX = 20

/** Rate limit: window duration (ms). Pattern: app/api/admin/ai-chat/route.ts. */
export const SECTION_BUILDER_RATE_LIMIT_WINDOW_MS = 300_000

// ---------------------------------------------------------------------------
// THE REVIEW STAGE
//
// Runs AFTER a build turn has already committed. Every constant below is sized
// on that fact: the stage can be abandoned at any point, for any reason, and
// the cost is the tokens already spent — never the owner's page. Nothing here
// needs a safety margin for "what if it fails", because failing is free.
//
// Spec: docs/superpowers/specs/2026-08-15-ai-page-review-pipeline-design.md
// ---------------------------------------------------------------------------

/**
 * How many times the reviser may run against a fresh set of findings.
 *
 * ONE, ARGUED FOR RATHER THAN ASSUMED. Subjective copy tends to oscillate
 * between rounds instead of converging: the second reviser reads the first's
 * output as a new page with new problems, and "make it punchier" applied twice
 * produces a headline with no verbs left in it. Raising this to 2 is a one-line
 * change and should be made against evidence — `ReviewOutcome.surviving`
 * records exactly which findings the first round failed to clear, which IS
 * that evidence.
 *
 * `0` disables the review stage outright. That is the kill switch this feature
 * has instead of a flag: the project rule is that flags guard money and
 * mass-email risk, and this guards neither.
 */
export const SECTION_REVIEW_MAX_ROUNDS = 1

/**
 * The critics' model.
 *
 * SONNET, AND NOT BECAUSE CRITIQUE IS THE EASY PART. A critic emits FINDINGS —
 * prose in a fixed envelope. Nothing it returns has to satisfy `opSchema`,
 * nothing it returns can reject a batch, and a critic that writes a slightly
 * worse sentence costs a slightly worse sentence. The reviser is the call that
 * must produce structurally valid ops against a ten-kind registry where one
 * malformed op rejects every other op sent with it, and that is where the Opus
 * budget goes. Same shape as `lib/agents/self-critique.ts`, which runs a cheap
 * second-pass critic behind an expensive main call.
 */
export const SECTION_REVIEW_CRITIC_MODEL = MODEL_SONNET

/** maxTokens for ONE critic. A findings list, not a document. */
export const SECTION_REVIEW_CRITIC_MAX_TOKENS = 2_000

/**
 * maxTokens for the reviser.
 *
 * Matched to `SECTION_BUILDER_EDIT_MAX_TOKENS` and for the same reason spelled
 * out there: a reviser acting on a page-wide rhythm finding may legitimately
 * emit an `update_section` for every section on the page, and on
 * `claude-opus-5` `max_tokens` buys thinking and output out of the same purse.
 * Sizing this to "a few ops" is what dead-ends the turn.
 */
export const SECTION_REVIEW_REVISER_MAX_TOKENS = 14_000

/**
 * Wall-clock budget for the WHOLE stage — critics, reviser, apply and re-audit.
 *
 * The route sets `maxDuration = 300` and the build turn preceding this has
 * typically spent ~30s of it. 90s covers the parallel critic fan-out (~15s),
 * a reviser (~30s) and a retry with room to spare, while still guaranteeing
 * the owner gets an answer rather than a stream that hangs until a proxy
 * drops it.
 */
export const SECTION_REVIEW_TIMEOUT_MS = 90_000

/**
 * How many findings reach the reviser after merge.
 *
 * Bounded by `SECTION_BUILDER_MAX_OPS` (24) on purpose: a findings list longer
 * than the batch that could act on it guarantees the reviser silently ignores
 * the tail, and a page with more than 24 distinct problems wants rebuilding,
 * not polishing.
 */
export const SECTION_REVIEW_MAX_FINDINGS = 24
