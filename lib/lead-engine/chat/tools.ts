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
//   * `book_consult` READS the free consultation times from the booking
//     provider and puts them on screen as buttons, each a link to that time's
//     booking page. It books nothing: the provider's own page does, on the
//     visitor's own click, and the booking reaches this app through a signed
//     webhook the model has no way to call. The provider exposes a
//     booking-creation endpoint; it is deliberately not imported here, and the
//     source test below would fail if it were.
//
//     ONE WRITE IS TRANSITIVELY REACHABLE FROM THIS TOOL, and it is named here
//     rather than left for someone to find. Since G19b the calendar is
//     resolved per tenant, so `book_consult` reaches
//     `accessTokenForConnection`, which may refresh that coach's Calendly
//     access token and record `last_error` on their own
//     `coach_calendar_connections` row. That is an infrastructure side effect
//     of USING the connection — identical to what every other caller of it
//     does — and the model cannot steer it: `book_consult` takes no arguments,
//     and the business is the conversation's own, resolved server-side. It
//     touches no contact, no consent row, no lead and no money, which is what
//     the forbidden-import list below actually guards.
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

import { CalendlyUnavailable, listAvailableTimes, type Slot } from "@/lib/calendly/client"
import { calendlyBookingOfferForBusiness, type CalendlyBookingOffer } from "@/lib/calendly/config-for-business"
import { schedulingLink } from "@/lib/calendly/links"
import { encodeTracking, type ClickTracking } from "@/lib/calendly/tracking"
import { NO_EVENTS_SCHEDULED } from "@/lib/lead-engine/chat/constants"
import {
  emptyFactSet,
  formatSlotLabel,
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

/** The most free times one turn puts on screen. A week of a consult calendar can hold dozens; six is a choice, not a list. */
export const MAX_SLOTS_SHOWN = 6

/** How far ahead the booking lookup reaches. The provider caps one read at seven days. */
const SLOT_WINDOW_DAYS = 7
const DAY_MS = 86_400_000

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
  return card?.kind === "capture" || card?.kind === "consult" || card?.kind === "slots"
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
export function withWayForward(cards: Card[], href: string = CONSULT_PATH): Card[] {
  if (cards.some(isWayForward)) return cards
  return [...cards, { kind: "consult", href }]
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
  /** The booking page. `href` is `CONSULT_PATH` until a booking provider is configured, then the provider's page with the visitor's details prefilled. */
  | { kind: "consult"; href: string }
  /**
   * Free consultation times, each a link to the booking page for that time.
   * Every field is a server-read value: the instants came back from the
   * provider, the hrefs are built here, the zone is the business's setting.
   */
  | { kind: "slots"; timezone: string; href: string; slots: Array<{ startAt: string; href: string }> }

/** Everything one turn's tool calls produced, for the route to act on after the reply has been checked. */
export type ToolOutcome = {
  facts: Fact[]
  cards: Card[]
  wantsCapture: boolean
  wantsEscalate: boolean
  escalateSummary?: string
}

/**
 * What the route knows about this turn that the model must not be asked for.
 *
 * `visitor` is the contact the details card created — read by the route from
 * the conversation's `contact_id`, NEVER taken from a tool argument, because a
 * model-authored email in the prefill would send the booking confirmation to
 * whoever a prompt injection named. `tracking` is the visitor's attribution
 * (click ids) so the booking can fire the ads conversion. `timezone` is the
 * business's, the same one the system prompt tells the model to speak in.
 * `businessId` is the conversation's own tenant, threaded into all four
 * retrieval tools: `list_camps_and_clinics` filters events on it, and
 * `search_faqs`, `list_programmes` and `list_testimonials` hand it to readers
 * whose tables have no tenant column, so they answer only the platform
 * business — see `listPublicEvents` and `servesPlatformRows` in `facts.ts`.
 * `availability` and `now` are injection points for tests.
 */
export type ExecutorContext = {
  timezone?: string | null
  visitor?: { name: string | null; email: string | null } | null
  tracking?: Partial<ClickTracking> | null
  businessId?: string
  availability?: typeof listAvailableTimes
  now?: () => Date
}

export type ToolExecutor = {
  execute(name: string, input: Record<string, unknown>): Promise<string>
  outcome(): ToolOutcome
  /**
   * Where the server-added way forward should point when the turn produced
   * none: this tenant's own booking page with prefill when it has one,
   * `CONSULT_PATH` otherwise.
   *
   * A METHOD RATHER THAN A FIELD ON `ToolOutcome`, because the answer is now a
   * database read rather than four environment variables. The route awaits it
   * only in the branch that actually adds the card — once per conversation —
   * so a turn that never mentions booking never pays for the lookup. It shares
   * `book_consult`'s single per-turn resolution, so the way-forward link and
   * the tool's own cards cannot disagree about whose calendar this is.
   */
  consultHref(): Promise<string>
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
  book_consult: "Checking which consultation times are free",
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
      "Look up the free consultation times for the coming week and put them on screen as buttons the visitor can click, together with a link to the booking page. You cannot book anything yourself; this hands the visitor over. Call it whenever a consultation comes up, before you write the sentence that mentions one. If it finds no free times, or can only offer the link, it will say so — repeat that plainly.",
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

/** A provider page is configured but availability could not be READ. Says nothing about times, because nothing is known about them. */
const CONSULT_LINK_UNAVAILABLE_RESULT =
  "A link to the booking page is now on screen; the free times could not be checked just now, so do not mention any time or say whether times are available. Nothing has been booked and you cannot book anything yourself. Tell the visitor the link is there and that they can pick a time on that page."

/** Availability WAS read and there is nothing free in the window. A real answer, different from the one above. */
const CONSULT_LINK_NO_SLOTS_RESULT =
  "There are no free consultation times in the next seven days. A link to the booking page is now on screen so the visitor can look further ahead. Say plainly that nothing is free this week, and that the link is there. Nothing has been booked and you cannot book anything yourself."

/** Said with the list of free times, so the model points at the buttons instead of retyping the whole list. */
const SLOTS_NOTE =
  "These free times are already on screen as buttons beside your reply. Each button opens the booking page for that exact time with the visitor's details filled in. Tell the visitor to pick one; you may name the FIRST time exactly as written above and no other. Nothing is booked until they finish on that page, and you cannot book it for them."

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
    case "slot":
      // Slots reach the screen as ONE `slots` card built by the tool, not one card per time.
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
export function createToolExecutor(ctx: ExecutorContext = {}): ToolExecutor {
  let factSet: FactSet = emptyFactSet()
  const cards: Card[] = []
  const cardKeys = new Set<string>()
  let wantsCapture = false
  let wantsEscalate = false
  let escalateSummary: string | undefined

  const tracking = encodeTracking(ctx.tracking ?? {})
  const prefill = ctx.visitor ?? null
  const timezone = ctx.timezone?.trim() || "UTC"
  const now = ctx.now ?? (() => new Date())
  const availability = ctx.availability ?? listAvailableTimes
  const executorBusinessId = ctx.businessId

  /**
   * The conversation's tenant, for a lookup that must not run without one.
   *
   * Thrown, not silently substituted with the platform's own tenant: a turn
   * with no resolved businessId is a wiring bug in the caller, and answering
   * with someone else's camps, FAQs, programmes or testimonials would be the
   * exact leak this parameter exists to close. `book_consult` is the one tool
   * that degrades instead, because it has a safe answer to fall back to: the
   * plain consult page.
   */
  function tenantFor(tool: string): string {
    if (!executorBusinessId) throw new Error(`[chat-tools] ${tool} called without ctx.businessId`)
    return executorBusinessId
  }

  /**
   * WHOSE CALENDAR THIS TURN OFFERS. Resolved from the conversation's own
   * tenant, ONCE per turn — a second `book_consult` call must land on the same
   * link the first one did, and two lookups for one person can disagree.
   *
   * LAZY ON PURPOSE, and it is not a micro-optimisation. Resolving eagerly
   * would put two database reads and a possible OAuth token refresh in front
   * of every chat turn, including "what do you charge?" — and
   * `accessTokenForConnection` THROWS on a dead grant, so one coach's lapsed
   * Calendly would 500 their whole assistant rather than degrading the one
   * tool that needs it.
   *
   * A FAILED READ FALLS BACK TO `CONSULT_PATH`, NOT TO THE ENVIRONMENT. The
   * rule `calendlyBookingOfferForBusiness` enforces is that a could-not-read
   * must never become somebody else's calendar; it is free to become NOBODY's.
   * So the throw is caught here, loudly, and the visitor still gets a page to
   * go to — which is what this tool's "never throws for a provider fault"
   * contract has always promised.
   */
  let offerPromise: Promise<CalendlyBookingOffer> | null = null
  function resolveOffer(): Promise<CalendlyBookingOffer> {
    offerPromise ??= (async (): Promise<CalendlyBookingOffer> => {
      if (!executorBusinessId) {
        // Fails CLOSED. A turn with no tenant cannot be shown to belong to
        // anyone, and the one unsafe answer is the platform's calendar.
        console.warn("[chat-tools] book_consult has no ctx.businessId — offering the plain consult path")
        return { config: null, schedulingUrl: null }
      }
      try {
        return await calendlyBookingOfferForBusiness(executorBusinessId)
      } catch (err) {
        console.error(
          `[chat-tools] book_consult: could not resolve the calendar for business ${executorBusinessId} (${(err as Error).message})`,
        )
        return { config: null, schedulingUrl: null }
      }
    })()
    return offerPromise
  }

  /** The link every consult card in this turn points at, prefilled and tracked. */
  function linkFor(offer: CalendlyBookingOffer): string {
    return offer.schedulingUrl ? schedulingLink(offer.schedulingUrl, { prefill, tracking }) : CONSULT_PATH
  }

  /** See `ToolExecutor.consultHref`. Shares `book_consult`'s one resolution for the turn. */
  async function consultHref(): Promise<string> {
    return linkFor(await resolveOffer())
  }

  /**
   * The booking hand-over, in three honest shapes:
   *   slots available  → a `slots` card, slot facts (so the times are grounded), the times in the result
   *   nothing free     → a `consult` card and copy that says so
   *   could not read   → a `consult` card and copy that says nothing about times
   * Never throws for a provider fault: the fallback link must still reach the screen.
   */
  async function bookConsult(): Promise<string> {
    const offer = await resolveOffer()
    // Named `href` rather than `consultHref` so it cannot be mistaken for — or
    // shadow — the executor's own accessor of that name a few lines up.
    const href = linkFor(offer)

    if (!offer.schedulingUrl) {
      pushCard({ kind: "consult", href: CONSULT_PATH })
      return CONSULT_CARD_RESULT
    }
    if (!offer.config) {
      pushCard({ kind: "consult", href })
      return CONSULT_LINK_UNAVAILABLE_RESULT
    }
    const providerConfig = offer.config

    const from = now()
    const to = new Date(from.getTime() + SLOT_WINDOW_DAYS * DAY_MS)
    let slots: Slot[]
    try {
      slots = await availability({
        eventTypeUri: providerConfig.eventTypeUri,
        from,
        to,
        apiToken: providerConfig.apiToken,
        apiBase: providerConfig.apiBase,
      })
    } catch (err) {
      if (!(err instanceof CalendlyUnavailable)) throw err
      // Logged loudly: a caught provider fault nobody prints is a silent
      // downgrade to "link only" that reads, from outside, like a design choice.
      console.error(`[chat-tools] book_consult: availability unreadable (${err.reason}${err.status ? ` ${err.status}` : ""})`)
      pushCard({ kind: "consult", href })
      return CONSULT_LINK_UNAVAILABLE_RESULT
    }

    if (slots.length === 0) {
      pushCard({ kind: "consult", href })
      return CONSULT_LINK_NO_SLOTS_RESULT
    }

    const shown = slots.slice(0, MAX_SLOTS_SHOWN)
    // The facts are what ground the times. Without this the assistant naming
    // the first slot is an ungrounded date and the turn is thrown away.
    absorb(shown.map((slot) => ({ kind: "slot" as const, startAt: slot.startAt, timezone })))
    pushCard({
      kind: "slots",
      timezone,
      href,
      slots: shown.map((slot) => ({ startAt: slot.startAt, href: schedulingLink(slot.schedulingUrl, { prefill, tracking }) })),
    })
    return JSON.stringify({
      free_times: shown.map((slot) => formatSlotLabel(slot.startAt, timezone)),
      timezone,
      note: SLOTS_NOTE,
    })
  }

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
        const facts = absorb(await searchPublicFaqs(tenantFor(name), query, pageKey ?? undefined))
        return facts.length === 0 ? NO_FAQ_MATCH : results(facts)
      }

      case "list_programmes": {
        const facts = absorb(await listPublicProgrammes(tenantFor(name)))
        return facts.length === 0 ? NO_PROGRAMMES_LISTED : results(facts)
      }

      case "list_camps_and_clinics": {
        const facts = absorb(await listPublicEvents(tenantFor(name)))
        // Zero published events is the COMMON path in this corpus, not an edge
        // case, so the empty answer is designed copy rather than an empty array
        // the model has to interpret.
        return facts.length === 0 ? NO_EVENTS_SCHEDULED : results(facts)
      }

      case "list_testimonials": {
        const facts = absorb(await listPublicTestimonials(tenantFor(name)))
        return facts.length === 0 ? NO_TESTIMONIALS : results(facts)
      }

      case "capture_lead": {
        wantsCapture = true
        pushCard({ kind: "capture", reason: optionalString(input.reason) })
        return CAPTURE_CARD_RESULT
      }

      case "book_consult":
        return bookConsult()

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

  return { execute, outcome, consultHref }
}
