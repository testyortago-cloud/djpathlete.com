// lib/funnels/sections/builder-config.ts — tunables for the AI page builder.
//
// Same shape as lib/admin-ai-config.ts: a flat list of exported consts, each
// with a one-line doc comment, so a number that needs changing is changed in
// exactly one place and every call site sees it. Nothing here imports the
// prompt or the registry — this file is a leaf, so `prompt.ts`, the route
// (Stage 1.8) and the UI can all read it without an import cycle.

import { MODEL_OPUS_5, MODEL_SONNET } from "@/lib/ai/anthropic"

/**
 * The model the page builder runs on.
 *
 * UNVERIFIED AGAINST THE LIVE API. Nothing in this repo has yet made a real
 * `generateObject` call against `claude-opus-5`; whether the installed
 * `@ai-sdk/anthropic` + `ai` versions drive that id correctly through the
 * pinned `structuredOutputMode: "jsonTool"` path needs a smoke call, which
 * belongs to the stage that first calls the model. If it does not work,
 * switch to `SECTION_BUILDER_FALLBACK_MODEL` below — one line, no other
 * change — rather than repointing the shared constants in lib/ai/anthropic.ts.
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
 */
export const SECTION_BUILDER_EDIT_MAX_TOKENS = 8_000

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
