// lib/funnels/sections/resolve.ts — CTA refs (names) -> real row ids.
//
// The AI NEVER writes a UUID. It writes a name: `{kind:"program",
// ref:"Comeback Code"}`. This module turns those names into the real row ids,
// on the server, against the real catalogue. It is the mechanism that makes a
// hallucinated id structurally impossible rather than merely unlikely.
//
// WHY THIS MATTERS MORE THAN IT LOOKS. `EventIsland.tsx:26-28` returns `null`
// for an unknown event id. So a PLAUSIBLE hallucinated UUID passes Zod, passes
// the compiler, and renders as nothing at all — silent absence, the worst
// possible failure for an owner who cannot read the DOM. Names can't be
// hallucinated into existence the same way: a name either matches a row this
// server can see, or it doesn't and we say so.
//
// Source of truth: docs/superpowers/plans/2026-08-10-ai-page-builder-sections.md
// §2 "CtaTarget" (lines 218-258, the name-not-id mechanism and its three
// outcomes) and §5's turn sequence step 6 ("Server resolves every CtaTarget
// ref; unresolved ones are recorded, not fatal").
//
// ---------------------------------------------------------------------------
// *** THE PUBLISH GATE READS `unresolved`, NEVER `compiled.ok`. ***
// ---------------------------------------------------------------------------
// Handoff recorded by the Stage 1.2 review: an unresolved CTA renders as a
// DISABLED PLACEHOLDER (render.ts's `disabledCta`) for every kind EXCEPT
// `session_pack` — `CheckoutIsland` ignores `productId` for that kind, so
// `renderCtaTarget`'s `session_pack` branch (render.ts:256-263) drops the
// invalid ref and falls back to a LIVE checkout island instead. That is
// correct behaviour, not a bug, but it means "renders as a disabled
// placeholder" is not a universal tell for "this CTA didn't resolve" — the
// only universal signal is `ResolveResult.unresolved` itself, which is
// exactly why THIS module, not the rendered markup, is the publish gate's
// source of truth. And a page full of disabled placeholders (the other
// three kinds) still compiles to `ok: true, warnings: []` regardless — the
// compiler has ZERO signal to give about any of this: `filterAttrs` drops
// bad attributes silently and a `<span role="button" aria-disabled>` is
// perfectly valid markup. So "can this page be published?" is answered by
// `ResolveResult.unresolved` and by nothing else. `publishGate()` below is
// that one call. A future reader who reaches for `compiled.ok` here will
// ship dead buy buttons on a green build.
// ---------------------------------------------------------------------------
//
// FOUR DESIGN DECISIONS THE PLAN DOES NOT MAKE, MADE HERE:
//
// 1. `resolveDoc` IS PURE AND TAKES THE CATALOGUES AS A PARAMETER. The DB call
//    lives in `loadCatalogues()`, which is deliberately trivial. Stages 1.1-1.4
//    are all pure and tested with ZERO mocks; that property is worth more than
//    the convenience of one fetch-and-resolve entry point.
//
// 2. RESOLUTION IS ID-MATCH-FIRST, then exact normalised name, then unique
//    substring. Rule 1 is not an optimisation — it is what makes this
//    IDEMPOTENT. By turn two the doc already holds real ids; without
//    id-match-first, re-resolving would try to match a uuid against a list of
//    names, find nothing, and mark a perfectly good button unresolved,
//    blocking publish forever.
//
//    And it is deliberately the CATALOGUE that decides, not a hand-rolled
//    `looksLikeUuid()`. This repo has already shipped that exact bug once, in
//    this very pipeline: Stage 1.2's GUID-shape regex waved through
//    `12345678-1234-1234-1234-123456789012`, which Zod v4's RFC-9562-strict
//    `.uuid()` rejects, triggering the fatal the guard existed to prevent.
//    Asking the catalogue is strictly stronger and needs no validator: a ref
//    equal to a live row's id is resolved, and a ref that WAS a real id but
//    whose row has since been deleted correctly comes back unresolved —
//    because that button now points at nothing.
//
// 3. `session_pack` REFS ARE RESOLVED LIKE THE OTHER TWO, even though
//    `CheckoutIsland` currently ignores `productId` for that kind and always
//    routes to /client/sessions. Resolving it costs nothing, keeps the three
//    ref-carrying kinds symmetric, and means the doc carries a real id if that
//    island ever starts using it.
//
// 4. THE WALK IS DERIVED, NOT TABULATED. `ctaWithLabelSchema` appears at four
//    places today (hero.primaryCta/secondaryCta, pricing.plans[i].cta, cta.cta,
//    footer.links[i]) — but a hardcoded list of four paths is a list that goes
//    stale, and a CTA site this module misses is a button that silently does
//    nothing on a live page with `ok: true, warnings: []` from the compiler.
//    So instead of a table, the walk descends `section.props` generically and
//    asks `ctaWithLabelSchema` — the registry's OWN schema — whether each node
//    it meets is a CTA site. A tenth section kind, or a fifth CTA slot on an
//    existing kind, is picked up with no change here. (Nothing else in the
//    registry has both a `label` and a schema-valid `target`, so this cannot
//    false-positive: `funnelFormFieldSchema` has a `label` but no `target`,
//    and `heroMediaSchema`'s `kind` values — image/youtube — are not in the
//    `CtaTarget` union.)
//
// REFERENCE IDENTITY. `applyOps` guarantees that sections the model did not
// name come through reference-identical. `resolveDoc` runs on the same doc on
// every turn, so it must not quietly undo that. Everything below is
// copy-on-write: a section with no ref to substitute is the SAME OBJECT in the
// output, and if NO section anywhere needs substitution the returned `doc` is
// literally the input `doc` (and `doc.sections` literally `doc.sections`).
//
// No model call, no network — `resolveDoc` is a pure function in, pure result
// out. `loadCatalogues` is the only thing here that touches the database.

import {
  ctaWithLabelSchema,
  sectionDocSchema,
  type CtaTarget,
  type CtaWithLabel,
  type Section,
  type SectionDoc,
} from "@/lib/funnels/sections/registry"
import { getPrograms } from "@/lib/db/programs"
// Aliased on import: `listActiveProducts` is ALSO exported by
// lib/db/shop-products.ts with a different row type. The unaliased name reads
// as "products" at the call site and is one autocomplete slip away from
// silently building the catalogue out of the shop. `listAllProducts` is
// aliased for the same reason and to keep the two pack calls visibly a PAIR at
// the call site — "all" vs "active" one line apart is the whole split.
import {
  listActiveProducts as listActiveSessionPackProducts,
  listAllProducts as listAllSessionPackProducts,
} from "@/lib/db/session-pack-products"
import { getEvents, getPublishedEvents } from "@/lib/db/events"

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

/**
 * The CtaTarget members that carry a `ref` needing resolution — DERIVED from
 * `CtaTarget` itself rather than restated as a literal union, so adding a
 * fourth ref-carrying target kind to the registry is a compile error here
 * (`Catalogue` gains a required key that `loadCatalogue` doesn't supply)
 * instead of a silently unresolved CTA.
 *
 * Today: "program" | "session_pack" | "event". `url` / `step` / `anchor` /
 * `booking` carry no `ref` and are left completely alone.
 */
export type ResolvableCtaKind = Extract<CtaTarget, { ref: string }>["kind"]

/** One selectable row, reduced to the two fields resolution needs. */
export interface CatalogueEntry {
  id: string
  name: string
}

/**
 * Rows a CTA could point at, one list per resolvable kind, FOR ONE PURPOSE.
 * Which purpose is decided by where it sits in `Catalogues` below — this type
 * deliberately does not know, so `prompt.ts`'s Block B can keep consuming a
 * single flat list (it renders the OFFER set, and nothing else).
 */
export type Catalogue = Record<ResolvableCtaKind, CatalogueEntry[]>

/**
 * THE TWO SETS. ONE NAME WAS ALWAYS TWO DIFFERENT QUESTIONS.
 *
 * Until Stage 1.7 there was a single `Catalogue`, used for two incompatible
 * jobs, and the conflation was a live bug rather than an inelegance:
 *
 *   - RECOGNITION — "is the id this page ALREADY COMMITTED TO still a real
 *     row?". Must see every row that ever existed. The moment a row leaves the
 *     "currently valid" set, a page that already references it stops
 *     resolving: rule 1 misses, the 36-char uuid then matches no name, and
 *     `publishGate.ok` flips to `false` on an OTHERWISE-UNTOUCHED page. The
 *     owner changed nothing and is shown a raw UUID plus a picker containing
 *     nothing that can fix it.
 *
 *   - OFFER — "what may a NEW cta point at?". Must see only currently valid
 *     rows. This is what fills `UnresolvedCta.candidates` (the picker) AND
 *     what `prompt.ts` renders as Block B, the menu of names the model is told
 *     it may write.
 *
 * FOUR THINGS DROP AN EVENT OUT OF `getPublishedEvents`, NOT ONE (all verified
 * against `lib/db/events.ts`): `end_date` passing; `published -> completed`;
 * `published -> cancelled`; and `published -> draft` — and that last one's own
 * comment in `lib/db/events.ts` says it exists to support "un-publish for
 * major edits", i.e. ROUTINE WORK. Un-publishing an event to fix a typo used
 * to break every funnel page pointing at it.
 */
export interface Catalogues {
  /** Every row that ever existed. Answers "is this id still a real row?". */
  recognition: Catalogue
  /** Currently valid rows only. Answers "what may a NEW cta point at?". */
  offer: Catalogue
}

/**
 * The already-fetched rows `toCatalogue` assembles into a `Catalogue`.
 *
 * ONE NAMED OBJECT, NOT THREE POSITIONAL ARGUMENTS, AND THAT IS THE WHOLE
 * POINT OF THE PARAMETER. `programs` and `sessionPacks` are BOTH
 * `{id, name}[]`, so a transposed call is structurally valid: with a
 * positional signature `toCatalogue(sessionPacks, programs, events)` compiles
 * clean, ships a catalogue in which every program ref resolves against the
 * pack list, and is caught by neither tsc nor any type-level assertion —
 * exactly the hazard this helper was extracted to close. Named properties
 * make the same mistake a COMPILE ERROR (`Object literal may only specify
 * known properties` / a missing required key), so it cannot reach a test at
 * all. Keep it that way; do not "simplify" this back to positional args.
 */
export interface CatalogueRows {
  programs: { id: string; name: string }[]
  sessionPacks: { id: string; name: string }[]
  events: { id: string; title: string }[]
}

/**
 * Pure assembly of the catalogue from already-fetched rows. Split out of
 * `loadCatalogue` so the "which list goes under which key" mapping is
 * testable with plain literals and zero mocks — see `CatalogueRows` above for
 * why the parameter is a named object.
 *
 * `Event` uses `.title`, the other two use `.name`; that difference is
 * mapped here, once, and nowhere else.
 */
export function toCatalogue({ programs, sessionPacks, events }: CatalogueRows): Catalogue {
  return {
    program: programs.map((row) => ({ id: row.id, name: row.name })),
    session_pack: sessionPacks.map((row) => ({ id: row.id, name: row.name })),
    event: events.map((row) => ({ id: row.id, name: row.title })),
  }
}

/**
 * Loads BOTH sets. Deliberately trivial — every ounce of logic lives in
 * `resolveDoc`/`toCatalogue` so it can be tested without mocks. The only thing
 * this function decides is WHICH FETCHER FEEDS WHICH SET, and that decision is
 * the whole of the recognition/offer split, so it is pinned by four separate
 * mutant-killing tests in `resolve.test.ts`.
 *
 * EVENTS — SPLIT, and this closes the bug outright. `getEvents({})`
 * (`lib/db/events.ts:15`) filters status only when a status filter is PASSED
 * and never filters by date, so the recognition set needs no new DAL function
 * — every event ever, whatever its status, whether or not it has an
 * `end_date`. `getPublishedEvents()` with no arguments defaults to
 * `from: new Date()` and `status = 'published'`, which is exactly right for
 * the offer set: an owner adding a NEW cta should not be shown a camp that
 * already happened, or one that was cancelled, or one still in draft.
 *
 *   Note the offer set inherits `getPublishedEvents`'s NULL-`end_date` blind
 *   spot: `.gte("end_date", ...)` never matches NULL, so a published event
 *   with no `end_date` is invisible in the picker at any `from`. Reachable —
 *   `updateEventSchema` accepts `end_date: null`, `updateEvent` writes it
 *   through, and the re-derive only rescues clinics, so a CAMP can be left
 *   with one. That is now a PICKER gap (annoying, visible, fixable by setting
 *   an end date) rather than a publish block on an untouched page, which is
 *   the trade this split exists to make.
 *
 * SESSION PACKS — SPLIT, same hazard, no new DAL either. `listAllProducts()`
 * already exists beside `listActiveProducts()`. Deactivating a pack is a
 * deliberate admin action, but the page that already sells it did not change,
 * and blocking its publish is not how an owner should learn a product was
 * retired. Recognition keeps the page resolving; the offer set stops the model
 * and the picker from attaching anything NEW to a retired pack.
 *
 * PROGRAMS — SPLIT NOT YET POSSIBLE, AND THIS IS A KNOWN GAP, NOT A RULING
 * THAT PROGRAMS ARE DIFFERENT. `programs.is_active` carries the IDENTICAL
 * hazard to `session_pack_products.is_active` and deserves the identical
 * treatment, but `lib/db/programs.ts` has no all-programs reader —
 * `getPrograms()` filters `is_active`, and there is no `getAllPrograms()` to
 * mirror `listAllProducts()`. Adding one is a nine-line, purely additive
 * change to a file Stage 1.7 was scoped out of, so both sets are fed from
 * `getPrograms()` for now and DEACTIVATING A PROGRAM STILL BREAKS EVERY PAGE
 * SELLING IT. The fix is one function plus one word on the line below; do not
 * mistake the shared call for a decision that programs want conflation.
 */
export async function loadCatalogues(): Promise<Catalogues> {
  const [programs, allPacks, offerPacks, allEvents, offerEvents] = await Promise.all([
    // One call, TWO uses — see PROGRAMS above. Not a shortcut, a known gap.
    getPrograms(),
    listAllSessionPackProducts(),
    listActiveSessionPackProducts(),
    // `{}` is not a stray argument: `getEvents` filters status only when a
    // status filter is present, so this is deliberately "every event, ever".
    getEvents({}),
    // No argument at all: the `from: new Date()` default IS the offer bound.
    // Passing an epoch here would silently widen the picker back to every
    // event that ever ran, which is the mutant the offer-side test kills.
    getPublishedEvents(),
  ])

  return {
    recognition: toCatalogue({ programs, sessionPacks: allPacks, events: allEvents }),
    offer: toCatalogue({ programs, sessionPacks: offerPacks, events: offerEvents }),
  }
}

// ---------------------------------------------------------------------------
// Result shapes
//
// `field` IS MACHINE-USABLE, NOT JUST HUMAN-READABLE: the chat renders a
// picker beside each unresolved CTA and writes the chosen id back into that
// exact slot. The format is a path from `section.props` to the CtaWithLabel
// node — object keys joined with ".", array indices as "[i]", no leading dot:
//
//     "primaryCta"        hero's primary button
//     "secondaryCta"      hero's secondary button
//     "plans[2].cta"      the third pricing plan's button
//     "cta"               the cta section's single button
//     "links[0]"          the first footer link
//
// It addresses the `{label, target}` node, not the `target` inside it, because
// that is the unit a picker replaces.
//
// ORDERING — WHAT IS CONTRACTUAL AND WHAT IS NOT. `resolved`, `unresolved`
// and `danglingAnchors` are emitted in the order the walk meets them.
// CONTRACTUAL: sections appear in `doc.sections` order, and slots inside an
// array (pricing plans, footer links) in ascending index order — a picker
// list that jumped around the page would be unusable, so those two are worth
// depending on. NOT CONTRACTUAL: the relative order of two CTA slots that are
// sibling KEYS of the same props object (`primaryCta` vs `secondaryCta`).
// That is `Object.entries` insertion order, and this doc round-trips through
// jsonb (`funnel_steps.project_data`), which does not preserve authoring key
// order — Postgres stores jsonb keys sorted by length, then bytewise. Sort or
// set-compare if you need sibling keys in a particular order; do not assert a
// sequence across them.
// ---------------------------------------------------------------------------

export interface ResolvedCta {
  /** The section CONTAINING this CTA. */
  sectionId: string
  /** Path within that section's props — see the format note above. */
  field: string
  /** What the model wrote. Equal to `id` when the doc already held a real id. */
  ref: string
  /** The real row id. Substituted into the doc unless it was already there. */
  id: string
  /** The matched row's name — this is what a receipt line should show. */
  name: string
}

export interface UnresolvedCta {
  /** The section CONTAINING this CTA. */
  sectionId: string
  /** Path within that section's props — see the format note above. */
  field: string
  /** Left in the doc verbatim, exactly as the model wrote it. */
  ref: string
  kind: ResolvableCtaKind
  /** "ambiguous" when the name matched >= 2 rows, "no_match" when it matched 0. */
  reason: "no_match" | "ambiguous"
  /**
   * What to offer in the picker: the rows that TIED for "ambiguous", the whole
   * OFFER list for that kind for "no_match". Never the recognition list —
   * these are the rows a NEW commitment may be made to, so a completed event
   * or a deactivated pack must not appear here even though either is still
   * recognised in a doc that already points at it. Always real rows — the UI
   * never has to invent an option.
   */
  candidates: CatalogueEntry[]
}

/**
 * A CTA pointing at `#something` that names no section in this doc.
 *
 * Secondary requirement, same silent-failure class as an unresolved ref: the
 * compiler reports a dead in-page anchor as `ok: true, warnings: []` because
 * `<a href="#nope">` is perfectly valid markup. Nothing else in the pipeline
 * can see it, because nothing else holds the whole doc at once.
 *
 * `step` targets are deliberately NOT validated here: the funnel's slug list
 * is not available at this layer, and Stage 1.2 already degrades an unroutable
 * step CTA to a visible disabled placeholder.
 */
export interface DanglingAnchor {
  /** The section CONTAINING the dead link. */
  sectionId: string
  /** Path within that section's props — see the format note above. */
  field: string
  /** The anchor id it points at, which matches no section in the doc. */
  target: string
}

export interface ResolveResult {
  /**
   * The doc with every resolvable ref substituted. The SAME OBJECT as the
   * input when nothing needed substituting; otherwise a new doc in which only
   * the sections that actually had a ref rewritten are new objects.
   */
  doc: SectionDoc
  resolved: ResolvedCta[]
  /** NON-EMPTY MEANS PUBLISH IS BLOCKED. See `publishGate()`. */
  unresolved: UnresolvedCta[]
  danglingAnchors: DanglingAnchor[]
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * trim -> collapse internal whitespace runs to one space -> casefold.
 * `toLowerCase` (not `toLocaleLowerCase`) so the result never depends on the
 * server's locale.
 */
function normaliseName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

type MatchOutcome =
  /** `ref` is already a live row's id — nothing to substitute. */
  | { status: "already_id"; row: CatalogueEntry }
  /** Exactly one row matched by name — substitute its id. */
  | { status: "matched"; row: CatalogueEntry }
  | { status: "ambiguous"; candidates: CatalogueEntry[] }
  | { status: "no_match" }

/**
 * Minimum normalised length either side of a bidirectional substring match
 * must reach before that match is trusted. Same failure class as the
 * empty-string guards below, one size up: `String.prototype.includes` turns
 * a short needle into a coincidence generator, not a signal, once the other
 * side is long enough to contain it by chance. Concretely — this is the
 * exact case that motivated this guard: a catalogue row literally named
 * "PT" is a substring of normalised "optimal power" (…o-P-T-imal…), so
 * `ref: "Optimal Power"` would resolve WITH FULL CONFIDENCE, past the
 * publish gate, to a completely unrelated product. The blank-`ref` guard in
 * `matchRef` closes n=0 on the REF side; this floor closes n=0 on the
 * ROW-NAME side as well (see the note at its call site — that case used to
 * have its own line, which this one exactly subsumes) plus the rest of the
 * short end (n=1, n=2, …) the same
 * way, by refusing to treat EITHER direction of the substring test as
 * evidence until the SHORTER of the two strings clears a floor. Applied to
 * both directions, not just the one in the example above: swap which side
 * is short (`ref: "PT"` against a catalogue row named "Optimal Power") and
 * `name.includes(needle)` is the identical false positive from the other
 * side, so a floor on "the shorter of the two" — not on `needle` or `name`
 * specifically — fixes both without knowing in advance which side will be
 * short. 4 is chosen over the plan's stated lower bound of 3 to also rule
 * out common 3-letter initialisms ("SEO", "PPC") that are just as prone to
 * turning up inside an unrelated name by chance; anything genuinely that
 * short should be referenced by its EXACT name (rule 2 below), which this
 * guard does not touch.
 */
const MIN_PARTIAL_MATCH_LENGTH = 4

/**
 * The two row lists ONE ref is matched against, as a NAMED OBJECT rather than
 * two positional `CatalogueEntry[]` parameters.
 *
 * Same reasoning as `CatalogueRows` above, and here it is sharper: both sides
 * are `CatalogueEntry[]`, they OVERLAP heavily (usually `offer` is a subset of
 * `recognition`), and a transposed call would be right for every row that is
 * in both — so it would pass every test whose fixture does not deliberately
 * hold a recognition-only row, ship, and only misbehave once a real event
 * completed in production. Named keys make the swap a compile error instead.
 */
interface MatchLists {
  recognition: CatalogueEntry[]
  offer: CatalogueEntry[]
}

/**
 * Id first, then exact normalised name, then unique bidirectional substring.
 *
 * THE RULES DO NOT ALL SEARCH THE SAME LIST, AND THE SEAM IS EXACTLY BETWEEN
 * RULE 1 AND RULE 2.
 *
 *   - RULE 1 (id) searches RECOGNITION. A ref that is an id is a commitment
 *     this page ALREADY MADE — on turn one the model wrote a name, resolution
 *     substituted a real id, and every turn after that re-resolves that id.
 *     Judging an existing commitment against "what is currently on sale" is
 *     what turned an admin un-publishing an event into a publish block on a
 *     page nobody touched. Recognition is every row that ever existed, so the
 *     commitment keeps resolving for as long as its row exists — and only
 *     stops when the row is genuinely DELETED, which is the one case where the
 *     button really does point at nothing.
 *
 *   - RULES 2 AND 3 (exact name, then unique substring) search OFFER. A ref
 *     that is a NAME is a NEW commitment being made right now, by the model,
 *     this turn — indistinguishable in kind from the owner picking a row out
 *     of the picker, and it must be bounded the same way. This is not
 *     symmetry for its own sake: `prompt.ts`'s Block B renders the OFFER set
 *     and tells the model those are "the only names a CTA may reference". If
 *     name matching searched recognition, the resolver would silently accept
 *     names the prompt never advertised — the menu and the door would
 *     disagree, and the failure would be a live buy button for a retired
 *     product rather than an error. Matching the exact list the model was
 *     shown makes the prompt and the resolver agree BY CONSTRUCTION.
 *
 * The consequence, stated plainly because it is a deliberate trade: a model
 * that re-emits a raw NAME for a row that has since left the offer set gets
 * `no_match` plus a picker, not a silent resolve. That is loud, actionable,
 * and cannot reach a published page — whereas the reverse trade (accept the
 * name, publish a CTA for something not on sale) is silent and reaches
 * customers. Idempotence is unaffected: after turn one the doc holds an id,
 * and ids are judged by rule 1 against recognition.
 *
 * The blank-value guards are not in the plan, and are here because
 * `String.prototype.includes("")` is `true` for EVERY string: without them a
 * `ref: ""` (which `ctaTargetSchema` permits — the bound is `.max(120)`, with
 * no `.min`) would substring-match every row in the catalogue, and so would
 * resolve SILENTLY AND WRONGLY to the sole program on a one-program site.
 * A blank ref is a model bug; it must surface as `no_match` with the full
 * catalogue to pick from, never as a confident answer.
 * `MIN_PARTIAL_MATCH_LENGTH` (above) is this same guard generalised past the
 * n=0 case to the rest of the short end.
 *
 * EVERY BLANK-VALUE FAILURE HERE IS THE SAME SHAPE, and it is the worst shape
 * this module has: not silence, but a CONFIDENT WRONG ANSWER that
 * `publishGate` reports as `ok: true`. Blankness is hazardous from three
 * sides, so there are three guards, each closing a hole the other two do not
 * reach — and each one is pinned by a test that goes red if it alone is
 * removed. (Guards that overlap are worse than no guard at all: whichever is
 * subsumed cannot be killed by any test, so it rots into decoration and the
 * next reader trusts it. That is precisely how the row-name case was reported
 * as covered when it was not.)
 */
function matchRef({ recognition, offer }: MatchLists, ref: string): MatchOutcome {
  // GUARD 1 — A BLANK REF RESOLVES TO NOTHING, BY ANY RULE. This sits ABOVE
  // the id pass, not merely above the name passes, and the placement is the
  // whole point: `"" === ""` would let a row carrying a blank id satisfy
  // rule 1 and come back `already_id` — REPORTED AS RESOLVED, publish gate
  // green, doc still holding "". One line lower this guard reads identically
  // and closes only two thirds of the hole.
  const needle = normaliseName(ref)
  if (needle === "") return { status: "no_match" }

  // RULE 1 — against RECOGNITION, so a commitment this page already made
  // survives the row leaving the offer set. See the seam note above.
  // No blank-id filter is needed on this pass: `ref` is non-blank by the line
  // above, and a non-blank ref cannot equal a blank id.
  const byId = recognition.find((row) => row.id === ref)
  if (byId) return { status: "already_id", row: byId }

  // RULES 2 AND 3 — against OFFER, so a NEW name-commitment can only ever be
  // made to a row the prompt actually advertised.
  const rows = offer

  // GUARD 2 — A ROW WITH NO USABLE ID IS NEVER THE ANSWER, however well its
  // name matches. Substituting "" into the doc is the exact silent-absence
  // failure this module exists to prevent, arriving through the front door
  // with `resolved` non-empty and `publishGate.ok === true`; `no_match` plus
  // a picker is strictly better. Defence in depth rather than a live bug:
  // every row today comes from a uuid primary key, but `toCatalogue` takes
  // plain `{id, name}[]` and constrains nothing. Such a row can still appear
  // in a `no_match` picker (those candidates are the caller's own array), and
  // that is safe — choosing it writes "" into the doc, which GUARD 1 then
  // reports as `no_match` on the next turn. It fails loudly, not silently.
  const usable = rows.filter((row) => row.id.trim() !== "")

  const exact = usable.filter((row) => normaliseName(row.name) === needle)
  if (exact.length === 1) return { status: "matched", row: exact[0] }
  if (exact.length > 1) return { status: "ambiguous", candidates: exact }

  const partial = usable.filter((row) => {
    const name = normaliseName(row.name)
    // GUARD 3 — a row whose own NAME is blank. `needle.includes("")` is true
    // for every ref, so ONE blank-named row ties with everything: clean
    // matches turn `ambiguous`, and a ref matching nothing else resolves
    // wrongly and confidently to the blank row. Owner-entered `programs.name`
    // makes this reachable in a way a blank id is not.
    //
    // It has no line of its own because the floor below subsumes it exactly
    // (`Math.min(0, x) < 4` is always true) and a subsumed guard is
    // untestable. THE FLOOR THEREFORE CARRIES A CORRECTNESS INVARIANT, not
    // just a quality heuristic: n=0 is not "occasionally coincidental", it is
    // TRUE FOR EVERY REF. Lower `MIN_PARTIAL_MATCH_LENGTH` below 1 and you
    // must restore an explicit `name === ""` guard here — the blank-row test
    // in resolve.test.ts is what will tell you.
    if (Math.min(name.length, needle.length) < MIN_PARTIAL_MATCH_LENGTH) return false
    return name.includes(needle) || needle.includes(name)
  })
  if (partial.length === 1) return { status: "matched", row: partial[0] }
  if (partial.length > 1) return { status: "ambiguous", candidates: partial }

  return { status: "no_match" }
}

// ---------------------------------------------------------------------------
// The walk — copy-on-write over section.props
// ---------------------------------------------------------------------------

/**
 * Returns the row id to substitute into this CTA's `target.ref`, or `null` to
 * leave the node exactly as it is (same object). Side-effecting: it also
 * records the resolved / unresolved / dangling-anchor entries.
 */
type CtaVisitor = (cta: CtaWithLabel, field: string) => string | null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function joinKey(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`
}

function transformRecord(record: Record<string, unknown>, path: string, visit: CtaVisitor): Record<string, unknown> {
  let next: Record<string, unknown> | null = null
  for (const [key, child] of Object.entries(record)) {
    const mapped = transformNode(child, joinKey(path, key), visit)
    if (mapped !== child) {
      if (next === null) next = { ...record }
      next[key] = mapped
    }
  }
  return next ?? record
}

function transformNode(value: unknown, path: string, visit: CtaVisitor): unknown {
  if (Array.isArray(value)) {
    let next: unknown[] | null = null
    for (let i = 0; i < value.length; i++) {
      const mapped = transformNode(value[i], `${path}[${i}]`, visit)
      if (mapped !== value[i]) {
        if (next === null) next = value.slice()
        next[i] = mapped
      }
    }
    return next ?? value
  }

  if (!isRecord(value)) return value

  // Ask the registry's own schema whether this node is a CTA site, rather
  // than checking for a `label` and a `target` by hand — a hand-rolled shape
  // check is exactly the thing that drifts from the schema it stands in for.
  //
  // A node that IS a CTA site but fails this parse would be silently walked
  // past as "not a CTA site" — neither substituted nor reported. It cannot
  // reach here: `sectionDocSchema.parse` at the top of `resolveDoc` has
  // already rejected the whole doc. That parse is load-bearing for this line;
  // see the note on `resolveDoc`.
  const parsed = ctaWithLabelSchema.safeParse(value)
  if (parsed.success) {
    const substitute = visit(parsed.data, path)
    if (substitute === null) return value
    // `parsed.data` is a Zod-rebuilt CLONE and is READ-ONLY here: returning it
    // would replace this node (and silently normalise it) even when nothing
    // changed. The replacement below spreads the ORIGINAL node so every key
    // except the one resolved ref survives byte-for-byte.
    return { ...value, target: { ...parsed.data.target, ref: substitute } }
  }

  return transformRecord(value, path, visit)
}

// ---------------------------------------------------------------------------
// resolveDoc
// ---------------------------------------------------------------------------

/**
 * Substitutes every resolvable CTA ref in `doc` with the real row id, and
 * reports the ones it could not resolve.
 *
 * PURE: no DB, no network, no clock. The catalogue is a parameter.
 *
 * IDEMPOTENT: `resolveDoc(resolveDoc(doc, c).doc, c)` returns an identical
 * result with an empty `unresolved` — and returns the doc BY REFERENCE,
 * because by then there is nothing left to substitute.
 *
 * `sectionDocSchema.parse(doc)` re-validates the whole doc up front, mirroring
 * `reassemble()` in doc.ts: this function is the publish gate's source of
 * truth, so a corrupted stored doc must fail loudly rather than walk to no
 * CTA sites and report a clean `unresolved: []` that unblocks publish on a
 * broken page. Its return value is DISCARDED — Zod rebuilds its entire output
 * tree, so using the parsed copy here would replace every section with a
 * structurally-equal-but-different object and destroy the reference-identity
 * guarantee, with every test still green except the `toBe` pins. Same hazard,
 * same reasoning, as the `finalCheck.data` block in apply.ts.
 *
 * IT HAS A SECOND, LESS OBVIOUS REASON, AND THAT ONE IS LOAD-BEARING FOR THE
 * DERIVED WALK. The walk does not carry a table of CTA paths; it asks
 * `ctaWithLabelSchema.safeParse` whether each node it meets IS a CTA site. So
 * a CTA node whose `label` or `target` is schema-INVALID would answer "no",
 * be descended into as a plain record, and end up NEITHER SUBSTITUTED NOR
 * REPORTED — a dead button on a page with `unresolved: []` and
 * `publishGate.ok === true`, which is the precise failure this module exists
 * to prevent. Parsing the whole doc up front is what makes a schema-invalid
 * CTA node unreachable inside the walk. Anyone who deletes this line as a
 * "redundant re-parse the caller already did" reopens that hole, not just the
 * corrupt-doc one.
 *
 * THIS THROWS — UNLIKE `apply.ts`'s `applyOps`, which never throws and
 * always returns `{ ok, ... }`. That breaks the result-not-exception
 * discipline `applyOps` established for this feature, and it is deliberate
 * anyway: a clean `unresolved: []` on a corrupt doc would WRONGLY UNBLOCK
 * publish, which is worse than a crash a caller can catch and handle. The
 * consequence is pushed onto every call site instead of absorbed here —
 * Stage 1.7 (the build route) and the publish route MUST wrap every call to
 * `resolveDoc` in try/catch and treat a thrown error as "cannot resolve /
 * cannot publish this turn," not let it surface as an unhandled 500.
 */
export function resolveDoc(doc: SectionDoc, catalogues: Catalogues): ResolveResult {
  sectionDocSchema.parse(doc)

  const sectionIds = new Set(doc.sections.map((section) => section.id))
  const resolved: ResolvedCta[] = []
  const unresolved: UnresolvedCta[] = []
  const danglingAnchors: DanglingAnchor[] = []

  // Copy-on-write: `nextSections` stays null — and therefore `doc.sections`
  // is returned untouched — until some section actually changes. A plain
  // indexed loop, not `forEach`: TypeScript's control-flow analysis does not
  // see assignments made inside a callback, so `nextSections` would still be
  // narrowed to `null` after the loop and every read of it would be `never`.
  let nextSections: Section[] | null = null

  for (let i = 0; i < doc.sections.length; i++) {
    const section = doc.sections[i]

    const visit: CtaVisitor = (cta, field) => {
      const target = cta.target

      if (target.kind === "anchor") {
        if (!sectionIds.has(target.sectionId)) {
          danglingAnchors.push({ sectionId: section.id, field, target: target.sectionId })
        }
        return null
      }

      // `url` / `step` / `booking` carry no ref: nothing to resolve, and they
      // must appear in NEITHER result array. Narrowed with `in` rather than a
      // restated list of the three ref-carrying kinds.
      if (!("ref" in target)) return null

      // `offerRows` is BOTH half of the match input and the picker contents —
      // one variable so the list the model was allowed to choose from and the
      // list the owner is offered can never drift apart.
      const offerRows = catalogues.offer[target.kind]
      const outcome = matchRef(
        { recognition: catalogues.recognition[target.kind], offer: offerRows },
        target.ref,
      )

      switch (outcome.status) {
        case "already_id":
          resolved.push({
            sectionId: section.id,
            field,
            ref: target.ref,
            id: outcome.row.id,
            name: outcome.row.name,
          })
          return null
        case "matched":
          resolved.push({
            sectionId: section.id,
            field,
            ref: target.ref,
            id: outcome.row.id,
            name: outcome.row.name,
          })
          return outcome.row.id
        case "ambiguous":
          unresolved.push({
            sectionId: section.id,
            field,
            ref: target.ref,
            kind: target.kind,
            reason: "ambiguous",
            candidates: outcome.candidates,
          })
          return null
        case "no_match":
          unresolved.push({
            sectionId: section.id,
            field,
            ref: target.ref,
            kind: target.kind,
            reason: "no_match",
            // THE OFFER SET, never recognition — a picker is where a NEW
            // commitment is made, so offering "every event that ever ran"
            // would let an owner attach a live register button to a camp that
            // finished last summer. The caller's own array, not a defensive
            // copy: `resolveDoc` never mutates the catalogue and neither
            // should its caller.
            candidates: offerRows,
          })
          return null
      }
    }

    const props = transformRecord(section.props, "", visit)
    if (props !== section.props) {
      if (nextSections === null) nextSections = doc.sections.slice()
      // Only `props` is rebuilt; id / kind / variant / style stay the exact
      // same references they were on the input section.
      nextSections[i] = { ...section, props }
    }
  }

  const sections: Section[] = nextSections ?? doc.sections

  return {
    doc: sections === doc.sections ? doc : { ...doc, sections },
    resolved,
    unresolved,
    danglingAnchors,
  }
}

// ---------------------------------------------------------------------------
// The publish gate — the ONE call that answers "can this be published?"
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<ResolvableCtaKind, string> = {
  program: "program",
  session_pack: "session pack",
  event: "event",
}

export interface PublishGate {
  /** FALSE means: do not let this doc be published. */
  ok: boolean
  /** One line per reason publishing is blocked. Empty exactly when `ok`. */
  blockers: string[]
  /** Worth showing the owner, but NOT blocking: dead in-page anchor links. */
  warnings: string[]
}

function describeUnresolved(entry: UnresolvedCta): string {
  const label = KIND_LABEL[entry.kind]
  if (entry.reason === "ambiguous") {
    return (
      `Section "${entry.sectionId}" (${entry.field}): "${entry.ref}" matches ` +
      `${entry.candidates.length} ${label} rows — pick one.`
    )
  }
  return `Section "${entry.sectionId}" (${entry.field}): no ${label} matches "${entry.ref}".`
}

function describeDanglingAnchor(entry: DanglingAnchor): string {
  return (
    `Section "${entry.sectionId}" (${entry.field}): links to "#${entry.target}", ` +
    `which is not a section on this page.`
  )
}

/**
 * THE publish gate for a section document.
 *
 * Derived from the `SectionDoc` via `ResolveResult`, deliberately NOT from the
 * compile result: an unresolved CTA renders as a disabled placeholder for
 * every kind except `session_pack` (see the block at the top of this file),
 * and EITHER WAY compiles to `ok: true, warnings: []` — the compiler has no
 * signal to give about a dead or silently-degraded CTA. `compiled.ok` cannot
 * answer "can this be published?" and never will.
 *
 * Dangling anchors are reported as warnings, not blockers: a dead in-page
 * anchor scrolls nowhere, which is bad, but it is not the same severity as a
 * buy button that does nothing, and blocking a publish on it would be a
 * surprise the plan never asked for.
 */
export function publishGate(result: ResolveResult): PublishGate {
  const blockers = result.unresolved.map(describeUnresolved)
  const warnings = result.danglingAnchors.map(describeDanglingAnchor)
  return { ok: blockers.length === 0, blockers, warnings }
}
