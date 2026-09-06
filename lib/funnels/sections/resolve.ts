// lib/funnels/sections/resolve.ts — CTA refs (names) -> real row ids.
//
// The AI NEVER writes a UUID. It writes a name: `{kind:"program",
// ref:"Comeback Code"}`. This module turns those names into the real row ids,
// on the server, against the real catalogue. It is the mechanism that makes a
// hallucinated id structurally impossible rather than merely unlikely.
//
// WHY THIS MATTERS MORE THAN IT LOOKS. `EventIsland.tsx:38` returns `null`
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
// ENFORCED AT: `app/api/admin/funnels/steps/[stepId]/publish/route.ts`
// (`gateSectionDoc`), which is the only place a version row can be written.
// `components/admin/funnels/builder/publish-actions.ts` runs the same check one
// layer earlier so the owner sees it before the request, and the builder UI
// disables the button — those two are convenience, not the gate.
//
// THAT LINE NAMES A FILE BECAUSE FOR THREE STAGES THIS BLOCK NAMED NOTHING, AND
// THE GATE DID NOT EXIST. The paragraph below described exactly the right
// mechanism, `publishGate()` at the bottom of this file was written and tested,
// and the publish route called neither — it took `{html, css, project_data}`,
// compiled, and wrote. A direct POST published dead buy buttons for as long as
// the endpoint existed, while three separate files told the reader it could
// not. If you change where the gate lives, change this line in the same commit;
// a claim that does not name its enforcement site cannot be checked, and an
// unchecked claim is what stops the next reader looking.
//
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
// that one call, and the publish route named above is the one caller whose
// refusal actually stops a write. A future reader who reaches for
// `compiled.ok` there will ship dead buy buttons on a green build — and so
// will one who deletes the call and leaves this comment standing.
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
  faqPropsSchema,
  formSectionPropsSchema,
  quizSectionPropsSchema,
  sectionDocSchema,
  type CtaTarget,
  type CtaWithLabel,
  type QuizSectionProps,
  type Section,
  type SectionDoc,
} from "@/lib/funnels/sections/registry"
// Aliased for the same reason as the two pack readers below: `getPrograms` and
// `getAllPrograms` differ by one word and by the entire recognition/offer
// split, so the call site names the PURPOSE rather than the filter.
import { getPrograms as listActivePrograms, getAllPrograms as listAllPrograms } from "@/lib/db/programs"
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
import { getQuizDefinition, listQuizzes } from "@/lib/db/quizzes"
import { quizGate } from "@/lib/quizzes/gate"
import { platformBusinessId } from "@/lib/tenancy/platform"
// The FAQ page keys that actually have rows. Not a CTA and not a uuid, but the
// same failure class — see `UnknownFaqKey` below.
import { getFaqCountsByPage } from "@/lib/db/faqs"

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

/** One selectable row, reduced to the fields resolution needs. */
export interface CatalogueEntry {
  id: string
  name: string
  /**
   * EVENTS ONLY, AND OPTIONAL ON PURPOSE — a form that takes payment needs to
   * know whether its camp CAN be paid for, and `{id, name}` cannot say.
   *
   * Optional because of the warning above about `loadCatalogue`: a `Catalogue`
   * key that a producer does not supply must never be required, or the missing
   * key becomes a silently unresolved CTA instead of a compile error. A program
   * carries neither key, so a reader must treat `undefined` as "not
   * applicable" and never as `false`.
   *
   * `true` when the event has a `stripe_price_id`. Without one,
   * `/api/events/[id]/checkout` refuses outright.
   */
  priced?: boolean
  /** Events only: `signup_count >= capacity`. */
  soldOut?: boolean
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
  /**
   * Every `faqs.page_key` that has at least one row, sorted.
   *
   * ONE SET, NOT TWO, AND THAT IS NOT AN OVERSIGHT. The recognition/offer
   * split above exists because a row can leave the "currently valid" set
   * while a page still points at it. A page key has no such lifecycle: it is
   * not a row, it has no status and no dates, and it exists exactly while
   * some FAQ row carries it. So "is this key real?" and "what may the model
   * choose?" have the same answer, and one list answers both.
   *
   * REQUIRED, never optional. An optional field here would make a caller that
   * forgot it skip the check silently — which is the exact shape of the bug
   * this field closes.
   */
  faqPageKeys: string[]
  /**
   * Every quiz, with enough to answer all three publish questions without a
   * second read: does it exist, is it active, and can it score?
   *
   * `gateBlocker` IS ONLY POPULATED FOR ACTIVE QUIZZES. A draft is already
   * blocked by `not_active` before the gate could matter, and gating one costs
   * six queries — running them to produce a reason nobody will see would make
   * every builder turn slower for nothing. `null` here therefore means "the
   * gate passed OR was not consulted", and only the active branch reads it.
   *
   * REQUIRED, never optional, for the same reason `faqPageKeys` is: an
   * optional field lets a caller that forgot it skip the check silently.
   */
  quizzes: QuizCatalogueEntry[]
}

export interface QuizCatalogueEntry {
  id: string
  status: string
  /** The gate's own FIRST blocker, so the owner is told what to go and fix. */
  gateBlocker: string | null
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
  /**
   * The payment fields are OPTIONAL on this input type, not on the `Event` rows
   * the real callers pass — `getPublishedEvents` and `getEvents` both
   * `select("*")`, so they always arrive. Optional here keeps this type usable
   * with the plain literals `toCatalogue`'s tests are built from, which is the
   * whole reason the assembly was split out of `loadCatalogue`.
   */
  events: { id: string; title: string; stripe_price_id?: string | null; capacity?: number; signup_count?: number }[]
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
    event: events.map((row) => ({
      id: row.id,
      name: row.title,
      // Derived, never fetched: both come off rows already in hand, so the
      // publish gate that reads them costs no extra query.
      priced: typeof row.stripe_price_id === "string" && row.stripe_price_id.length > 0,
      // `>=`, not `>`. The 12th signup of a 12-place camp fills it, and a strict
      // comparison would sell a 13th place for the webhook to refund.
      soldOut: typeof row.capacity === "number" && typeof row.signup_count === "number"
        ? row.signup_count >= row.capacity
        : false,
    })),
  }
}

/**
 * PostgREST's default maximum rows for an unbounded `.select()`. Hitting it is
 * not an error and produces no warning: the response is simply the first 1000
 * rows, silently.
 */
const POSTGREST_ROW_CAP = 1000

/**
 * THE 1000-ROW CAP LANDS ASYMMETRICALLY, AND IT LANDS ON THE SET THAT MUST BE
 * COMPLETE.
 *
 * `offer` may be incomplete and the damage is cosmetic — a picker missing its
 * thousand-and-first row. `recognition` may NOT: it answers "is this id still a
 * real row?", and a truncated answer is indistinguishable from "that row was
 * deleted". The symptom is precisely the bug the recognition/offer split exists
 * to fix — an id in a stored doc stops resolving, `publishGate.ok` flips to
 * false on a page nobody touched, and the picker offers nothing that helps —
 * except that no admin action caused it and nothing in the UI could ever
 * explain it.
 *
 * PAGINATION IS DELIBERATELY NOT DONE HERE, AND THAT IS A JUDGEMENT, NOT AN
 * OVERSIGHT. All three recognition reads are shared DAL functions
 * (`getAllPrograms`, `listAllProducts`, `getEvents`) whose other callers page
 * or filter for themselves; `lib/db/paginate.ts:fetchAllRows` exists and is
 * how they would each be fixed. At this business's real volumes — tens of
 * programs, a handful of packs, a few dozen events a year — paginating three
 * reads on every builder turn buys nothing but latency. So the cap is handled
 * the other way round: instead of assuming it will never be hit, this THROWS
 * the moment a recognition read comes back at the cap, naming the table and
 * the fix. A loud failure on the turn that first crosses 1000 rows is strictly
 * better than a silent, undiagnosable publish block that appears months later
 * on one page in the account.
 *
 * `>=` not `>`: PostgREST caps the response, so exactly `POSTGREST_ROW_CAP`
 * rows is the signature of truncation. A genuine 1000-row table trips this too
 * — correctly, because at that size the read must be paginated regardless.
 */
function assertNotTruncated(label: string, rows: unknown[]): void {
  if (rows.length < POSTGREST_ROW_CAP) return
  throw new Error(
    `loadCatalogues: the recognition read for ${label} returned ${rows.length} rows, at or over ` +
      `PostgREST's ${POSTGREST_ROW_CAP}-row cap, so it may be TRUNCATED. Recognition must be ` +
      `complete or a stored CTA id can stop resolving and block publish on an untouched page. ` +
      `Paginate this read with lib/db/paginate.ts:fetchAllRows before relying on it.`,
  )
}

/**
 * `recognition` ∪ `offer`, per kind, deduped by id and recognition-first.
 *
 * MAKES `offer ⊆ recognition` TRUE BY CONSTRUCTION rather than asserting it.
 * The invariant is the thing rules 1-3 depend on — a row the model may be
 * SHOWN (offer) but whose id the resolver cannot RECOGNISE is an offerable,
 * unresolvable CTA: the owner picks it out of the picker and the very next
 * turn reports it unresolved. Nothing enforced it before.
 *
 * Two ways it can break, and both are closed here rather than detected:
 *
 *   - THE RACE, AND THE MECHANISM IS *CREATION*, NOT ACTIVATION. An earlier
 *     spelling of this comment blamed "a program activated, or an event
 *     published, between the two reads". That cannot be it, and the reason is
 *     the whole point of the split: recognition applies NO `is_active` and NO
 *     `status` filter (`getAllPrograms` / `listAllProducts` / `getEvents({})`),
 *     so a row that is activated or published mid-flight WAS ALREADY IN
 *     RECOGNITION — activating it changes nothing about whether recognition
 *     can see it. The only concurrent write that puts a row in offer and not
 *     in recognition is a row CREATED (and immediately eligible for the offer
 *     filter) in the window between the recognition read landing and the offer
 *     read landing. `loadCatalogues` issues all six queries concurrently, so
 *     that window is real. Rare, self-healing next turn — but an assertion
 *     would turn it into a hard error, which is why this repairs instead.
 *   - TRUNCATION. Should a recognition read ever be capped despite
 *     `assertNotTruncated` (a narrower cap, a future filtered reader), every
 *     currently-offerable row still survives in recognition.
 *
 * THE UNION DOES NOT CLOSE BOTH DIRECTIONS, AND THE RESIDUAL IS THIS MODULE'S
 * OWN FAILURE CLASS. `Promise.all` completion order is arbitrary, so `offer`
 * can land BEFORE `recognition` and therefore be the STALER of the two. A row
 * DELETED in that window is missing from recognition (correctly — it is gone)
 * and present in offer (stale), and this union adds it BACK. A CTA already
 * committed to that id then matches rule 1, comes back `already_id`, lands in
 * `resolved`, and `publishGate.ok` is `true` for one turn: a dead buy button
 * that is silently publishable. WITHOUT the union that same turn correctly
 * reports it unresolved and blocks publish.
 *
 * The trade is still worth making and the union stays. The direction it closes
 * fails LOUDLY AND WRONGLY — a row the picker and the prompt both offer, which
 * the very next turn reports unresolved, with nothing in the UI able to
 * explain it. The direction it opens fails silently but is bounded to a single
 * turn, needs a DELETE to land inside a milliseconds-wide window between two
 * reads of the same `Promise.all`, and follows a deliberate destructive admin
 * action on a row a live page is selling. Do not "close" it by asserting
 * `offer ⊆ recognition` instead of repairing it — that swaps a one-turn
 * mis-report for a hard error on every builder turn for both directions.
 *
 * Recognition order is preserved and offer-only rows are appended, so nothing
 * that depends on the DAL's ordering shifts. Deduping by id (not by object
 * identity) matters: the two reads return DIFFERENT objects for the same row.
 */
function unionCatalogues(recognition: Catalogue, offer: Catalogue): Catalogue {
  const merged = {} as Catalogue
  for (const kind of Object.keys(recognition) as ResolvableCtaKind[]) {
    const rows = recognition[kind]
    const seen = new Set(rows.map((row) => row.id))
    const extra = offer[kind].filter((row) => !seen.has(row.id))
    merged[kind] = extra.length === 0 ? rows : [...rows, ...extra]
  }
  return merged
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
 * PROGRAMS — SPLIT, closing the third and last instance of the same hazard.
 * `programs.is_active` is the programs' version of the packs' `is_active` and
 * the events' `status`, and it used to be the one axis left conflated: both
 * sets were fed from `getPrograms()`, so DEACTIVATING A PROGRAM BROKE EVERY
 * FUNNEL PAGE SELLING IT — the committed id stopped resolving, publish flipped
 * to blocked on a page nobody had touched, and the picker offered nothing that
 * could fix it. `getAllPrograms()` (added beside `getPrograms()`, purely
 * additive, mirroring `listAllProducts()`) now feeds recognition. All three
 * kinds are split on the same principle; none of them is special.
 *
 * *** THIS THROWS, AND EVERY CALLER MUST WRAP IT. *** `assertNotTruncated`
 * (above) rejects a recognition read that comes back at PostgREST's 1000-row
 * cap, because a truncated recognition set is indistinguishable from "that row
 * was deleted". That contract used to be documented only on that private
 * helper, which is not where a caller looks — so it is restated here, on the
 * public function, exactly as `resolveDoc` states its own.
 *
 * ITS BLAST RADIUS IS ASYMMETRIC, AND WIDER THAN THE FAILURE IT REPLACES. The
 * silent truncation this guard exists to prevent blocks PUBLISH, on SOME pages
 * — only the ones that happen to reference a row past the cap. An UNHANDLED
 * throw from here takes down EVERY BUILDER TURN for every page in the account,
 * because `loadCatalogues` runs before the model call on every turn, not just
 * at publish. The guard is therefore a strict improvement only if the caller
 * catches it: Stage 1.7 (the build route) and the publish route MUST treat a
 * thrown error as "cannot build / cannot publish this turn", surfacing the
 * message (it names the table and the fix) rather than letting it become an
 * unhandled 500.
 */
export async function loadCatalogues(): Promise<Catalogues> {
  const [allPrograms, offerPrograms, allPacks, offerPacks, allEvents, offerEvents, faqCounts] =
    await Promise.all([
      listAllPrograms(),
      listActivePrograms(),
      listAllSessionPackProducts(),
      listActiveSessionPackProducts(),
      // `{}` is not a stray argument: `getEvents` filters status only when a
      // status filter is present, so this is deliberately "every event, ever".
      getEvents({}),
      // No argument at all: the `from: new Date()` default IS the offer bound.
      // Passing an epoch here would silently widen the picker back to every
      // event that ever ran, which is the mutant the offer-side test kills.
      getPublishedEvents(),
      // One lightweight `select page_key` — the same read the admin FAQ picker
      // uses. Counts across EVERY status on purpose: a page key whose rows are
      // all drafts is still a real key, and the live island filters by status
      // itself. What must never happen is the model inventing a key.
      getFaqCountsByPage(),
    ])

  // The completeness contract for recognition, checked before either set is
  // assembled — see `assertNotTruncated`. Only the three RECOGNITION reads are
  // checked; an offer list hitting the cap is a picker that shows the first
  // thousand rows, which is untidy, not a publish block on an untouched page.
  assertNotTruncated("programs", allPrograms)
  assertNotTruncated("session packs", allPacks)
  assertNotTruncated("events", allEvents)

  const offer = toCatalogue({
    programs: offerPrograms,
    sessionPacks: offerPacks,
    events: offerEvents,
  })

  // ONLY ACTIVE QUIZZES ARE GATED. Assembling one definition costs six
  // queries, and a draft is already blocked by `not_active` before the gate
  // could matter — running them to produce a reason nobody will read would
  // make every builder turn slower for nothing. Concurrent, like the reads
  // above, so this adds one round trip rather than one per quiz.
  // PLATFORM SEAM, NOT A RESOLUTION. `loadCatalogues` backs the AI page
  // builder's whole call graph (build/publish/plan routes, the funnel editor
  // page, and the shared draft-preview renderer) -- none of which is in this
  // phase's declared conversion list (docs/superpowers/plans/2026-09-03-
  // calendly-per-coach-phase1-multi-coach-ops.md's Task 8 touches quizzes.ts
  // and its admin quiz pages/routes only). Threading a real per-request
  // businessId through here would mean re-scoping that entire builder
  // subsystem as a side effect of a DAL signature change, which is its own
  // task. `platformBusinessId()` keeps today's behaviour byte-identical
  // (it returns the same constant `listQuizzes` was hard-coded to) and stays
  // one greppable line for whichever task gives the builder a real tenant.
  const quizRows = await listQuizzes(platformBusinessId())
  const gated = await Promise.all(
    quizRows.map(async (row): Promise<QuizCatalogueEntry> => {
      if (row.status !== "active") return { id: row.id, status: row.status, gateBlocker: null }
      const definition = await getQuizDefinition(row.id)
      // A row that vanished between the list and this read is reported as a
      // quiz that cannot score, not as one that passes. Failing closed here
      // costs a blocked publish; failing open ships a page that collects
      // answers into nothing.
      if (!definition) return { id: row.id, status: row.status, gateBlocker: "the quiz could not be read" }
      const gate = quizGate(definition)
      return { id: row.id, status: row.status, gateBlocker: gate.ok ? null : (gate.blockers[0] ?? "it failed its checks") }
    }),
  )
  const quizzes: QuizCatalogueEntry[] = gated

  return {
    recognition: unionCatalogues(
      toCatalogue({ programs: allPrograms, sessionPacks: allPacks, events: allEvents }),
      offer,
    ),
    offer,
    // Sorted so the blocker message and the prompt's Block B list the keys in
    // the same order the owner sees them in /admin/marketing/faqs.
    faqPageKeys: Object.keys(faqCounts).sort(),
    quizzes,
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
 * A dangling anchor WARNS and does not block: it scrolls nowhere on a page
 * that is otherwise fine. `BrokenStepLink` below is the opposite call, and the
 * two sitting next to each other is the point.
 */
export interface DanglingAnchor {
  /** The section CONTAINING the dead link. */
  sectionId: string
  /** Path within that section's props — see the format note above. */
  field: string
  /** The anchor id it points at, which matches no section in the doc. */
  target: string
}

/**
 * One page of the funnel this document belongs to, reduced to what checking a
 * step link needs. `name` is carried for the messages a picker and a blocker
 * show the owner — never for matching, which is on `slug` alone.
 */
export interface FunnelStepRef {
  slug: string
  name: string
}

/**
 * A `{kind:"step"}` CTA naming a page this funnel does not have.
 *
 * THE FAILURE THIS CLOSES WAS TOTALLY SILENT, and worse than a dangling
 * anchor. `renderCtaTarget` degrades a step CTA only when `funnelBasePath` is
 * missing or malformed — a *wrong slug* with a good base path renders an
 * ordinary, healthy-looking `<a href="/go/camp/offer-page">`. The compiler is
 * happy (valid markup), the publish gate was happy (nothing looked at it), and
 * the owner finds out when a visitor they paid for hits a 404.
 *
 * So this BLOCKS, where `DanglingAnchor` only warns. Slugs change — renaming a
 * page and deleting one both produce this — so it is not only a model
 * hallucination guard.
 */
export interface BrokenStepLink {
  /** The section CONTAINING the dead link. */
  sectionId: string
  /** Path within that section's props — see the format note above. */
  field: string
  /** The slug it points at, which matches no page in this funnel. */
  stepSlug: string
}

/**
 * A `faq` section set to `source: "live"` whose `pageKey` matches no FAQ row.
 *
 * THE ONE MODEL-WRITTEN STRING THAT REACHES A LOOKUP AND IS NOT A CtaTarget.
 * `faqIslandSchema` bounds its length and nothing else, the CTA walk cannot
 * see it (it is not a `CtaWithLabel`), and it flows to
 * `listFaqsForPage(pageKey)` in `FaqIsland.tsx` ON THE PUBLIC `/go` ROUTE. A
 * hallucinated or stale key returns zero rows, `FaqIsland` returns `null`, and
 * the ENTIRE FAQ SECTION renders as nothing — with `compile.ok: true`,
 * `warnings: []` and, before this, a green publish gate. Silent absence on a
 * live marketing page is the exact failure this module exists to prevent,
 * arriving through the one section input that is not a CTA.
 *
 * IT IS A BLOCKER, NOT A WARNING, and the line it sits on is the same one
 * `unresolved` sits on: the owner cannot see the damage. A dangling anchor
 * (warning) leaves a visible button that scrolls nowhere; an unknown page key
 * leaves NOTHING, on a page the owner has already read and approved.
 *
 * NOT REWRITTEN, ONLY REPORTED. There is no safe substitution: unlike a CTA
 * ref there is no "closest match" that could be the owner's intent, and
 * quietly swapping in some other page's FAQs would ship the wrong answers to
 * real customers.
 */
export interface UnknownFaqKey {
  /** The `faq` section carrying it. */
  sectionId: string
  /** Always `"pageKey"` — the field's path within the section's props. */
  field: string
  /** The key the model wrote, left in the doc verbatim. */
  pageKey: string
  /** Every key that DOES have rows, so the fix is one name away. */
  candidates: string[]
}

/**
 * A form whose `successMode` is "checkout" and whose camp cannot be paid for.
 *
 * `reason` exists so the owner is told which of three different things to fix.
 * `not_offered` and `unknown` are deliberately separate: an owner who
 * un-published a camp to fix a typo — which `Catalogues` above calls ROUTINE
 * WORK — must not be told they have a broken id and sent looking for a mistake
 * they did not make.
 */
export interface UnresolvedQuiz {
  sectionId: string
  quizId: string
  /**
   * `missing`    — the id names no quiz at all (a typo, or a deleted row).
   * `not_active` — the quiz exists but is draft or archived; `detail` is the status.
   * `gate_failed`— active, but `quizGate` refuses it; `detail` is its first blocker.
   */
  reason: "missing" | "not_active" | "gate_failed"
  detail?: string
}

export interface UnsellableCheckout {
  sectionId: string
  eventId: string
  reason: "unknown" | "not_offered" | "unpriced"
}

/** A form selling a camp that is full. Reported, never blocked. */
export interface SoldOutCheckout {
  sectionId: string
  eventId: string
  name: string
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
  /**
   * NON-EMPTY MEANS PUBLISH IS BLOCKED. Always empty when `resolveDoc` was
   * given a `null` page list, because that means "not checked" — never
   * "checked and fine".
   */
  brokenStepLinks: BrokenStepLink[]
  /** NON-EMPTY MEANS PUBLISH IS BLOCKED. See `publishGate()`. */
  unknownFaqKeys: UnknownFaqKey[]
  /**
   * NON-EMPTY MEANS PUBLISH IS BLOCKED. A page that asks twelve questions and
   * then cannot score them is worse than a page that never asked.
   */
  unresolvedQuizzes: UnresolvedQuiz[]
  /**
   * NON-EMPTY MEANS PUBLISH IS BLOCKED. Forms that take payment for a camp that
   * cannot take payment. See `publishGate()`.
   */
  unsellableCheckouts: UnsellableCheckout[]
  /**
   * A WARNING, NOT A BLOCKER — see `publishGate()`. A full camp is a legitimate
   * page: the owner may want it live saying so, and refusing to publish it would
   * be the gate deciding something that is not its business.
   */
  soldOutCheckouts: SoldOutCheckout[]
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
 * AND THE SECOND CONSEQUENCE, WHICH IS A PRODUCT DECISION AND IS RECORDED HERE
 * SO IT STOPS LOOKING LIKE AN ACCIDENT: **there is no path to make a NEW
 * commitment to a recognition-only row, at all.** Rules 2-3 search offer, the
 * picker (`UnresolvedCta.candidates`) is offer, and Block B of the prompt is
 * offer — every door into the doc reads the same list. So an owner who
 * deliberately wants to point a button at a COMPLETED camp (an archive page, a
 * "join the waitlist for next year" page) or a retired program cannot: neither
 * the model nor the picker will name it, and typing the name yields `no_match`.
 * Recognition exists ONLY to keep commitments already in a doc resolving.
 *
 * That is the intended trade — the alternative is a single list, which is the
 * bug this split exists to fix — and the escape hatch is a `url` CTA, which
 * carries no ref and is resolved by nobody. If a real archive/waitlist use case
 * turns up, the fix is an explicit, deliberate widening (an "include past
 * events" toggle that swaps the picker's source), NOT relaxing rules 2-3 to
 * search recognition, which would silently reopen the live-buy-button-for-a-
 * retired-product hole from the other side.
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
 *
 * ---------------------------------------------------------------------------
 * `steps` IS REQUIRED, AND `null` IS NOT THE SAME AS `[]`.
 * ---------------------------------------------------------------------------
 *   - `null` — the funnel's pages are NOT KNOWN. Step links are not checked
 *              and `brokenStepLinks` comes back empty. That means "not
 *              checked", never "checked and fine".
 *   - `[]`   — the pages ARE known and there are none, so every step link in
 *              the document is broken.
 *
 * Conflating them is a live hazard, not a nicety: `loadPageContext` in the
 * build route degrades a failed Supabase read to an empty slug list. If empty
 * meant "checked against nothing", one blip would mark every step link in the
 * document broken and block a publish that is perfectly fine.
 *
 * REQUIRED rather than optional for the reason `Catalogues`' own fields are: a
 * caller that forgets becomes a compile error here instead of silently
 * skipping the check. Every call site therefore has to say which of the two it
 * means — and the publish route is the one that may never say `null`.
 */
export function resolveDoc(
  doc: SectionDoc,
  catalogues: Catalogues,
  steps: FunnelStepRef[] | null,
): ResolveResult {
  sectionDocSchema.parse(doc)

  const sectionIds = new Set(doc.sections.map((section) => section.id))
  // `null` propagates as `null` — see the contract above. Never `?? []`.
  const knownSlugs = steps === null ? null : new Set(steps.map((step) => step.slug))
  const resolved: ResolvedCta[] = []
  const unresolved: UnresolvedCta[] = []
  const danglingAnchors: DanglingAnchor[] = []
  const brokenStepLinks: BrokenStepLink[] = []
  const unknownFaqKeys: UnknownFaqKey[] = []
  const unresolvedQuizzes: UnresolvedQuiz[] = []
  const unsellableCheckouts: UnsellableCheckout[] = []
  const soldOutCheckouts: SoldOutCheckout[] = []

  // Copy-on-write: `nextSections` stays null — and therefore `doc.sections`
  // is returned untouched — until some section actually changes. A plain
  // indexed loop, not `forEach`: TypeScript's control-flow analysis does not
  // see assignments made inside a callback, so `nextSections` would still be
  // narrowed to `null` after the loop and every read of it would be `never`.
  let nextSections: Section[] | null = null

  for (let i = 0; i < doc.sections.length; i++) {
    const section = doc.sections[i]

    // THE NON-CTA CHECK, and the only one. Kept beside the CTA walk rather
    // than in its own pass because both answer the same question — "does this
    // model-written string name something this server can actually find?" —
    // and a reader looking for that answer must find all of it in one place.
    // `source: "inline"` carries no key and is never reported: those Q&As are
    // in the document and render whatever the database holds.
    //
    // ASKS THE REGISTRY'S OWN SCHEMA for the shape rather than casting
    // `section.props`: `Section["props"]` is deliberately wide, and a hand
    // narrowing here is the "restate the validator" trap this repo has three
    // scars from. `sectionDocSchema.parse(doc)` ran at the top of this
    // function, so this parse cannot fail — it is a narrowing, not a check.
    if (section.kind === "faq") {
      const faqProps = faqPropsSchema.parse(section.props)
      if (faqProps.source === "live" && !catalogues.faqPageKeys.includes(faqProps.pageKey)) {
        const pageKey = faqProps.pageKey
        unknownFaqKeys.push({
          sectionId: section.id,
          field: "pageKey",
          pageKey,
          // The caller's own array, same convention as `candidates` below:
          // `resolveDoc` never mutates the catalogue and neither should a
          // caller.
          candidates: catalogues.faqPageKeys,
        })
      }
    }

    // QUIZZES THAT CANNOT SCORE. Beside the FAQ check above for the same
    // stated reason: all three ask "does this owner-written value name
    // something this server can actually find?".
    //
    // Narrowed through the registry's own schema, never a cast — same rule the
    // FAQ branch follows.
    if (section.kind === "quiz") {
      const quizProps = quizSectionPropsSchema.parse(section.props) as QuizSectionProps
      const entry = catalogues.quizzes.find((candidate) => candidate.id === quizProps.quizId)
      if (!entry) {
        unresolvedQuizzes.push({ sectionId: section.id, quizId: quizProps.quizId, reason: "missing" })
      } else if (entry.status !== "active") {
        unresolvedQuizzes.push({
          sectionId: section.id,
          quizId: quizProps.quizId,
          reason: "not_active",
          detail: entry.status,
        })
      } else if (entry.gateBlocker !== null) {
        unresolvedQuizzes.push({
          sectionId: section.id,
          quizId: quizProps.quizId,
          reason: "gate_failed",
          detail: entry.gateBlocker,
        })
      }
    }

    // FORMS THAT TAKE MONEY. Beside the FAQ check above for the same stated
    // reason: both ask "does this model-or-owner-written value name something
    // this server can actually find?", and a reader looking for that answer
    // should find all of it in one place.
    //
    // ONLY `successMode: "checkout"` is inspected. An opt-in form carrying an
    // eventId is not selling anything, and a blocker on it would stop every
    // lead-gen page already live from publishing.
    //
    // Narrowed through the registry's own schema, never a cast — same rule the
    // FAQ branch follows, and `sectionDocSchema.parse(doc)` at the top of this
    // function means this parse cannot fail.
    if (section.kind === "form") {
      const formProps = formSectionPropsSchema.parse(section.props)
      if (formProps.successMode === "checkout") {
        const eventId = typeof formProps.eventId === "string" ? formProps.eventId : ""
        const offered = eventId === "" ? undefined : catalogues.offer.event.find((entry) => entry.id === eventId)
        if (!offered) {
          // Recognition answers a DIFFERENT question — "did this row ever
          // exist?" — and that is exactly what separates a typo from a camp the
          // owner has temporarily taken down.
          const known = eventId !== "" && catalogues.recognition.event.some((entry) => entry.id === eventId)
          unsellableCheckouts.push({ sectionId: section.id, eventId, reason: known ? "not_offered" : "unknown" })
        } else if (offered.priced !== true) {
          // `!== true`, not `=== false`: `priced` is optional, and `undefined`
          // means "nothing said this camp has a price", which is not a yes.
          unsellableCheckouts.push({ sectionId: section.id, eventId, reason: "unpriced" })
        } else if (offered.soldOut === true) {
          soldOutCheckouts.push({ sectionId: section.id, eventId, name: offered.name })
        }
      }
    }

    const visit: CtaVisitor = (cta, field) => {
      const target = cta.target

      if (target.kind === "anchor") {
        if (!sectionIds.has(target.sectionId)) {
          danglingAnchors.push({ sectionId: section.id, field, target: target.sectionId })
        }
        return null
      }

      // The sibling of the anchor branch above, and reported separately
      // because publishing treats the two differently — see `BrokenStepLink`.
      // `knownSlugs === null` means the page list could not be read, and
      // reports NOTHING rather than everything.
      if (target.kind === "step") {
        if (knownSlugs !== null && !knownSlugs.has(target.stepSlug)) {
          brokenStepLinks.push({ sectionId: section.id, field, stepSlug: target.stepSlug })
        }
        return null
      }

      // `url` / `booking` carry no ref: nothing to resolve, and they must
      // appear in NEITHER result array. Narrowed with `in` rather than a
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
    brokenStepLinks,
    unknownFaqKeys,
    unresolvedQuizzes,
    unsellableCheckouts,
    soldOutCheckouts,
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

function describeUnknownFaqKey(entry: UnknownFaqKey): string {
  const known =
    entry.candidates.length === 0
      ? "no page has FAQs yet"
      : `the pages with FAQs are: ${entry.candidates.join(", ")}`
  return (
    `Section "${entry.sectionId}" (${entry.field}): no FAQs are filed under ` +
    `"${entry.pageKey}", so that section would show nothing at all — ${known}.`
  )
}

/**
 * Written for the owner, and naming which of three fixes is theirs to make.
 *
 * "Its camp" rather than "its eventId": the owner picked a camp in the builder
 * and never typed the word eventId, so an error message about one describes a
 * field they cannot see.
 */
function describeUnsellableCheckout(entry: UnsellableCheckout): string {
  const where = `Section "${entry.sectionId}" takes payment`
  if (entry.reason === "unpriced") {
    return `${where}, but its camp has no price set up in Stripe yet, so nobody could pay for it.`
  }
  if (entry.reason === "not_offered") {
    return (
      `${where}, but its camp is not currently open — it may be unpublished, ` +
      `cancelled, or already finished. Re-publish the camp, or point this form at another one.`
    )
  }
  return `${where}, but does not name a camp that exists.`
}

function describeSoldOutCheckout(entry: SoldOutCheckout): string {
  return (
    `Section "${entry.sectionId}" sells "${entry.name}", which is full. ` +
    `Visitors will be told it is full instead of being able to pay.`
  )
}

function describeDanglingAnchor(entry: DanglingAnchor): string {
  return (
    `Section "${entry.sectionId}" (${entry.field}): links to "#${entry.target}", ` +
    `which is not a section on this page.`
  )
}

/**
 * "page", not "step" — the owner-facing vocabulary the funnel screens already
 * use. This string is a publish BLOCKER, so it is the whole explanation of why
 * someone cannot ship, and it has to name the slug they need to look for.
 */
function describeBrokenStepLink(entry: BrokenStepLink): string {
  return (
    `Section "${entry.sectionId}" (${entry.field}): links to the page ` +
    `"${entry.stepSlug}", which is not a page in this funnel.`
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
 *
 * An unknown FAQ page key IS a blocker, on the other side of that same line:
 * it renders as nothing at all, so unlike the anchor there is no visible tell
 * for the owner to notice. See `UnknownFaqKey`.
 */
function describeUnresolvedQuiz(entry: UnresolvedQuiz): string {
  const where = `Section ${entry.sectionId}`
  switch (entry.reason) {
    case "missing":
      return `${where}: no quiz with id ${entry.quizId} exists. Pick one in the block's settings.`
    case "not_active":
      return `${where}: quiz ${entry.quizId} is ${entry.detail}, not active. Activate it before publishing a page that uses it.`
    case "gate_failed":
      return `${where}: quiz ${entry.quizId} cannot score answers yet — ${entry.detail}`
  }
}

export function publishGate(result: ResolveResult): PublishGate {
  const blockers = [
    ...result.unresolved.map(describeUnresolved),
    ...result.unknownFaqKeys.map(describeUnknownFaqKey),
    // BLOCKS. A page that collects twelve answers it cannot score fails the
    // visitor at the last step, after they have spent the three minutes.
    ...result.unresolvedQuizzes.map(describeUnresolvedQuiz),
    // BLOCKS, unlike the dangling anchors below. A dead in-page anchor scrolls
    // nowhere on a page that is otherwise fine; a dead step link is a 404 on a
    // page the owner is paying to send traffic to.
    ...result.brokenStepLinks.map(describeBrokenStepLink),
    // BLOCKS. A page that charges for a camp which cannot take the money is a
    // page that takes a visitor's details and then fails them at the last step.
    ...result.unsellableCheckouts.map(describeUnsellableCheckout),
  ]
  const warnings = [
    ...result.danglingAnchors.map(describeDanglingAnchor),
    // WARNS ONLY. A sold-out camp on a live page is a legitimate thing to
    // publish, and the visitor is told plainly rather than taken to a checkout.
    ...result.soldOutCheckouts.map(describeSoldOutCheckout),
  ]
  return { ok: blockers.length === 0, blockers, warnings }
}
