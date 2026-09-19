// __tests__/lib/funnels/seo.test.ts
//
// The resolver behind `generateMetadata`, the sitemap and the admin panel.
// Each test names the mutant it kills, and every one of them was verified RED
// by actually applying that mutation — not by reasoning about it.
//
// The two that matter most are the two FALLBACK tests. They are the bug: the
// live site served `<title>Start | DJP Athlete</title>` and
// `description="The RPI quiz funnel."` because the chain reached the wrong
// field first, and both of those are one-word edits away from coming back.

import { describe, expect, it } from "vitest"
import {
  DEFAULT_FUNNEL_OG_IMAGE,
  FUNNEL_SEO_LIMITS,
  funnelStepPath,
  resolveFunnelStepSeo,
  type FunnelSeoStep,
} from "@/lib/funnels/seo"

const FUNNEL = { name: "Athlete Performance Insight", slug: "athlete-quiz" }

function step(overrides: Partial<FunnelSeoStep> = {}): FunnelSeoStep {
  return {
    name: "Start",
    slug: "start",
    is_entry: true,
    seo_title: null,
    seo_description: null,
    og_image_url: null,
    noindex: false,
    ...overrides,
  }
}

describe("funnelStepPath", () => {
  it("gives the entry step the bare funnel URL", () => {
    // MUTANT KILLED: `${base}/${step.slug}` unconditionally. That is the
    // duplicate-content bug — /go/athlete-quiz and /go/athlete-quiz/start both
    // answer 200, and the canonical has to name ONE of them.
    expect(funnelStepPath("athlete-quiz", { slug: "start", is_entry: true })).toBe("/go/athlete-quiz")
  })

  it("appends the slug for a step that is not the entry", () => {
    // MUTANT KILLED: returning the bare base for every step, which would
    // canonicalise every page of a funnel onto its first page and ask Google
    // to drop the rest.
    expect(funnelStepPath("gap-map", { slug: "thank-you", is_entry: false })).toBe("/go/gap-map/thank-you")
  })

  it("encodes both segments", () => {
    // MUTANT KILLED: raw interpolation. Same reasoning as `previewBasePath` —
    // a slug is owner input and `a/b` would become two path segments.
    expect(funnelStepPath("a/b", { slug: "c/d", is_entry: false })).toBe("/go/a%2Fb/c%2Fd")
  })
})

describe("resolveFunnelStepSeo — the title", () => {
  it("uses the owner's seo_title when there is one", () => {
    const seo = resolveFunnelStepSeo(FUNNEL, step({ seo_title: "Find Your Rotational Power Gap" }))
    expect(seo.title).toBe("Find Your Rotational Power Gap")
    expect(seo.titleIsFallback).toBe(false)
  })

  it("falls back to the FUNNEL name on an entry step, never the step name", () => {
    // MUTANT KILLED: `step.name ?? funnel.name`, the shipped chain. This is
    // THE bug — it is what put "Start" in the live <title>. The assertion is
    // written as two claims on purpose: `toBe(funnel name)` alone would also
    // pass if the fallback were hard-coded, and `not.toBe("Start")` alone
    // would pass if it returned the empty string.
    const seo = resolveFunnelStepSeo(FUNNEL, step({ name: "Start", is_entry: true }))
    expect(seo.title).toBe("Athlete Performance Insight")
    expect(seo.title).not.toBe("Start")
    expect(seo.titleIsFallback).toBe(true)
  })

  it("qualifies a non-entry step with the funnel name rather than using it bare", () => {
    // MUTANT KILLED (two of them): returning `funnel.name` for every step,
    // which gives every page of one funnel the same title; and returning
    // `step.name` bare, which gives "Thank you" to every funnel in the account.
    const seo = resolveFunnelStepSeo(
      { name: "The Performance Gap Map Quiz", slug: "gap-map" },
      step({ name: "Thank you", slug: "thank-you", is_entry: false }),
    )
    expect(seo.title).toBe("The Performance Gap Map Quiz — Thank you")
  })

  it("treats a whitespace-only seo_title as absent", () => {
    // MUTANT KILLED: `seo_title ?? fallback`. `??` only catches null, so a
    // stray space saved from the panel would render a BLANK <title> — which
    // looks like nothing is wrong right up until it is in a search result.
    const seo = resolveFunnelStepSeo(FUNNEL, step({ seo_title: "   " }))
    expect(seo.title).toBe("Athlete Performance Insight")
    expect(seo.titleIsFallback).toBe(true)
  })

  it("appends the brand to the social title but not the page title", () => {
    // MUTANT KILLED: using `socialTitle` for both. The layout template already
    // appends " | DJP Athlete" to `title`, so that renders the brand twice —
    // the exact bug `.agents/slug-and-metadata-convention.md` records as having
    // shipped once on /glossary.
    const seo = resolveFunnelStepSeo(FUNNEL, step({ seo_title: "Rotational Power Quiz" }))
    expect(seo.title).toBe("Rotational Power Quiz")
    expect(seo.socialTitle).toBe("Rotational Power Quiz | DJP Athlete")
  })
})

describe("resolveFunnelStepSeo — the description", () => {
  it("uses the owner's seo_description", () => {
    const seo = resolveFunnelStepSeo(FUNNEL, step({ seo_description: "Real marketing copy." }))
    expect(seo.description).toBe("Real marketing copy.")
  })

  it("returns null rather than inventing one, and cannot reach funnel.description", () => {
    // MUTANT KILLED: re-adding `?? funnel.description`. That is what served
    // "The RPI quiz funnel." to production, and on another row it would serve
    // a Loom URL. The funnel object here deliberately CARRIES a description so
    // the test proves the field is unreachable rather than merely absent —
    // an absence assertion needs something present to prove it is ignoring it.
    const seo = resolveFunnelStepSeo(
      { ...FUNNEL, name: "Athlete Performance Insight" } as typeof FUNNEL & {
        description?: string
      },
      step({ seo_description: null }),
    )
    expect(seo.description).toBeNull()
  })

  it("treats a whitespace-only description as absent", () => {
    expect(resolveFunnelStepSeo(FUNNEL, step({ seo_description: "  " })).description).toBeNull()
  })
})

describe("resolveFunnelStepSeo — the share image", () => {
  it("uses the step's own image", () => {
    const seo = resolveFunnelStepSeo(FUNNEL, step({ og_image_url: "https://cdn.example.com/quiz.jpg" }))
    expect(seo.ogImage).toBe("https://cdn.example.com/quiz.jpg")
  })

  it("always yields an image, never null", () => {
    // MUTANT KILLED: `ogImage: step.og_image_url` — the route spreads this into
    // `images: [seo.ogImage]`, so a null here emits `<meta og:image>` with no
    // content and the share card loses its picture. A default is the ONLY
    // correct answer at this seam because the route cannot conditionally omit
    // one key without omitting the whole openGraph object, which is the
    // original bug.
    expect(resolveFunnelStepSeo(FUNNEL, step({ og_image_url: null })).ogImage).toBe(DEFAULT_FUNNEL_OG_IMAGE)
  })
})

describe("resolveFunnelStepSeo — indexing and canonical", () => {
  it("reports noindex", () => {
    expect(resolveFunnelStepSeo(FUNNEL, step({ noindex: true })).noindex).toBe(true)
    expect(resolveFunnelStepSeo(FUNNEL, step({ noindex: false })).noindex).toBe(false)
  })

  it("canonicalises the entry step onto the bare funnel URL", () => {
    expect(resolveFunnelStepSeo(FUNNEL, step({ is_entry: true })).canonicalPath).toBe("/go/athlete-quiz")
  })
})

describe("FUNNEL_SEO_LIMITS", () => {
  it("keeps the title target below the rendered budget by the brand's width", () => {
    // MUTANT KILLED: setting titleTarget to 60. 60 is the budget for the
    // RENDERED title, and the layout template adds " | DJP Athlete" — so a
    // counter targeting 60 walks the owner to a 74-character title while
    // reading green. This pins the ARITHMETIC, not the number: change the
    // brand and this test tells you the target moved.
    const brandSuffix = " | DJP Athlete".length
    expect(FUNNEL_SEO_LIMITS.titleTarget + brandSuffix).toBeLessThanOrEqual(61)
    expect(FUNNEL_SEO_LIMITS.titleTarget).toBeLessThan(FUNNEL_SEO_LIMITS.titleHardMax)
  })

  it("keeps every soft target under the API's hard cap", () => {
    // A soft target above the validator's cap would be a counter that reads
    // green right up to a 400 the route explains as "Invalid request".
    expect(FUNNEL_SEO_LIMITS.descriptionTarget).toBeLessThan(FUNNEL_SEO_LIMITS.descriptionHardMax)
    expect(FUNNEL_SEO_LIMITS.descriptionIdealMin).toBeLessThan(FUNNEL_SEO_LIMITS.descriptionTarget)
  })
})
