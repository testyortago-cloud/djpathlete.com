// lib/seo/build-funnel-page-schema.ts — structured data for a published
// funnel or landing page.
//
// ---------------------------------------------------------------------------
// WHAT IT DELIBERATELY DOES NOT CLAIM
// ---------------------------------------------------------------------------
// The obvious type for `/go/athlete-quiz` is schema.org `Quiz`, and it would be
// wrong. Google's Quiz structured data describes educational practice problems
// and expects the questions and answers to be IN the markup and visible on the
// page. This quiz's questions are a lead-capture flow, its answers are scored
// privately, and none of it is on the page at load. Marking it up as a Quiz
// would be describing content that does not exist — the one thing the schema
// guidance says never to do.
//
// There is no `BreadcrumbList` either, and that is not an oversight. Funnel
// pages live in their own route group PRECISELY so they do not render site
// navigation (`app/(funnel)/layout.tsx`: "a landing page's entire job is to
// remove exits"). A breadcrumb trail in the markup would describe a navigation
// path the page intentionally does not offer.
//
// No `aggregateRating`, no `offers`, no `Service`. What is left — a `WebPage`
// naming itself, its publisher and its share image — is modest, and it is all
// true.
//
// ---------------------------------------------------------------------------
// NO DANGLING `@id`s
// ---------------------------------------------------------------------------
// This repo has already shipped one. `lib/brand/author.ts:192-194` records the
// fix: a `#organization` reference "was dangling — no schema declared that
// @id", and it had to be re-pointed at an entity that actually exists.
//
// A JSON-LD reference to an `@id` that no document declares is a pointer to
// nothing. So the nested publisher and website nodes here carry their own
// `@type`, `name` and `url` — they are COMPLETE declarations in this document,
// not bare references — while keeping the same `@id`s the rest of the site
// uses, so Google still merges them into one entity rather than minting a
// second DJP Athlete.

import { SITE_URL } from "@/lib/constants"
import type { ResolvedFunnelSeo } from "@/lib/funnels/seo"

/**
 * `/#organization` WITH the slash and `#website` WITHOUT it.
 *
 * That asymmetry is not a typo here — it is what the rest of the site already
 * emits, and matching it is the whole point of using an `@id`. The homepage
 * declares `https://www.darrenjpaul.com/#organization`
 * (`app/(marketing)/page.tsx`), while `athletes/[type]` and `sports/[sport]`
 * reference `https://www.darrenjpaul.com#website`. Writing the "tidier" form
 * in either slot would mint a SECOND entity that joins nothing.
 *
 * Normalising all of them is a real cleanup and a separate one: it touches
 * five files across the marketing routes and it can only be verified in the
 * Rich Results Test, not by a unit test.
 */
const ORGANIZATION_ID = `${SITE_URL}/#organization`
const WEBSITE_ID = `${SITE_URL}#website`

export interface FunnelPageSchema extends Record<string, unknown> {
  "@context": "https://schema.org"
  "@type": "WebPage"
}

/**
 * A `WebPage` blob for one published funnel step.
 *
 * Built FROM `ResolvedFunnelSeo` rather than from the row, so the structured
 * data cannot disagree with the `<title>` and `<meta name="description">` on
 * the same page — schema that contradicts the visible content is worse than no
 * schema, and two independent reads of the same columns is how that happens.
 *
 * `description` is OMITTED, not emptied, when the step has none. The resolver
 * returns `null` there on purpose (a builder note is not marketing copy), and
 * `"description": ""` would be a claim that the page has no description rather
 * than an absence of the claim.
 */
export function buildFunnelPageSchema(seo: ResolvedFunnelSeo): FunnelPageSchema {
  const url = `${SITE_URL}${seo.canonicalPath}`

  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: seo.title,
    ...(seo.description ? { description: seo.description } : {}),
    inLanguage: "en-US",
    isPartOf: {
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      url: SITE_URL,
      name: "DJP Athlete",
    },
    publisher: {
      "@type": "Organization",
      "@id": ORGANIZATION_ID,
      name: "DJP Athlete",
      url: SITE_URL,
    },
    primaryImageOfPage: {
      "@type": "ImageObject",
      // ABSOLUTE. `seo.ogImage` is a path for the generated card and may be an
      // absolute URL when the owner set one, so it cannot be interpolated
      // blindly — schema.org URLs must be fully qualified, and
      // `https://…https://…` is the shape that mistake takes.
      url: seo.ogImage.startsWith("http") ? seo.ogImage : `${SITE_URL}${seo.ogImage}`,
    },
  }
}
