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
// DISABLED PLACEHOLDER (render.ts's `disabledCta`), and a page full of
// disabled placeholders compiles to `ok: true, warnings: []`. The compiler has
// ZERO signal to give about this — `filterAttrs` drops bad attributes silently
// and a `<span role="button" aria-disabled>` is perfectly valid markup. So
// "can this page be published?" is answered by `ResolveResult.unresolved` and
// by nothing else. `publishGate()` below is that one call. A future reader who
// reaches for `compiled.ok` here will ship dead buy buttons on a green build.
// ---------------------------------------------------------------------------
//
// FOUR DESIGN DECISIONS THE PLAN DOES NOT MAKE, MADE HERE:
//
// 1. `resolveDoc` IS PURE AND TAKES THE CATALOGUE AS A PARAMETER. The DB call
//    lives in `loadCatalogue()`, which is deliberately trivial. Stages 1.1-1.4
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
// out. `loadCatalogue` is the only thing here that touches the database.

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
// silently building the catalogue out of the shop.
import { listActiveProducts as listActiveSessionPackProducts } from "@/lib/db/session-pack-products"
import { getPublishedEvents } from "@/lib/db/events"

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
 * Every row a CTA could point at, one list per resolvable kind. Passed in, so
 * `resolveDoc` stays pure and testable with plain literals.
 */
export type Catalogue = Record<ResolvableCtaKind, CatalogueEntry[]>

/**
 * Loads the real catalogue. Deliberately trivial — every ounce of logic lives
 * in `resolveDoc` so it can be tested without mocks.
 *
 * `Event` uses `.title`, the other two use `.name`; that difference is mapped
 * here, once, and nowhere else. The three DAL functions are all service-role
 * and already filter to what a public page may link at (`programs.is_active`,
 * `session_pack_products.is_active`, `events.status = 'published'` and not yet
 * ended) — which is the right list for a picker AND the reason a ref pointing
 * at a since-unpublished row correctly stops resolving.
 */
export async function loadCatalogue(): Promise<Catalogue> {
  const [programs, sessionPacks, events] = await Promise.all([
    getPrograms(),
    listActiveSessionPackProducts(),
    getPublishedEvents(),
  ])
  return {
    program: programs.map((row) => ({ id: row.id, name: row.name })),
    session_pack: sessionPacks.map((row) => ({ id: row.id, name: row.name })),
    event: events.map((row) => ({ id: row.id, name: row.title })),
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
   * What to offer in the picker: the rows that TIED for "ambiguous", the
   * whole catalogue for that kind for "no_match". Always real rows — the UI
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
 * Id first, then exact normalised name, then unique bidirectional substring.
 *
 * The two empty-string guards are not in the plan, and are here because
 * `String.prototype.includes("")` is `true` for EVERY string: without them a
 * `ref: ""` (which `ctaTargetSchema` permits — the bound is `.max(120)`, with
 * no `.min`) would substring-match every row in the catalogue, and so would
 * resolve SILENTLY AND WRONGLY to the sole program on a one-program site.
 * A blank ref is a model bug; it must surface as `no_match` with the full
 * catalogue to pick from, never as a confident answer.
 */
function matchRef(rows: CatalogueEntry[], ref: string): MatchOutcome {
  const byId = rows.find((row) => row.id === ref)
  if (byId) return { status: "already_id", row: byId }

  const needle = normaliseName(ref)
  if (needle === "") return { status: "no_match" }

  const exact = rows.filter((row) => normaliseName(row.name) === needle)
  if (exact.length === 1) return { status: "matched", row: exact[0] }
  if (exact.length > 1) return { status: "ambiguous", candidates: exact }

  const partial = rows.filter((row) => {
    const name = normaliseName(row.name)
    if (name === "") return false
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
 */
export function resolveDoc(doc: SectionDoc, catalogue: Catalogue): ResolveResult {
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

      const rows = catalogue[target.kind]
      const outcome = matchRef(rows, target.ref)

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
            // The caller's own array, not a defensive copy: `resolveDoc`
            // never mutates the catalogue and neither should its caller.
            candidates: rows,
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
 * compile result: an unresolved CTA renders as a disabled placeholder, which
 * compiles to `ok: true, warnings: []`. `compiled.ok` cannot answer this
 * question and never will — see the block at the top of this file.
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
