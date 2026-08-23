// lib/lead-engine/chat/constants.ts — the numbers and the fixed sentences the
// public chat assistant is built around.
//
// NO BRAND NAMES ANYWHERE IN THIS DIRECTORY. Everything under
// `lib/lead-engine/` is swept by
// `__tests__/lib/lead-engine/no-brand-literals.test.ts`, comments included, so
// business identity is always a parameter read from `getBusinessSettings()` —
// never a string typed in here. The refusal copy below is written to work for
// any operator for exactly that reason.
//
// These are constants, not settings rows. A knob nobody has asked to turn is a
// knob somebody has to maintain, migrate and document; when one of these does
// need to vary per install it can graduate to `system_settings` then.
import { MODEL_HAIKU } from "@/lib/ai/models"

// Type-only, so nothing in the contacts DAL — least of all its write path —
// is pulled into this module at runtime. It buys one thing: if the source
// string is ever renamed in `ContactEventSource`, this stops compiling
// instead of silently filing chat leads under a source nothing reads.
import type { ContactEventSource } from "@/lib/db/contacts"

/**
 * The job is narrow — pick the right lookup, then write two honest sentences
 * about what came back — and `/api/ask` is UNAUTHENTICATED, which makes token
 * spend an attack surface rather than a line item. Haiku is the right size for
 * both facts.
 *
 * If the refusal suite ever fails against it, moving to `MODEL_SONNET` is a
 * one-line change here and nowhere else.
 */
export const CHAT_MODEL = MODEL_HAIKU

/**
 * The one `system_settings` key that turns the whole assistant on, per the
 * house per-feature convention. Default FALSE, and the default lives beside
 * the key so no caller can pick a different one: the launcher, `/ask` and both
 * API routes must agree, and a route that defaults to `true` while the widget
 * defaults to `false` is a public endpoint nobody knows is open.
 *
 * Off means 404, never 403 and never a redirect. `middleware.ts` covers only
 * `/admin/*` and `/client/*`, so these routes gate themselves, and a gate that
 * fails closed answers "there is nothing here".
 */
export const CHAT_ASSISTANT_FLAG = "chat_assistant_enabled"
export const CHAT_ASSISTANT_FLAG_DEFAULT = false

export const MAX_MESSAGES_PER_CONVERSATION = 20
export const MAX_TOKENS_PER_CONVERSATION = 40_000
export const MAX_CONVERSATIONS_PER_IP_PER_HOUR = 5
export const MAX_MESSAGES_PER_IP_PER_HOUR = 40
export const MAX_MESSAGE_CHARS = 1_000
export const MAX_TOOL_ROUNDS = 4
export const MAX_OUTPUT_TOKENS = 1_024

/** Already reserved in `ContactEventSource`, so the timeline can tell a chat lead from a form fill. */
export const CHAT_LEAD_SOURCE: ContactEventSource = "ai_chat"

/**
 * Shown INSTEAD OF the assistant's turn when the output validator rejects it —
 * a fabricated price, an invented date, a promised outcome. The whole turn is
 * discarded rather than retried: a retry that happens to come back clean hides
 * that the model tried to make something up, and that attempt is an
 * operational signal worth keeping.
 */
export const REFUSAL_BLOCKED =
  "I can't answer that accurately, and I'd rather say so than guess. Let me put you to a person who can help."

/** Returned before the model is called at all when the risk classifier sees an injury or medical question. */
export const REFUSAL_INJURY =
  "I'm not able to give advice about an injury or a medical question — that needs a qualified person who can actually assess you, not a chat window. I can put you in touch with the coaching team."

/**
 * "No camps scheduled" is the COMMON path here, not an edge case: the corpus
 * measured 0 published events against 126 published FAQs. Designed copy, so an
 * empty list reads as an answer rather than as a lookup that failed.
 */
export const NO_EVENTS_SCHEDULED =
  "There are no camps or clinics on the schedule right now. I can take your details and someone will let you know when the next one opens."
