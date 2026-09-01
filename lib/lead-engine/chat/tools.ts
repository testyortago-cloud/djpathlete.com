// lib/lead-engine/chat/tools.ts — the seven tools the public chat assistant may
// call, and the executor that runs them.
//
// ─── NO TOOL THE MODEL CAN CALL HAS A WRITE PATH ─────────────────────────────
//
// This is the load-bearing property of the file, and it is a property of its
// CONSTRUCTION, not of a filter anybody has to maintain:
//
//   * The four retrieval tools read, and they read only through
//     `facts.ts` — the public-only accessors. They cannot reach a private row,
//     so no phrasing of a question can make them quote one.
//
//   * `capture_lead` DOES NOT CREATE A CONTACT. It puts a card on screen and
//     returns a sentence saying so. The visitor's own click on that rendered
//     form is what writes anything, through a separate route the model has no
//     way to call.
//
//   * `book_consult` returns a link. There is no public booking-creation route
//     in this app at all — every existing consultation call to action is a link
//     to the same page — so handing over is not a limitation, it is what the
//     repo already decided.
//
//   * `escalate` is the ONE tool that leads to a write, and it does not do it
//     here. It records an intent and a one-line summary; the route acts on that
//     AFTER the reply has passed the output validator. A turn that gets blocked
//     therefore emails nobody, which is the whole point of recording the intent
//     rather than acting on it.
//
// So a prompt injection that reaches a tool still cannot create a contact, file
// a consent row, or spend money. The same discipline as
// `app/api/funnels/preview-submit`, which writes nothing by construction — and
// pinned the same way: __tests__/lib/lead-engine/chat-tools.test.ts reads this
// source off disk and fails if a write helper is ever imported into it.
//
// NO BRAND NAMES. This directory is swept by
// __tests__/lib/lead-engine/no-brand-literals.test.ts, comments included.
//
// Spec: docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md §4.2, §5
import type Anthropic from "@anthropic-ai/sdk"

import { NO_EVENTS_SCHEDULED } from "@/lib/lead-engine/chat/constants"
import {
  emptyFactSet,
  listPublicEvents,
  listPublicProgrammes,
  listPublicTestimonials,
  mergeFacts,
  searchPublicFaqs,
  type Fact,
  type FactSet,
} from "@/lib/lead-engine/chat/facts"

/**
 * Where a consultation is actually arranged. Every existing consultation call
 * to action on the marketing site points here, so the assistant hands over to
 * the same place rather than inventing a second front door.
 */
export const CONSULT_PATH = "/contact"

/**
 * A typed value the server renders beside the reply.
 *
 * Prices, dates and availability reach the visitor THROUGH THESE, not through
 * prose the model typed — so the common path never needs the model to write a
 * digit, and therefore cannot carry a fabricated one. Money stays as the
 * integer number of cents the database holds; formatting is the renderer's job
 * and is done over that integer, never re-derived from a string.
 */
/**
 * The cards a VISITOR may be shown, from the cards that were persisted.
 *
 * *** THE ONE MODEL-AUTHORED STRING IN THIS FILE IS `capture.reason`. ***
 * Every other card field is a typed value this server read out of the database
 * — integer cents, ISO dates, a constant href. `reason` is different: it is a
 * tool ARGUMENT, so the model writes it, and `validateReply` never sees it
 * because the validator is given the assistant's TEXT and nothing else.
 *
 * That made it the one path where model prose reached the screen unchecked. A
 * prompt-injected `capture_lead(reason: "Lock in the $49/month launch rate —
 * guaranteed to add 10mph, offer ends July 1")` rendered under "Leave your
 * details" while the turn recorded `verdict: "ok"`, with no violation and no
 * audit row, because the assistant's own sentence was clean.
 *
 * It is redacted rather than validated, on the same principle as the rest of
 * this directory: a thing that cannot be expressed needs no filter maintaining.
 * The reason is still PERSISTED on the message row, where it is useful evidence
 * for whoever reads the transcript later — it simply never travels to a
 * visitor.
 */
export function visitorSafeCards(cards: Card[]): Card[] {
  return cards.map((card) => (card.kind === "capture" ? { ...card, reason: null } : card))
}

/**
 * A card the visitor can DO something with: the details form, or the link to
 * the page where a consultation is arranged. The other two kinds are read-only
 * — a price, a date — and leave the conversation where it was.
 */
function isWayForward(card: { kind?: unknown } | null | undefined): boolean {
  return card?.kind === "capture" || card?.kind === "consult"
}

/** Whether a turn already on the record put one of those on screen. Over the persisted JSON, so it is `unknown[]`. */
export function cardsOfferWayForward(cards: unknown[] | null | undefined): boolean {
  return Array.isArray(cards) && cards.some((card) => isWayForward(card as { kind?: unknown }))
}

/**
 * A CTA THE MODEL FORGOT TO ASK FOR.
 *
 * *** THIS IS A CONTROL, AND IT EXISTS BECAUSE THE PROMPT IS NOT ONE. ***
 * `book_consult` puts the only clickable next step on this surface, and the
 * model calls it unreliably: three real turns, three different outcomes — one
 * ending "would you like to book a consultation?" with nothing beside it to
 * book with, one calling `capture_lead` correctly, one asking a clarifying
 * question and offering nothing at all. Told plainly in the system prompt to
 * call the tool as it writes the offer, it still wrote the offer alone. A
 * visitor who has just been given an answer and an invitation, and has nothing
 * to click, is the whole feature failing at its last inch.
 *
 * So the way forward is not left to the model. When a turn produced neither
 * kind, the server adds the consultation link itself.
 *
 * WHY THIS IS SAFE TO ADD SERVER-SIDE. `consult` is the one card with no
 * model-authored field at all: its single value is `CONSULT_PATH`, a constant
 * three lines up. Adding it can no more put an unvalidated string on screen
 * than rendering the panel's own header can. Contrast `capture`, whose
 * `reason` the model writes — which is why THAT card is never conjured here,
 * only redacted above.
 *
 * The caller decides whether the conversation has had one already; this
 * function only answers "does THIS turn leave the visitor somewhere to go?".
 */
export function withWayForward(cards: Card[]): Card[] {
  if (cards.some(isWayForward)) return cards
  return [...cards, { kind: "consult", href: CONSULT_PATH }]
}

export type Card =
  | {
      kind: "programme"
      name: string
      priceCents: number | null
      durationWeeks: number
      sessionsPerWeek: number
      paymentType: string
    }
  | {
      kind: "event"
      title: string
      type: string
      startDate: string
      endDate: string | null
      locationName: string
      priceCents: number | null
      capacity: number
      spotsLeft: number
      soldOut: boolean
    }
  /** The details form. `reason` is the model's own words for why it asked, shown back to the visitor. */
  | { kind: "capture"; reason: string | null }
  | { kind: "consult"; href: string }

/** Everything one turn's tool calls produced, for the route to act on after the reply has been checked. */
export type ToolOutcome = {
  facts: Fact[]
  cards: Card[]
  wantsCapture: boolean
  wantsEscalate: boolean
  escalateSummary?: string
}

export type ToolExecutor = {
  execute(name: string, input: Record<string, unknown>): Promise<string>
  outcome(): ToolOutcome
}

/**
 * What the visitor is told is happening while a lookup runs.
 *
 * Written for the person asking the question, not for the person who built
 * this: no tool names, no jargon, and nothing that reads like an internal
 * operation. The widget shows one of these instead of streaming tokens,
 * because the turn cannot be streamed — it has to be validated whole first.
 */
export const TOOL_LABELS: Record<string, string> = {
  search_faqs: "Checking the questions people ask most",
  list_programmes: "Looking up what's on offer",
  list_camps_and_clinics: "Checking the camp and clinic schedule",
  list_testimonials: "Finding what other people have said",
  capture_lead: "Getting a short form ready for you",
  book_consult: "Finding the page where you can book",
  escalate: "Passing this to a person",
}

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_faqs",
    description:
      "Search the published questions and answers. Use this first for almost anything a visitor asks about how coaching works, what happens at a session, who it suits, or how to get started. Returns nothing when the question does not match anything published — which means you do not know the answer, not that you should guess it.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The visitor's question, in their own words.",
        },
        page_key: {
          type: "string",
          description:
            "Optional. Narrows the search to one part of the site, e.g. a services or athletes section key. Leave it out unless you already know the key.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_programmes",
    description:
      "List the coaching programmes offered to the public, with what each one costs, how many weeks it runs and how many sessions a week. Use this for any pricing question. The results appear on screen as cards.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_camps_and_clinics",
    description:
      "List the camps and clinics that are published and have not finished, with their dates, where they are, what they cost and how many places are left. Use it for anything about dates or availability. Often there are none scheduled, and saying so is a real answer.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_testimonials",
    description:
      "Get what past clients have said, so you can quote one accurately instead of paraphrasing from memory.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "capture_lead",
    description:
      "Put a short form on screen asking the visitor for their name and how to reach them. Use it when they want someone to get in touch, or when you could not answer and a person could. It saves nothing by itself — only the visitor's own click on the form does that.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "One short phrase for why you are asking, in words the visitor would recognise.",
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "book_consult",
    description:
      "Put a link on screen to the page where a consultation is arranged. You cannot book anything yourself; this hands the visitor over.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "escalate",
    description:
      "Hand the conversation to a person. Use it for an injury, pain or medical question, for a complaint, or for anything you are not confident about. Do not guess instead of using this.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "One sentence saying what the visitor asked and what they need.",
        },
      },
      required: ["summary"],
    },
  },
]

/** Said after a list of results, so the model points at the card instead of retyping the numbers into prose. */
const CARD_NOTE =
  "These are already on screen as cards beside your reply. Point the visitor at the card rather than repeating the numbers in your own sentence."

/**
 * A no-match lookup is a real answer, and it is NOT the same answer as a list
 * of vaguely adjacent rows. Saying so in words rather than returning `[]`
 * removes the reading where the model treats an empty array as permission to
 * fall back on what it happens to know.
 */
const NO_FAQ_MATCH =
  "Nothing in the published questions and answers matches that. You do not know the answer. Say so plainly and offer to put the visitor in touch with a person — do not answer it from your own knowledge."

const NO_PROGRAMMES_LISTED =
  "There are no programmes published right now. Say so plainly and offer to take the visitor's details so someone can talk them through the options."

const NO_TESTIMONIALS =
  "There are no testimonials published right now. Do not invent one, and do not describe what clients generally say."

const CAPTURE_CARD_RESULT =
  "A short form asking for the visitor's name and how to reach them is now on screen. Nothing has been saved and no record of them exists: only the visitor's own click on that form can create one. Tell them in one sentence what you have asked for and why, then stop — do not ask for their details again in your own words."

const CONSULT_CARD_RESULT = `A link to ${CONSULT_PATH}, the page where a consultation is arranged, is now on screen. Nothing has been booked and you cannot book anything yourself. Tell the visitor the link is there and what it is for.`

const ESCALATE_RESULT =
  "Noted. A person will be asked to pick this conversation up once your reply has been checked. Tell the visitor you have passed it on. Do not promise how soon anyone will reply, and do not promise it has already been sent."

/** Only the two kinds carrying numbers get a card; questions and quotes are prose the reply carries directly. */
function cardForFact(fact: Fact): Card | null {
  switch (fact.kind) {
    case "programme":
      return {
        kind: "programme",
        name: fact.name,
        priceCents: fact.priceCents,
        durationWeeks: fact.durationWeeks,
        sessionsPerWeek: fact.sessionsPerWeek,
        paymentType: fact.paymentType,
      }
    case "event":
      return {
        kind: "event",
        title: fact.title,
        type: fact.type,
        startDate: fact.startDate,
        endDate: fact.endDate,
        locationName: fact.locationName,
        priceCents: fact.priceCents,
        capacity: fact.capacity,
        spotsLeft: fact.spotsLeft,
        soldOut: fact.soldOut,
      }
    case "faq":
    case "testimonial":
      return null
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/**
 * One executor per turn. It accumulates the facts every lookup returned and the
 * cards the server will render, so the route can validate the finished reply
 * against exactly what was actually looked up — and nothing else.
 *
 * Deliberately a closure rather than a module-level accumulator: two visitors
 * are served by the same process, and a fact set shared between them would
 * ground one visitor's reply on another visitor's lookups.
 */
export function createToolExecutor(): ToolExecutor {
  let factSet: FactSet = emptyFactSet()
  const cards: Card[] = []
  const cardKeys = new Set<string>()
  let wantsCapture = false
  let wantsEscalate = false
  let escalateSummary: string | undefined

  function pushCard(card: Card): void {
    // A model asked twice about pricing calls the same tool twice; the visitor
    // should not see the same card three times.
    const key = JSON.stringify(card)
    if (cardKeys.has(key)) return
    cardKeys.add(key)
    cards.push(card)
  }

  /** Fold a lookup's results into the turn. Fact de-duplication is `mergeFacts`'s rule, borrowed rather than re-stated. */
  function absorb(facts: Fact[]): Fact[] {
    factSet = mergeFacts(factSet, facts)
    for (const fact of facts) {
      const card = cardForFact(fact)
      if (card) pushCard(card)
    }
    return facts
  }

  function results(facts: Fact[]): string {
    return JSON.stringify({ results: facts, note: CARD_NOTE })
  }

  async function execute(name: string, input: Record<string, unknown>): Promise<string> {
    switch (name) {
      case "search_faqs": {
        const query = optionalString(input.query) ?? ""
        const pageKey = optionalString(input.page_key)
        const facts = absorb(await searchPublicFaqs(query, pageKey ?? undefined))
        return facts.length === 0 ? NO_FAQ_MATCH : results(facts)
      }

      case "list_programmes": {
        const facts = absorb(await listPublicProgrammes())
        return facts.length === 0 ? NO_PROGRAMMES_LISTED : results(facts)
      }

      case "list_camps_and_clinics": {
        const facts = absorb(await listPublicEvents())
        // Zero published events is the COMMON path in this corpus, not an edge
        // case, so the empty answer is designed copy rather than an empty array
        // the model has to interpret.
        return facts.length === 0 ? NO_EVENTS_SCHEDULED : results(facts)
      }

      case "list_testimonials": {
        const facts = absorb(await listPublicTestimonials())
        return facts.length === 0 ? NO_TESTIMONIALS : results(facts)
      }

      case "capture_lead": {
        wantsCapture = true
        pushCard({ kind: "capture", reason: optionalString(input.reason) })
        return CAPTURE_CARD_RESULT
      }

      case "book_consult": {
        pushCard({ kind: "consult", href: CONSULT_PATH })
        return CONSULT_CARD_RESULT
      }

      case "escalate": {
        wantsEscalate = true
        // FIRST summary wins. Escalation is capped at one per conversation, and
        // a second call is the model repeating itself — the sentence written
        // when it decided to hand over is the honest description of why.
        if (escalateSummary === undefined) {
          const summary = optionalString(input.summary)
          if (summary) escalateSummary = summary
        }
        return ESCALATE_RESULT
      }

      default:
        // Thrown, not answered with an empty string: the tool loop turns this
        // into a failed-lookup tool result the model can respond to, whereas ""
        // would read as "the lookup found nothing", which is a different and
        // much worse answer to give a visitor.
        throw new Error(`Unknown chat tool: ${name}`)
    }
  }

  function outcome(): ToolOutcome {
    return {
      facts: factSet.facts,
      cards: [...cards],
      wantsCapture,
      wantsEscalate,
      escalateSummary,
    }
  }

  return { execute, outcome }
}
