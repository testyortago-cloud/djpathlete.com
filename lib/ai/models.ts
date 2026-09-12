// lib/ai/models.ts — model IDS, and nothing else. NO SDK, NO PROVIDER, NO I/O.
//
// WHY THIS FILE EXISTS. `lib/ai/anthropic.ts` constructs an Anthropic provider
// AT MODULE SCOPE (`const provider = createAnthropic(...)`, plus the
// `@anthropic-ai/sdk` and `ai` imports). Any module that reaches it — however
// far down the chain, and even to read a single string constant — inherits the
// whole SDK and evaluates that constructor. That is a server-only cost, and it
// was being paid by a chain that has nothing to do with calling a model:
//
//     lib/funnels/sections/builder-config.ts   (declares itself readable by the UI)
//       -> lib/ai/anthropic.ts                 (SDK + module-scope provider)
//
//   and, one layer up, the chain that made `reassemble` un-importable in a
//   browser at all:
//
//     lib/funnels/sections/doc.ts -> lib/validators/funnel.ts -> builder-config
//
// The model ids are plain strings. Nothing about naming a model requires the
// client that calls it, so the ids live here and `anthropic.ts` re-exports
// them. Every existing importer of `MODEL_OPUS` / `MODEL_SONNET` / `MODEL_HAIKU`
// / `MODEL_OPUS_5` from `@/lib/ai/anthropic` keeps working unchanged; anything
// that needs ONLY an id — config leaves, validators, client components — should
// import from HERE instead, and stays free of the SDK.
//
// *** THE VALUES ARE FROZEN. *** `MODEL_OPUS`, `MODEL_SONNET` and `MODEL_HAIKU`
// are what the 4-agent program-generation pipeline, the strategy agents and the
// bookkeeper are all tuned against. This file MOVED them; it did not repoint
// them. Changing one here changes behaviour for every AI feature in the app —
// add a new constant instead, exactly as `MODEL_OPUS_5` was added.
//
// NOTHING MAY BE ADDED TO THIS FILE THAT IMPORTS ANYTHING. The moment it grows
// a dependency it stops being safe for the chain above, silently, with a green
// build — a client bundle that gained the Anthropic SDK still compiles and
// still renders. A test in `__tests__/lib/funnels/sections/builder-config.test.ts`
// pins that by walking the real import graph.

export const MODEL_OPUS = "claude-opus-4-6"
export const MODEL_SONNET = "claude-sonnet-4-6"
export const MODEL_HAIKU = "claude-haiku-4-5-20251001"

/**
 * ADDITIVE ONLY — added for the AI page builder (lib/funnels/sections/*).
 *
 * UNVERIFIED: whether @ai-sdk/anthropic + `ai` drive this id correctly through
 * `generateObject`'s jsonTool path has NOT been smoke-tested against the live
 * API — that belongs to the stage that first makes a real call. The documented
 * fallback is `MODEL_SONNET`, which is proven in this repo today.
 */
export const MODEL_OPUS_5 = "claude-opus-5"

/**
 * ADDITIVE ONLY, same rule as MODEL_OPUS_5 above.
 *
 * Sonnet 5 is newer AND cheaper than Sonnet 4.6 ($2/$10 per MTok against
 * $3/$15), so for a short, mechanical step it is a straight upgrade rather
 * than a tradeoff. It does NOT repoint MODEL_SONNET — that value is what the
 * program-generation pipeline, the strategy agents and the bookkeeper are all
 * tuned against.
 *
 * Verified working through callAgent's forced-tool-choice path against the
 * live API on 2026-09-12.
 */
export const MODEL_SONNET_5 = "claude-sonnet-5"

/**
 * Anthropic's most capable widely released model, for long-form output a human
 * actually reads. $10/$50 per MTok — roughly 5x Sonnet 4.6 — so it earns its
 * place on an article and not on a step that emits a keyword.
 *
 * DIFFERENT REQUEST SURFACE. Forced tool choice returns a 400, which is how
 * callAgent has always asked for structured output; see the structured-outputs
 * branch and `modelRejectsForcedToolChoice` in functions/src/ai/anthropic.ts.
 * Thinking is always on and cannot be disabled — use `output_config.effort`.
 * Its JSON-schema validator also rejects minItems/maxItems above 1.
 */
export const MODEL_FABLE = "claude-fable-5-1"
