// lib/funnels/seo.ts — what a published funnel step tells a search engine.
//
// Pure, and deliberately so. Three callers need the SAME answer and only one of
// them has a request behind it:
//
//   1. `app/(funnel)/go/[slug]/[[...step]]/page.tsx` — `generateMetadata`
//   2. `app/sitemap.ts`                              — which URLs to list
//   3. `components/admin/funnels/builder/SeoPanel.tsx` — what the owner is
//      about to ship, shown BEFORE they ship it
//
// (3) is the reason this is a module rather than four lines inside
// `generateMetadata`. An admin panel that renders the owner's raw input tells
// them what they typed; a panel that renders THIS tells them what a searcher
// will see. Those differ on exactly the rows that matter — the empty ones.
//
// No `next` import, no DB, no `Metadata` type. The route maps the result onto
// Next's shape; everything here is strings.

import { LIVE_BASE } from "./preview-path"

/**
 * The brand the layout template appends. Imported, never restated — an OG
 * title that says a different brand from the `<title>` beside it is the exact
 * failure this repo has paid for elsewhere by copying a string.
 */
import { SITE_BRAND } from "@/lib/constants"

/**
 * The share image a step with no `og_image_url` of its own gets.
 *
 * It is the SAME file `app/layout.tsx` uses site-wide, and it is written out
 * here rather than left to metadata inheritance ON PURPOSE. Next.js replaces
 * `openGraph` WHOLESALE when a child route defines it — an omitted `images`
 * key is not an inherited one, it is an absent one. Relying on inheritance is
 * what produced the bug this module fixes (a funnel page with zero `og:` tags
 * under a layout that defines five).
 */
export const DEFAULT_FUNNEL_OG_IMAGE = "/images/gym-training-01.jpg"

/**
 * Character budgets, from `.agents/slug-and-metadata-convention.md`.
 *
 * `title` is 47 and not 60 because the layout template appends
 * ` | ${SITE_BRAND}` — 14 more characters — and 60 is the budget for the
 * RENDERED title. A counter that showed 60 here would walk the owner straight
 * past the truncation point while reading green.
 *
 * The `*HardMax` pair is a different thing: those are the caps
 * `updateStepSchema` enforces (lib/validators/funnel.ts). The soft budget is
 * advice and goes amber; the hard cap is a 400 and the input stops there.
 */
export const FUNNEL_SEO_LIMITS = {
  titleTarget: 47,
  titleHardMax: 160,
  descriptionTarget: 160,
  descriptionIdealMin: 150,
  descriptionHardMax: 320,
} as const

/** The four columns, as the callers hold them. */
export interface FunnelSeoStep {
  name: string
  slug: string
  is_entry: boolean
  seo_title: string | null
  seo_description: string | null
  og_image_url: string | null
  noindex: boolean
}

export interface FunnelSeoFunnel {
  name: string
  slug: string
}

export interface ResolvedFunnelSeo {
  /**
   * The page-level `<title>` value, WITHOUT the brand. The layout template
   * adds it; including it here renders "X | DJP Athlete | DJP Athlete".
   */
  title: string
  /** With the brand, for OG/Twitter — those do not go through the template. */
  socialTitle: string
  /**
   * `null` means EMIT NOTHING, and that is a considered answer rather than a
   * missing one — see `resolveFunnelStepSeo`.
   */
  description: string | null
  ogImage: string
  /** Path-only, self-referencing. `metadataBase` makes it absolute. */
  canonicalPath: string
  noindex: boolean
  /** True when the title is the fallback rather than the owner's own copy. */
  titleIsFallback: boolean
}

/**
 * `/go/<funnel>` for the entry step, `/go/<funnel>/<step>` for the rest.
 *
 * THE ENTRY STEP'S CANONICAL IS THE BARE FUNNEL URL, and that choice is the
 * fix for a real duplicate-content bug rather than a preference: the route is
 * an optional catch-all, so `/go/athlete-quiz` and `/go/athlete-quiz/start`
 * both answer 200 with identical content. One of them has to be the page. The
 * bare form wins because it is the one the admin screen calls "Public URL" and
 * the one that gets shared.
 *
 * Both segments are encoded for the reason `previewBasePath` gives: a slug is
 * owner input, and an un-encoded `a/b` becomes two path segments.
 */
export function funnelStepPath(funnelSlug: string, step: Pick<FunnelSeoStep, "slug" | "is_entry">): string {
  const base = `${LIVE_BASE}/${encodeURIComponent(funnelSlug)}`
  return step.is_entry ? base : `${base}/${encodeURIComponent(step.slug)}`
}

/** Trims, then treats whitespace-only as absent. A space is not copy. */
function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

/**
 * What this step should tell a search engine.
 *
 * ---------------------------------------------------------------------------
 * THE TITLE FALLBACK DELIBERATELY DOES NOT USE `step.name` ON AN ENTRY STEP.
 * ---------------------------------------------------------------------------
 * It used to, and it is what put `<title>Start | DJP Athlete</title>` on the
 * one published funnel. `step.name` is the builder rail's navigation label —
 * "Start", "Quiz", "Landing page", "Thank you". It was never written for a
 * reader outside the admin, and across production's ten steps those ten names
 * are only five distinct strings, four of them "Landing page".
 *
 * `funnel.name` is the owner's name for the offer ("Athlete Performance
 * Insight", "The Recruiting Ready Athlete") and is a usable title as written.
 * The old chain reached it LAST. This one reaches it first.
 *
 * A non-entry step still needs its own name or every step of one funnel shares
 * a title, so it gets `<funnel> — <step>`; the em dash is the convention doc's
 * separator for a compound title, and the pipe stays reserved for the brand.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO DESCRIPTION FALLBACK, ON PURPOSE.
 * ---------------------------------------------------------------------------
 * The obvious candidate is `funnel.description`, which is what shipped, and it
 * is a BUILDER NOTE — the field the owner types to remind himself what he is
 * making. Nothing in the admin says it is published. In production it holds
 * "The RPI quiz funnel.", a 400-character spec paragraph, and, on one row, a
 * Loom URL.
 *
 * So the choice is not "a description or no description", it is "a wrong
 * description or none". None is better: with no `<meta name="description">`
 * Google composes one from the page's real headline and subhead — copy that
 * WAS written to be read — whereas a present-but-internal one is served
 * verbatim. The convention doc notes 62%+ of descriptions are rewritten by the
 * engine anyway, which caps the upside of a good one and not the downside of a
 * bad one.
 *
 * The gap is not hidden: `titleIsFallback` and a `null` description are what
 * the admin panel renders a warning from, and the sitemap still lists the page.
 */
export function resolveFunnelStepSeo(funnel: FunnelSeoFunnel, step: FunnelSeoStep): ResolvedFunnelSeo {
  const ownTitle = clean(step.seo_title)
  const funnelName = clean(funnel.name) ?? funnel.slug
  const stepName = clean(step.name)

  const fallbackTitle = step.is_entry || stepName === null ? funnelName : `${funnelName} — ${stepName}`

  const title = ownTitle ?? fallbackTitle

  return {
    title,
    socialTitle: `${title} | ${SITE_BRAND}`,
    description: clean(step.seo_description),
    ogImage: clean(step.og_image_url) ?? DEFAULT_FUNNEL_OG_IMAGE,
    canonicalPath: funnelStepPath(funnel.slug, step),
    noindex: step.noindex === true,
    titleIsFallback: ownTitle === null,
  }
}
