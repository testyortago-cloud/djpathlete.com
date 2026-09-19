// __tests__/lib/seo/build-funnel-page-schema.test.ts
//
// Structured data for a published funnel page. The assertions that matter are
// the NEGATIVE ones: schema that claims something the page does not show is
// worse than no schema, and none of it is visible to a human reviewing the
// page — it only surfaces in the Rich Results Test, months later.

import { describe, expect, it } from "vitest"
import { buildFunnelPageSchema } from "@/lib/seo/build-funnel-page-schema"
import { resolveFunnelStepSeo, type FunnelSeoStep } from "@/lib/funnels/seo"

const FUNNEL = { name: "Athlete Performance Insight", slug: "athlete-quiz" }

function step(overrides: Partial<FunnelSeoStep> = {}): FunnelSeoStep {
  return {
    name: "Start",
    slug: "start",
    is_entry: true,
    seo_title: "Athlete Performance Quiz — 5 Questions, Free",
    seo_description: "Free athlete performance quiz for ages 13-25.",
    og_image_url: null,
    noindex: false,
    ...overrides,
  }
}

const build = (overrides: Partial<FunnelSeoStep> = {}) =>
  buildFunnelPageSchema(resolveFunnelStepSeo(FUNNEL, step(overrides)))

describe("buildFunnelPageSchema — what it claims", () => {
  it("is a WebPage at the page's own canonical URL", () => {
    const schema = build()
    expect(schema["@type"]).toBe("WebPage")
    expect(schema.url).toBe("https://www.darrenjpaul.com/go/athlete-quiz")
    expect(schema["@id"]).toBe("https://www.darrenjpaul.com/go/athlete-quiz#webpage")
  })

  it("takes its name and description from the SAME resolver the page renders", () => {
    // MUTANT KILLED: reading `step.name`/`funnel.description` directly. Schema
    // that contradicts the visible <title> is a quality signal pointed the
    // wrong way, and two independent reads of the same columns is how the two
    // drift apart.
    const seo = resolveFunnelStepSeo(FUNNEL, step())
    const schema = buildFunnelPageSchema(seo)
    expect(schema.name).toBe(seo.title)
    expect(schema.description).toBe(seo.description)
    expect(schema.name).not.toBe("Start")
  })

  it("uses the canonical URL for a non-entry step too", () => {
    const schema = build({ is_entry: false, slug: "thank-you" })
    expect(schema.url).toBe("https://www.darrenjpaul.com/go/athlete-quiz/thank-you")
  })
})

describe("buildFunnelPageSchema — what it must NOT claim", () => {
  it("omits description entirely when the step has none", () => {
    // MUTANT KILLED: `description: seo.description ?? ""`. An empty string is
    // a claim that the page has no description; absence is the absence of a
    // claim, and the resolver returns null on purpose.
    const schema = build({ seo_description: null })
    expect("description" in schema).toBe(false)
  })

  it("is not a Quiz, and carries no questions", () => {
    // The tempting type, and it would be a fabrication: Google's Quiz markup
    // describes educational practice problems with the Q&A visible on the
    // page. This quiz's questions are a lead flow and its answers are scored
    // privately — none of it is in the DOM at load.
    //
    // ASSERTED ON THE @type, NOT THE WORD. A bare
    // `not.toContain("Question")` fails on the honest title "Athlete
    // Performance Quiz — 5 Questions, Free" — the page's own copy, which is
    // exactly the content the schema is supposed to carry. It did.
    const schema = build()
    const json = JSON.stringify(schema)
    expect(schema["@type"]).not.toBe("Quiz")
    expect(json).not.toContain('"@type":"Quiz"')
    expect(json).not.toContain('"@type":"Question"')
    expect(json).not.toContain("hasPart")
    expect(json).not.toContain("acceptedAnswer")
  })

  it("carries no breadcrumb", () => {
    // Funnel pages live in their own route group SO THAT they render no site
    // navigation. A BreadcrumbList would describe a path the page
    // deliberately does not offer.
    expect(JSON.stringify(build())).not.toContain("Breadcrumb")
  })

  it("invents no ratings, reviews or offers", () => {
    const json = JSON.stringify(build())
    for (const forbidden of ["aggregateRating", "review", "offers", "priceCurrency"]) {
      expect(json).not.toContain(forbidden)
    }
  })
})

describe("buildFunnelPageSchema — entity references", () => {
  it("declares the publisher and website rather than pointing at a bare @id", () => {
    // THE REPO HAS SHIPPED A DANGLING @id BEFORE — lib/brand/author.ts:192
    // records having to re-point one that "no schema declared". A reference
    // with no declaration anywhere in the document is a pointer to nothing, so
    // each nested node carries its own @type, name and url as well as its @id.
    const schema = build()
    const publisher = schema.publisher as Record<string, unknown>
    expect(publisher["@type"]).toBe("Organization")
    expect(publisher.name).toBe("DJP Athlete")
    expect(publisher.url).toBe("https://www.darrenjpaul.com")

    const website = schema.isPartOf as Record<string, unknown>
    expect(website["@type"]).toBe("WebSite")
    expect(website.name).toBe("DJP Athlete")
    expect(website.url).toBe("https://www.darrenjpaul.com")
  })

  it("matches the @id forms the rest of the site already emits, slash and all", () => {
    // `/#organization` WITH the slash (app/(marketing)/page.tsx) and
    // `#website` WITHOUT it (athletes/[type], sports/[sport]). The asymmetry
    // is ugly and it is theirs; writing the tidier form in either slot mints a
    // SECOND entity that joins nothing, which is the opposite of the point.
    const schema = build()
    expect((schema.publisher as Record<string, unknown>)["@id"]).toBe("https://www.darrenjpaul.com/#organization")
    expect((schema.isPartOf as Record<string, unknown>)["@id"]).toBe("https://www.darrenjpaul.com#website")
  })
})

describe("buildFunnelPageSchema — the image", () => {
  it("makes the generated card's path absolute", () => {
    // MUTANT KILLED: passing `seo.ogImage` through unchanged. schema.org URLs
    // must be fully qualified; a bare "/og/funnel/..." is invalid.
    const image = build().primaryImageOfPage as Record<string, unknown>
    expect(image.url).toBe("https://www.darrenjpaul.com/og/funnel/athlete-quiz")
  })

  it("leaves an owner-set absolute URL alone", () => {
    // MUTANT KILLED: prefixing unconditionally, which yields
    // "https://www.darrenjpaul.comhttps://cdn...".
    const image = build({ og_image_url: "https://cdn.example.com/own.jpg" }).primaryImageOfPage as Record<
      string,
      unknown
    >
    expect(image.url).toBe("https://cdn.example.com/own.jpg")
  })
})
