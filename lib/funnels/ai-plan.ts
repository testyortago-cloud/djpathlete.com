// lib/funnels/ai-plan.ts — the gate between a model's output and the dialog.
//
// A model can return anything; the dialog and `createFunnelSchema` accept a
// narrow shape. THIS MODULE DOES NOT DECIDE WHAT THAT SHAPE IS. Every rule
// already has exactly one owner — `FUNNEL_TEMPLATES.asks` for which intake
// fields exist, `FUNNEL_GOALS` for step goals, `slugify`/`FUNNEL_SLUG_PATTERN`
// for paths, `MAX_FUNNEL_STEPS` for the cap — and this routes the model's
// output through those same owners.
//
// That matters more here than anywhere else in the feature. A hand-written
// "AI output validator" would be a second copy of rules the server already
// enforces, and the moment it drifted the owner would sit through an interview
// and then meet a 400 naming a field they never saw. This repo has three logged
// bugs from restating a rule; an AI-shaped side door would be the fourth.
//
// IT REPAIRS RATHER THAN REJECTS wherever it can. The owner has just answered
// four questions; throwing the whole plan away over one bad enum is the wrong
// trade. `null` is returned for exactly one thing — a template that does not
// exist — because every other field is derived from the template, so without it
// there is nothing to repair against.
//
// PURE. No catalogue read, no I/O, no SDK. The offer match needs the live
// catalogue, so the ROUTE reads it and passes the allowed names in — which is
// also what makes that rule testable without a database.

import { slugify } from "@/lib/funnels/slug"
import {
  ENTRY_STEP_SLUG,
  MAX_FUNNEL_STEPS,
  getTemplate,
  type TemplateAsk,
} from "@/lib/funnels/templates"
import { FUNNEL_GOALS } from "@/lib/validators/funnel"
import type { FunnelGoal, OfferKind } from "@/types/database"

/** Bounds mirrored from the columns, so a plan can never exceed what stores it. */
const AUDIENCE_MAX = 300
const DESCRIPTION_MAX = 500

const GOAL_VALUES = new Set<string>(FUNNEL_GOALS.map((goal) => goal.value))

/** Whatever the model returned. Deliberately loose — that is the point. */
export interface RawFunnelPlan {
  template?: unknown
  name?: unknown
  steps?: unknown
  audience?: unknown
  description?: unknown
  offer?: unknown
  starts_at?: unknown
  ends_at?: unknown
}

export interface PlannedStep {
  name: string
  slug: string
  goal: FunnelGoal | null
}

export interface FunnelPlan {
  /** Discriminant. A page plan is a different shape, not a smaller funnel. */
  kind: "funnel"
  template: string
  name: string
  steps: PlannedStep[]
  audience: string | null
  description: string | null
  offer: { kind: OfferKind; ref: string } | null
  startsAt: string | null
  endsAt: string | null
}

/**
 * A LANDING PAGE PLAN, which is deliberately not a one-step funnel.
 *
 * A page has a `goal` where a funnel has a `template`, has exactly one step
 * that needs no naming, and has no run window or step sequence to describe.
 * Modelling it as a funnel with `steps.length === 1` would mean every consumer
 * carrying an "is this really a page?" branch, and `CreatePageDialog` would
 * have to ignore fields it has no controls for.
 */
export interface PagePlan {
  kind: "page"
  goal: FunnelGoal
  name: string
  audience: string | null
  description: string | null
}

/** What either assist hands back. Discriminated on `kind`. */
export type CreatePlan = FunnelPlan | PagePlan

export interface SanitiseOptions {
  /**
   * Names from `loadCatalogues().offer[kind]` — the set `resolve.ts` can
   * actually resolve. Passed in rather than read here so this stays pure.
   */
  allowedOfferNames: string[]
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim().slice(0, max)
  return trimmed === "" ? null : trimmed
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/**
 * The model's plan, reduced to something the dialog can accept.
 *
 * Returns null ONLY for an unknown template — see the header for why that one
 * is unrecoverable and everything else is repaired.
 */
export function sanitiseFunnelPlan(
  raw: RawFunnelPlan,
  { allowedOfferNames }: SanitiseOptions,
): FunnelPlan | null {
  const template = getTemplate(typeof raw.template === "string" ? raw.template : null)
  if (!template) return null

  const asks = (ask: TemplateAsk) => (template.asks as readonly string[]).includes(ask)

  // ── Steps ────────────────────────────────────────────────────────────────
  const proposed = Array.isArray(raw.steps) ? raw.steps : []
  const cleaned: PlannedStep[] = []
  const seen = new Set<string>()

  for (const entry of proposed) {
    if (cleaned.length >= MAX_FUNNEL_STEPS) break
    if (typeof entry !== "object" || entry === null) continue
    const candidate = entry as Record<string, unknown>

    const name = typeof candidate.name === "string" ? candidate.name.trim() : ""
    // A step with no name is a row the owner has to fill in anyway; dropping it
    // is tidier than showing them a blank the submit gate then blocks on.
    if (name === "") continue

    // The FIRST surviving step is the entry, and its path is not the model's to
    // choose: /go/<slug> is served by whichever step is `index`.
    const slug = cleaned.length === 0 ? ENTRY_STEP_SLUG : slugify(String(candidate.slug ?? name))
    if (slug === "" || seen.has(slug)) continue
    seen.add(slug)

    const goal = typeof candidate.goal === "string" && GOAL_VALUES.has(candidate.goal)
      ? (candidate.goal as FunnelGoal)
      : null

    cleaned.push({ name, slug, goal })
  }

  // No usable steps at all: the template already knows the answer, so use it
  // rather than handing back an empty editor.
  const steps = cleaned.length > 0 ? cleaned : template.steps.map((step) => ({ ...step }))

  // ── Offer ────────────────────────────────────────────────────────────────
  // Matched against the CATALOGUE, and the catalogue's spelling wins — that is
  // the string `resolve.ts` will match. An unmatched ref is dropped entirely
  // rather than passed through, because it is indistinguishable from a real one
  // until it renders as a disabled placeholder.
  let offer: FunnelPlan["offer"] = null
  if (asks("offer") && template.offerKind && typeof raw.offer === "object" && raw.offer !== null) {
    const candidate = raw.offer as Record<string, unknown>
    if (candidate.kind === template.offerKind && typeof candidate.ref === "string") {
      const wanted = candidate.ref.trim().toLowerCase()
      const matched = allowedOfferNames.find((name) => name.trim().toLowerCase() === wanted)
      if (matched) offer = { kind: template.offerKind, ref: matched }
    }
  }

  // ── Intake, filtered through `asks` ──────────────────────────────────────
  // The same array the dialog renders from and the validator refuses by. A
  // field the template does not ask for cannot arrive here by any route.
  return {
    kind: "funnel",
    template: template.value,
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    steps,
    audience: asks("audience") ? text(raw.audience, AUDIENCE_MAX) : null,
    description: text(raw.description, DESCRIPTION_MAX),
    offer,
    startsAt: asks("dates") ? isoOrNull(raw.starts_at) : null,
    endsAt: asks("dates") ? isoOrNull(raw.ends_at) : null,
  }
}

/**
 * The page equivalent.
 *
 * The one field that can be wrong in a way nothing downstream catches is
 * `goal`: `CreatePageDialog` renders its options from `FUNNEL_GOALS` and the
 * server refuses anything else, so a model-invented goal would be a plan the
 * dialog cannot display AND the API would reject. Unlike the funnel case there
 * is nothing to repair it with — a page IS its goal — so an unknown one falls
 * back to `leads`, the only goal that needs no linked product to work.
 */
export function sanitisePagePlan(raw: RawFunnelPlan & { goal?: unknown }): PagePlan {
  const goal =
    typeof raw.goal === "string" && GOAL_VALUES.has(raw.goal) ? (raw.goal as FunnelGoal) : "leads"

  return {
    kind: "page",
    goal,
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    audience: text(raw.audience, AUDIENCE_MAX),
    description: text(raw.description, DESCRIPTION_MAX),
  }
}
