// @vitest-environment node
//
// G35 §B2 — the platform's live FAQs and testimonials appear on the platform's
// pages ONLY.
//
// `faqs` and `testimonials` have no `business_id` column, so every row either
// island can show is the platform's own ("What is DJP Athlete?", its athletes'
// quotes). On another business's funnel page those rows would read as that
// coach's, so the islands render NOTHING there — the chat's booking offer
// makes the same call (lib/calendly/config-for-business.ts).
//
// The business is the one the ROUTE resolved and put on the render context,
// never the Host read inside the island: on /preview and /funnel-preview the
// Host is the admin's, not the funnel's, and preview must agree with /go.
//
// The islands are async server components, so they are CALLED and the element
// they return is inspected (the quiz-island-context.test.tsx pattern). Each
// absence test has its presence control directly beneath it.
import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactElement } from "react"

const listFaqsForPage = vi.fn()
const getTestimonials = vi.fn()
const getFeaturedTestimonials = vi.fn()

vi.mock("@/lib/db/faqs", () => ({ listFaqsForPage: (...a: unknown[]) => listFaqsForPage(...a) }))
vi.mock("@/lib/db/testimonials", () => ({
  getTestimonials: (...a: unknown[]) => getTestimonials(...a),
  getFeaturedTestimonials: (...a: unknown[]) => getFeaturedTestimonials(...a),
}))
// A sentinel rather than the real constant, so an island that compared against
// a hard-coded platform literal cannot pass.
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))
// The Host is deliberately the PLATFORM here. An island that resolved the Host
// instead of reading `context.businessId` would conclude "this is the
// platform's page" and render the platform's rows on the coach's page below —
// the preview-route disagreement the context exists to stop.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "platform-biz" }))

import { FaqIsland } from "@/components/funnels/islands/FaqIsland"
import { TestimonialsIsland } from "@/components/funnels/islands/TestimonialsIsland"
import { renderIsland, type FunnelRenderContext } from "@/components/funnels/islands"

const PLATFORM = "platform-biz"
const COACH = "coach-biz"

function contextFor(businessId: string): FunnelRenderContext {
  return {
    funnelId: "ffffffff-1111-4222-8333-444444444444",
    funnelSlug: "summer-camp",
    stepId: "3f1b7c5e-1111-4222-8333-444444444444",
    stepSlug: "index",
    isPreview: false,
    businessId,
  }
}

// No apostrophes: renderToStaticMarkup escapes one to `&#x27;`, and a
// `toContain` on the raw string would then fail for a reason that has nothing
// to do with tenancy.
const FAQ_ROW = { id: "faq-1", page_key: "home", question: "What is DJP Athlete?", answer: "A performance gym." }
const QUOTE_ROW = { id: "t-1", name: "Platform Athlete", quote: "Best coach I have trained with.", sport: "Baseball" }

beforeEach(() => {
  vi.resetAllMocks()
  listFaqsForPage.mockResolvedValue([FAQ_ROW])
  getTestimonials.mockResolvedValue([QUOTE_ROW])
  getFeaturedTestimonials.mockResolvedValue([QUOTE_ROW])
})

describe("FaqIsland on a page whose business is not the platform", () => {
  it("renders nothing, and never reads the faqs table", async () => {
    // MUTANT 1: no check at all — the coach's page shows "What is DJP
    // Athlete?" as its own FAQ. MUTANT 2: the check placed AFTER the read —
    // the result is still null, so only the call assertion can see it.
    const element = await FaqIsland({ props: { pageKey: "home" }, context: contextFor(COACH) })

    expect(element).toBeNull()
    expect(listFaqsForPage).not.toHaveBeenCalled()
  })

  it("(control) still renders the platform's own FAQs on the platform's page", async () => {
    // Without this, an island that returned null for everyone would pass the
    // test above.
    const element = (await FaqIsland({ props: { pageKey: "home" }, context: contextFor(PLATFORM) })) as ReactElement

    expect(renderToStaticMarkup(element)).toContain("What is DJP Athlete?")
    expect(listFaqsForPage).toHaveBeenCalledWith("home", { publishedOnly: true })
  })
})

describe("TestimonialsIsland on a page whose business is not the platform", () => {
  it("renders nothing, and reads neither testimonial list", async () => {
    // The same two mutants as the FAQ island. `featuredOnly: true` so the
    // featured reader is covered; the default path reads `getTestimonials`,
    // and both must stay untouched.
    const element = await TestimonialsIsland({ props: { featuredOnly: true }, context: contextFor(COACH) })

    expect(element).toBeNull()
    expect(getFeaturedTestimonials).not.toHaveBeenCalled()
    expect(getTestimonials).not.toHaveBeenCalled()
  })

  it("(control) still renders the platform's own testimonials on the platform's page", async () => {
    const element = (await TestimonialsIsland({ props: {}, context: contextFor(PLATFORM) })) as ReactElement

    expect(renderToStaticMarkup(element)).toContain("Best coach I have trained with.")
    expect(getTestimonials).toHaveBeenCalledWith(true)
  })
})

describe("renderIsland hands both live islands the page's context", () => {
  it.each(["faq", "testimonials"] as const)("passes the route's context to the %s island", (name) => {
    // MUTANT: `<FaqIsland props={props} />` with no context — what the registry
    // did before G35 (tsc refuses that now the prop is required) — or a
    // context rebuilt inside renderIsland, which WOULD type-check. `toBe`, so
    // only the route's own object passes.
    const context = contextFor(COACH)
    const element = renderIsland(name, { pageKey: "home" }, context) as ReactElement<{ context: FunnelRenderContext }>

    expect(element.props.context).toBe(context)
  })
})
