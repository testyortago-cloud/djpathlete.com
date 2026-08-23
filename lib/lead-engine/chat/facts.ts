// lib/lead-engine/chat/facts.ts — THE PRIVACY BOUNDARY of the chat assistant.
//
// Everything the assistant is allowed to know comes from this file, and every
// accessor here is PUBLIC-ONLY BY CONSTRUCTION. It is the only reader the chat
// tools get, and it deliberately does not go through the general data-access
// layer.
//
// WHY IT REFUSES THE CONVENIENT FUNCTION. `programs` carries TWO independent
// visibility columns, `is_active` and `is_public`, and the obvious accessor —
// `getPrograms()` — filters on `is_active` ALONE. Measured against the dev
// clone: 40 rows are active, and exactly ONE of those is also public. The
// other 39 are individual clients' personal training plans, named after the
// athletes, each with what that client paid. An assistant wired to the obvious
// accessor would read a named client's plan and price out to any anonymous
// visitor on the internet. That is a privacy incident, not a "quoted an
// unpublished programme" nit, and it is the reason this file exists at all.
//
// So: `.eq("is_active", true).eq("is_public", true)`. BOTH. Deleting either
// one fails `__tests__/lib/lead-engine/chat-facts.test.ts`, whose Supabase
// mock actually applies the filters the query asks for — a mock that handed
// back canned rows regardless would pass with the bug present, which is the
// whole failure mode.
//
// The same care applies to every other table read here, because "visible to an
// admin" and "visible to a stranger" are different questions everywhere:
// `faqs.status = 'published'`, `events.status = 'published'` (and not yet
// ended), `testimonials.is_active = true`.
//
// NO BRAND NAMES. This directory is swept by
// `__tests__/lib/lead-engine/no-brand-literals.test.ts`, comments included, so
// business identity arrives as a `BusinessSettings` parameter.
import { createServiceRoleClient } from "@/lib/supabase"

// The page registry, NOT a data-access layer: a pure list of the marketing
// routes that exist, with no I/O of its own. It is imported because an FAQ's
// visibility is not `status='published'` alone — see PUBLIC_FAQ_PAGE_KEYS.
import { STATIC_FAQ_PAGES } from "@/lib/faq/pages"

// Type-only: erased at compile time, so no data-access module is pulled in at
// runtime by naming this type.
import type { BusinessSettings } from "@/lib/db/businesses"

export type Fact =
  | { kind: "faq"; question: string; answer: string; pageKey: string }
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
  | { kind: "testimonial"; quote: string; author: string }

/**
 * The typed facts one conversation's lookups have returned so far, plus every
 * value from them the output validator will accept in a reply.
 *
 * `groundedValues` here covers ONLY what the lookups returned. The business's
 * own details (address, sender number, opening hours) are added by
 * `groundedValuesFor(set.facts, settings)`, which the route calls immediately
 * before validating — see that function's note.
 */
export type FactSet = { facts: Fact[]; groundedValues: string[] }

/** How many FAQ rows one lookup may hand the model. 126 published rows would be ~11,900 tokens. */
const MAX_FAQ_RESULTS = 6

/** Same reasoning for testimonials, which are long prose and rarely need more than a couple. */
const MAX_TESTIMONIALS = 6

/** Words this short carry no signal for ranking and match almost every row. */
const MIN_QUERY_TERM_CHARS = 3

/**
 * THE PAGE KEYS A STRANGER CAN ACTUALLY OPEN.
 *
 * `status = 'published'` is not the site's visibility rule for an FAQ — it is
 * only half of it. An FAQ row is visible exactly on the ONE page its
 * `page_key` names, and `lib/validators/faq.ts` admits `event/<id>` keys
 * alongside the static routes. Events have their own `status`, and the dev
 * clone holds three DRAFT ones: a published FAQ hung off an unannounced camp
 * is invisible everywhere on the site, and reading it out here would announce
 * the camp to any anonymous visitor.
 *
 * So retrieval is scoped to the static marketing routes, which are public by
 * construction. Event FAQs are excluded outright rather than joined against
 * `events.status`: the assistant already learns about published camps through
 * `listPublicEvents()`, so nothing answerable is lost, and a second visibility
 * rule that has to agree with a first one is the failure mode this whole file
 * exists to avoid.
 */
const PUBLIC_FAQ_PAGE_KEYS: string[] = STATIC_FAQ_PAGES.map((p) => p.key)
const PUBLIC_FAQ_PAGE_KEY_SET = new Set(PUBLIC_FAQ_PAGE_KEYS)

/**
 * The ONE spelling every value is compared in, on BOTH sides of the validator.
 * Lower-cased, `$` and thousands commas stripped, trimmed — so `$1,200`, `1200`
 * and `$1200` are one value rather than three near-misses.
 *
 * Exported because the output validator must normalise the reply's numbers the
 * identical way. Two copies of this rule that drift apart would show up as the
 * assistant being blocked for quoting a price it read out of the database.
 */
export function normalise(value: string): string {
  return value.toLowerCase().replace(/[$,]/g, "").trim()
}

function getClient() {
  return createServiceRoleClient()
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v.length > 0)))
}

/**
 * Every digit run in a piece of free text, so a number the database itself
 * wrote — a price inside an FAQ answer, "6" inside a programme's name — counts
 * as grounded when the assistant repeats it. Without this the assistant would
 * be blocked for quoting its own source material back accurately.
 */
function numericTokens(text: string): string[] {
  return normalise(text).match(/\d+(?:\.\d+)?/g) ?? []
}

/** Every spelling of a price a model might reasonably write, from the one integer the column holds. */
function moneyForms(cents: number | null): string[] {
  if (cents == null) return []
  const dollars = cents / 100
  const forms = [dollars.toFixed(2), `$${dollars.toFixed(2)}`]
  // THE WHOLE-DOLLAR FORM IS ONLY EMITTED FOR A WHOLE-DOLLAR PRICE. It used to
  // be `String(Math.round(dollars))`, unconditionally — so a 7950-cent
  // programme grounded "80", and an assistant answering "It's $80." for a
  // $79.50 programme passed the validator with a price the database never
  // held. Every price fixture in this branch happened to be a round number of
  // dollars, which is exactly why no test could see it.
  if (cents % 100 === 0) {
    const whole = String(cents / 100)
    forms.push(whole, `$${whole}`)
  }
  // The RAW CENTS FORM IS DELIBERATELY ABSENT. Seeding "7900" here would ground
  // the literal string 7900, so an assistant writing "$7900" for a $79.00
  // programme would pass the validator — a hundredfold error reading as a
  // database-backed fact. No model writes a price in cents, so nothing
  // legitimate is lost by leaving it out.
  return forms
}

/**
 * Likewise for a date. UTC throughout, deliberately: the stored instant is the
 * fact, and re-reading it in the server's local zone could ground a day that is
 * one off from the one the card shows.
 */
function dateForms(iso: string): string[] {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return []
  const month = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" })
  const short = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })
  const day = String(d.getUTCDate())
  const year = String(d.getUTCFullYear())
  // Every shape below is a form a model actually writes. UNDER-GENERATING HERE
  // MAKES THE VALIDATOR BLOCK THE TRUTH: the reply is recognised as carrying a
  // date, no grounded form matches it, and an accurate answer is discarded as a
  // fabrication. The last three were added after exactly that — "Sept. 1",
  // "1 September 2026" and "9/1/2026" were all being reported as ungrounded
  // dates for a camp whose start date the tools had just returned.
  const m = String(d.getUTCMonth() + 1)
  const forms = [
    iso,
    iso.slice(0, 10),
    `${month} ${day}`,
    `${short} ${day}`,
    `${day} ${month}`,
    `${month} ${day}, ${year}`,
    `${day} ${month} ${year}`,
    `${m}/${day}/${year}`,
    day,
    year,
  ]
  // "Sept" IS SEPTEMBER'S ALONE. It was emitted for every month, so a camp on
  // 24 July grounded "sept 24" — and an assistant writing "The camp starts
  // Sept 24" sailed through the validator while the card beside it said 24
  // July. Over-generating here is not the harmless direction after all: an
  // extra form does not merely fail to block a fabrication, it MANUFACTURES a
  // grounded value for a date the database never held.
  if (d.getUTCMonth() === 8) forms.push(`Sept ${day}`)
  return forms
}

/**
 * Numerals the VISITOR put into the conversation, which the output validator
 * accepts back in the reply — for the bare-numeral rule and nothing else.
 *
 * Echoing a fact the visitor just supplied is not a fabrication; it is the most
 * ordinary thing a conversation does. A real blocked turn: the visitor said
 * "my son is 14", asked what ages are coached, and the honest reply — "what's
 * available for 14-year-olds" — was discarded whole as ungrounded_number 14.
 *
 * THE LIMIT IS THE POINT. A visitor can supply their child's age. They cannot
 * supply your prices or your dates: "I heard it's $500" followed by "so how
 * much is it?" must not make $500 a grounded answer. So any digit run the
 * visitor wrote in a currency or date shape is DROPPED here, and the validator
 * additionally keeps these values away from its currency, date and percentage
 * rules — two independent guards, because this one is the easy one to defeat
 * by rephrasing.
 */
export function visitorNumerals(messages: string[]): string[] {
  const out: string[] = []
  for (const message of messages) {
    // Blank out anything currency- or date-shaped BEFORE reading the digits,
    // so "$500", "500 dollars", "9/1/2026" and "2026-09-01" contribute nothing.
    const cleaned = message
      .replace(/[$£€]\s?\d[\d,]*(?:\.\d{1,2})?/g, " ")
      .replace(/\d[\d,]*(?:\.\d{1,2})?\s*(?:dollars?|bucks?|usd|quid|euros?|pounds?|grand|k)\b/gi, " ")
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
      .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
      .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi, " ")
      .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/gi, " ")
    out.push(...numericTokens(cleaned))
  }
  return unique(out)
}

/**
 * Published FAQs only, ranked in JS by plain term overlap and capped.
 *
 * LEXICAL ON PURPOSE. 126 rows do not need a vector store, and a similarity
 * score cannot be asserted in a test the way a term match can. A query that
 * overlaps nothing returns `[]` rather than the first six rows: handing the
 * model unrelated FAQs is how an assistant ends up answering a question with
 * something that merely sounds adjacent.
 *
 * `pageKey` narrows to one page's set. "Services" in the brief is not a table
 * in this app — it is FAQ content under the `services/*` and `athletes/*` page
 * keys, which is why retrieval is page-key aware at all.
 */
export async function searchPublicFaqs(query: string, pageKey?: string): Promise<Fact[]> {
  // A caller naming a key the public cannot open gets nothing, rather than the
  // whole published set — narrowing a request must never widen the answer.
  if (pageKey && !PUBLIC_FAQ_PAGE_KEY_SET.has(pageKey)) return []

  const supabase = getClient()
  let q = supabase.from("faqs").select("question, answer, page_key").eq("status", "published")
  if (pageKey) q = q.eq("page_key", pageKey)
  const { data, error } = await q.order("sort_order", { ascending: true })
  if (error) throw new Error(`searchPublicFaqs: ${error.message}`)

  const terms = unique(
    normalise(query)
      .split(/[^a-z0-9.]+/)
      .filter((t) => t.length >= MIN_QUERY_TERM_CHARS),
  )
  // THE GATE. Applied to the rows that came back rather than pushed into the
  // query: `page_key` is the only column that carries the rule, the list is
  // short, and a filter here is the one every caller passes through — the
  // unscoped lookup included, which is the one that would otherwise sweep up
  // an unannounced camp's FAQ.
  const rows = (data ?? [])
    .filter((r) => PUBLIC_FAQ_PAGE_KEY_SET.has((r as { page_key: string }).page_key))
    .map((r) => r as { question: string; answer: string; page_key: string })

  const scored = rows.map((row) => {
    const question = normalise(row.question)
    const answer = normalise(row.answer)
    // A hit in the question is worth more than a hit in the answer: the
    // question is what the visitor is actually asking.
    let score = 0
    for (const term of terms) {
      if (question.includes(term)) score += 2
      if (answer.includes(term)) score += 1
    }
    return { row, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FAQ_RESULTS)
    .map(({ row }) => ({
      kind: "faq" as const,
      question: row.question,
      answer: row.answer,
      pageKey: row.page_key,
    }))
}

/**
 * Programmes a stranger is allowed to hear about: active AND public.
 *
 * BOTH FILTERS OR NEITHER. See this file's header — `is_active` alone returns
 * 39 named clients' personal plans and their prices.
 */
export async function listPublicProgrammes(): Promise<Fact[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("programs")
    .select("name, price_cents, duration_weeks, sessions_per_week, payment_type")
    .eq("is_active", true)
    .eq("is_public", true)
    .order("name", { ascending: true })
  if (error) throw new Error(`listPublicProgrammes: ${error.message}`)

  const rows = (data ?? []) as Array<{
    name: string
    price_cents: number | null
    duration_weeks: number
    sessions_per_week: number
    payment_type: string
  }>
  return rows.map((row) => ({
    kind: "programme" as const,
    name: row.name,
    priceCents: row.price_cents,
    durationWeeks: row.duration_weeks,
    sessionsPerWeek: row.sessions_per_week,
    paymentType: row.payment_type,
  }))
}

/**
 * Published camps and clinics that have not finished yet.
 *
 * Filtered on `end_date`, not `start_date`, matching what the marketing site
 * already shows: an event is "upcoming" until it ENDS, so a camp stays
 * answerable during its own session instead of vanishing at the start time.
 *
 * `spotsLeft` and `soldOut` are COMPUTED HERE from capacity and signups. The
 * assistant is never asked to do arithmetic about availability, because a
 * number it worked out itself is a number nothing can check.
 */
export async function listPublicEvents(): Promise<Fact[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("events")
    .select("title, type, start_date, end_date, location_name, price_cents, capacity, signup_count")
    .eq("status", "published")
    .gte("end_date", new Date().toISOString())
    .order("start_date", { ascending: true })
  if (error) throw new Error(`listPublicEvents: ${error.message}`)

  const rows = (data ?? []) as Array<{
    title: string
    type: string
    start_date: string
    end_date: string | null
    location_name: string
    price_cents: number | null
    capacity: number
    signup_count: number
  }>
  return rows.map((row) => {
    const spotsLeft = Math.max(0, (row.capacity ?? 0) - (row.signup_count ?? 0))
    return {
      kind: "event" as const,
      title: row.title,
      type: row.type,
      startDate: row.start_date,
      endDate: row.end_date,
      locationName: row.location_name,
      priceCents: row.price_cents,
      capacity: row.capacity,
      spotsLeft,
      soldOut: spotsLeft === 0,
    }
  })
}

/** Active testimonials only — the same gate the public site renders behind. */
export async function listPublicTestimonials(): Promise<Fact[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("testimonials")
    .select("quote, name")
    .eq("is_active", true)
    .order("display_order", { ascending: true })
  if (error) throw new Error(`listPublicTestimonials: ${error.message}`)

  const rows = (data ?? []) as Array<{ quote: string; name: string }>
  return rows.slice(0, MAX_TESTIMONIALS).map((row) => ({
    kind: "testimonial" as const,
    quote: row.quote,
    author: row.name,
  }))
}

/**
 * The values one fact legitimises, in every form a model might write them.
 * Kept separate from the settings half below so the two can never disagree
 * about what a fact grounds.
 */
function valuesForFact(fact: Fact): string[] {
  switch (fact.kind) {
    case "faq":
      // The row's own prose is the source, so a number inside it is grounded.
      return [...numericTokens(fact.question), ...numericTokens(fact.answer)]
    case "programme":
      return [
        ...moneyForms(fact.priceCents),
        String(fact.durationWeeks),
        String(fact.sessionsPerWeek),
        ...numericTokens(fact.name),
      ]
    case "event":
      return [
        ...moneyForms(fact.priceCents),
        ...dateForms(fact.startDate),
        ...(fact.endDate ? dateForms(fact.endDate) : []),
        String(fact.capacity),
        String(fact.spotsLeft),
        ...numericTokens(fact.title),
        ...numericTokens(fact.locationName),
      ]
    case "testimonial":
      return numericTokens(fact.quote)
  }
}

/**
 * Values the system prompt hands the assistant about the business itself.
 * Without these it could not state its own address or opening hours without
 * the validator calling them fabrications — the prompt would be feeding it
 * numbers no lookup returned.
 */
function valuesForSettings(settings: BusinessSettings): string[] {
  return [
    settings.postal_address,
    ...numericTokens(settings.postal_address ?? ""),
    settings.sms_sender_phone,
    ...numericTokens(settings.sms_sender_phone ?? ""),
    // A phone number is read aloud in groups but stored as one run, so ground
    // the digits-only spelling too.
    (settings.sms_sender_phone ?? "").replace(/\D/g, ""),
    settings.timezone,
    String(settings.quiet_hours_start),
    String(settings.quiet_hours_end),
  ]
    .filter((v): v is string => typeof v === "string" || typeof v === "number")
    .map((v) => normalise(String(v)))
}

/**
 * Every value the output validator will accept in this turn's reply.
 *
 * THE ORDER OF OPERATIONS MATTERS. `FactSet.groundedValues` covers only what
 * the lookups returned, because `mergeFacts` has no business settings to hand.
 * The route calls THIS function with `set.facts` and the settings it already
 * loaded, immediately before validating, and that returned list is the one the
 * validator sees. Both paths run through `valuesForFact`, so a fact can never
 * ground one thing here and another thing there.
 */
/**
 * Money-shaped values ONLY, for the validator's currency rule.
 *
 * WHY THIS IS SEPARATE FROM `groundedValuesFor`. That list is deliberately
 * permissive: it carries every digit run found in an FAQ answer or a
 * testimonial, so the assistant is not blocked for quoting its own source
 * material. That is right for counting things and wrong for prices, because a
 * published FAQ answer contains numbers that are not money — a street number, a
 * postcode, a phone number, a year.
 *
 * Observed in a real captured turn: the grounded values included `6585` and
 * `33541`, the street number and postcode out of a "where do you train?" FAQ.
 * A reply saying "it's $6585" would have passed the currency rule on the
 * strength of an address. That is a fabricated price wearing the authority of a
 * database-backed fact, which is the one thing §4.3 exists to make impossible.
 *
 * So money comes from money: a `price_cents` column, or an amount that was
 * written AS money in the prose (`$79`, `79 dollars`). A bare number in an FAQ
 * still grounds a count; it no longer grounds a price.
 */
function moneyTokensInProse(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)) out.push(...moneyFormsFromAmount(m[1]))
  for (const m of text.matchAll(/\b([\d,]+(?:\.\d{1,2})?)\s*(?:dollars?|usd)\b/gi)) {
    out.push(...moneyFormsFromAmount(m[1]))
  }
  return out
}

/** Every spelling of an amount already written in dollars. */
function moneyFormsFromAmount(raw: string): string[] {
  const value = Number(raw.replace(/,/g, ""))
  if (!Number.isFinite(value)) return []
  return moneyForms(Math.round(value * 100))
}

function moneyValuesForFact(fact: Fact): string[] {
  switch (fact.kind) {
    case "faq":
      return [...moneyTokensInProse(fact.question), ...moneyTokensInProse(fact.answer)]
    case "programme":
    case "event":
      return moneyForms(fact.priceCents)
    case "testimonial":
      return moneyTokensInProse(fact.quote)
  }
}

/**
 * The ONLY values the validator's currency rule will accept. See
 * `moneyTokensInProse` for why this is not just a subset of
 * `groundedValuesFor`.
 */
export function groundedMoneyFor(facts: Fact[]): string[] {
  return unique(facts.flatMap(moneyValuesForFact).map(normalise))
}

export function groundedValuesFor(facts: Fact[], settings: BusinessSettings): string[] {
  return unique([...facts.flatMap(valuesForFact).map(normalise), ...valuesForSettings(settings)])
}

/**
 * A turn that has looked nothing up. Empty means EMPTY: no facts and nothing
 * grounded, so a reply carrying a number is blocked rather than waved through
 * on a value nobody retrieved.
 */
export function emptyFactSet(): FactSet {
  return { facts: [], groundedValues: [] }
}

/**
 * Fold a lookup's results into the conversation's fact set.
 *
 * Deduped on the whole fact, because a model asked twice about pricing calls
 * the same tool twice, and one programme listed three times would triple the
 * card list the visitor sees.
 */
export function mergeFacts(a: FactSet, b: Fact[]): FactSet {
  const seen = new Set(a.facts.map((f) => JSON.stringify(f)))
  const facts = [...a.facts]
  for (const fact of b) {
    const key = JSON.stringify(fact)
    if (seen.has(key)) continue
    seen.add(key)
    facts.push(fact)
  }
  return { facts, groundedValues: unique(facts.flatMap(valuesForFact).map(normalise)) }
}
