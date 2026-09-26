// __tests__/lib/funnels/preview-render.test.ts
//
// The extraction exists so the builder iframe and the full-screen preview
// cannot render the same document two ways. The load-bearing test is the LAST
// one: same doc, two base paths, identical output apart from the hrefs.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db/funnel-builder", () => ({ getDraft: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({ listSteps: vi.fn() }))
vi.mock("@/lib/db/programs", () => ({ getPrograms: vi.fn(), getAllPrograms: vi.fn() }))
vi.mock("@/lib/db/session-pack-products", () => ({ listActiveProducts: vi.fn(), listAllProducts: vi.fn() }))
vi.mock("@/lib/db/events", () => ({ getEvents: vi.fn(), getPublishedEvents: vi.fn() }))
vi.mock("@/lib/db/faqs", () => ({ getFaqCountsByPage: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
// The quiz reads `loadCatalogues` makes. Unmocked they reached the dev clone
// through `.env.local` — harmless for `BUSINESS_ID`, which owns no quizzes
// there, but the G35 control below renders as the PLATFORM, which does, and a
// unit test must not depend on what the dev database holds today. Plain
// `vi.fn(async ...)` so `vi.resetAllMocks()` below leaves them callable: a
// reset `vi.fn()` returns `undefined`, and `loadCatalogues` maps over it.
vi.mock("@/lib/db/quizzes", () => ({ listQuizzes: async () => [], getQuizDefinition: async () => null }))

import { renderDraftPreview } from "@/lib/funnels/preview-render"
import { platformBusinessId } from "@/lib/tenancy/platform"
import { getDraft } from "@/lib/db/funnel-builder"
import { listSteps } from "@/lib/db/funnels"
import { getAllPrograms, getPrograms } from "@/lib/db/programs"
import { listActiveProducts, listAllProducts } from "@/lib/db/session-pack-products"
import { getEvents, getPublishedEvents } from "@/lib/db/events"
import { getFaqCountsByPage } from "@/lib/db/faqs"
import { getBusinessSettings } from "@/lib/db/businesses"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STEP_ID = "3f1b7c5e-1111-4222-8333-444444444444"
const FUNNEL_ID = "ffffffff-1111-4222-8333-444444444444"
// `businessId` is REQUIRED as of Task 7 (renderDraftPreview is a library, not
// a route -- it takes the tenant from its two real callers rather than
// resolving one itself), so every call below carries one even when a test's
// own concern is unrelated to the brand kit.
const BUSINESS_ID = "bbbbbbbb-1111-4222-8333-444444444444"

/**
 * A doc with a STEP cta — the only section whose html depends on the base.
 *
 * Shaped against the REAL `sectionDocSchema` (`v`/`engine`/`theme`, and a hero
 * whose text field is `headline`), not against what a plan assumed. `reassemble`
 * re-parses with that schema and throws, so an invented fixture returns
 * `render-failed` and every assertion below would be pinning the wrong thing.
 */
const DOC: SectionDoc = {
  v: 1,
  engine: "sections",
  theme: { tone: "light", accent: "accent", radius: "soft" },
  sections: [
    {
      id: "hero",
      kind: "hero",
      variant: "centered",
      style: {},
      props: {
        headline: "Eight weeks. Measurable rotational power.",
        primaryCta: { label: "Apply now", target: { kind: "step", stepSlug: "apply" } },
      },
    },
  ],
} as unknown as SectionDoc

function armCatalogues() {
  for (const fn of [getPrograms, getAllPrograms, listActiveProducts, listAllProducts, getEvents, getPublishedEvents]) {
    mock(fn).mockResolvedValue([])
  }
  mock(getFaqCountsByPage).mockResolvedValue({})
  mock(listSteps).mockResolvedValue([
    { id: STEP_ID, slug: "start", name: "Start" },
    { id: "other", slug: "apply", name: "Apply" },
  ])
  // No brand colour by default -- the tests in the first `describe` below are
  // not about the brand kit, so this keeps `resolveBrandKit` from throwing on
  // an unconfigured mock now that every call must pass a real businessId.
  mock(getBusinessSettings).mockResolvedValue({ brand_color: null, accent_color: null })
}

beforeEach(() => {
  // resetAllMocks, never clearAllMocks: a leaked `*Once` implementation crosses
  // test boundaries here and misattributes the failure to the wrong case.
  vi.resetAllMocks()
  armCatalogues()
})

describe("renderDraftPreview", () => {
  it("reports no-draft when the step has no document", async () => {
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 0 })
    const result = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
      businessId: BUSINESS_ID,
    })
    expect(result.kind).toBe("no-draft")
  })

  it("reports doc-invalid separately from no-draft", async () => {
    // MUTANT KILLED: collapsing the two. "Nothing to preview yet" and "this is
    // a legacy blob we cannot read" need different words on screen.
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 0 })
    const result = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
      businessId: BUSINESS_ID,
    })
    expect(result.kind).toBe("doc-invalid")
  })

  it("renders a clean draft with no problems", async () => {
    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    const result = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
      businessId: BUSINESS_ID,
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("unreachable")
    expect(result.problems).toEqual([])
    expect(JSON.stringify(result.nodes)).toContain("Eight weeks")
  })

  it("fails soft when the catalogue read throws, and says publish will refuse", async () => {
    // MUTANT KILLED: letting the throw escape. This page's whole job is "let me
    // look at my draft"; a 500 here is the one unacceptable answer.
    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    mock(getPrograms).mockRejectedValue(new Error("catalogue unreadable"))
    mock(getAllPrograms).mockRejectedValue(new Error("catalogue unreadable"))
    const result = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
      businessId: BUSINESS_ID,
    })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("unreachable")
    expect(result.problems.join(" ")).toMatch(/could not be checked/i)
  })

  it("renders step CTAs against the base path it was given — THE DRIFT GUARD", async () => {
    // This is why the module exists. The builder iframe passes /go/<slug> and
    // the full-screen preview passes /preview/<slug>; everything else about the
    // two renders must be identical, or the owner is judging a page that is not
    // the page publish ships.
    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    const live = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/go/summer-camp",
      businessId: BUSINESS_ID,
    })
    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    const preview = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
      businessId: BUSINESS_ID,
    })

    if (live.kind !== "ok" || preview.kind !== "ok") throw new Error("both should render")
    expect(JSON.stringify(live.nodes)).toContain("/go/summer-camp/apply")
    expect(JSON.stringify(preview.nodes)).toContain("/preview/summer-camp/apply")
    // MUTANT KILLED: a second rendering path. Normalise the one href that is
    // ALLOWED to differ; everything else must match byte for byte.
    const normalise = (s: string) => s.split("/preview/summer-camp").join("/go/summer-camp")
    expect(normalise(JSON.stringify(preview.nodes))).toBe(JSON.stringify(live.nodes))
    expect(preview.css).toBe(live.css)
  })
})

// ---------------------------------------------------------------------------
// The tenant brand kit — Task 9's wiring. Preview and publish disagreeing
// about the same document is this subsystem's worst failure mode (see the
// file header), so the load-bearing claim here is not just "the colour shows
// up" but "the SAME businessId produces the SAME css every time it is asked",
// which is exactly what both `/funnel-preview` and `/preview` depend on.
// ---------------------------------------------------------------------------

describe("renderDraftPreview — the tenant brand kit", () => {
  it("passes the tenant's brand colour into the rendered css", async () => {
    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    mock(getBusinessSettings).mockResolvedValue({ brand_color: "#6d28d9", accent_color: null })

    const result = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
      businessId: BUSINESS_ID,
    })

    expect(getBusinessSettings).toHaveBeenCalledWith(BUSINESS_ID)
    if (result.kind !== "ok") throw new Error("expected the draft to render")
    expect(result.css).toContain("--primary: #6d28d9")
  })

  // RETARGETED for Task 7: `businessId` used to be optional, defaulting to
  // `null`, for callers that predated the brand kit — this test pinned that
  // `getBusinessSettings` was never called for one of them. Task 7 made
  // `businessId` REQUIRED (the draft read and the step-list read it also
  // feeds are now tenant-scoped, not just the brand kit), and the only two
  // real callers already resolve a real tenant before calling this, so "no
  // businessId at all" is no longer a reachable call shape — TypeScript
  // refuses it. What is still worth pinning: a tenant with no brand colour
  // configured renders with no `--primary` override, same as before.
  it("adds no --primary override when the business has no brand colour configured", async () => {
    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    mock(getBusinessSettings).mockResolvedValue({ brand_color: null, accent_color: null })
    const result = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
      businessId: BUSINESS_ID,
    })
    expect(getBusinessSettings).toHaveBeenCalledWith(BUSINESS_ID)
    if (result.kind !== "ok") throw new Error("expected the draft to render")
    expect(result.css).not.toMatch(/--primary:/)
  })

  it("degrades to no brand kit when the business_settings read throws — still renders", async () => {
    // MUTANT: an unwrapped brand-kit read turning "look at my draft" into an
    // error page — exactly the failure mode this module's header warns is the
    // one place preview may differ from publish (it fails SOFT).
    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    mock(getBusinessSettings).mockRejectedValue(new Error("business_settings unreachable"))

    const result = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
      businessId: BUSINESS_ID,
    })

    if (result.kind !== "ok") throw new Error("a brand-kit failure must not turn the draft into an error page")
    expect(result.css).not.toMatch(/--primary:/)
  })

  it("PREVIEW AND PUBLISH PARITY: the same businessId resolves the same brand kit for the same document", async () => {
    // This is the constraint the whole shared-renderer module exists to
    // guarantee, extended to the brand kit: `/funnel-preview` (the builder's
    // iframe, `/go/<slug>` base) and `/preview` (the full-screen draft,
    // `/preview/<slug>` base) both call this same function with the same
    // businessId for the same step, and must never disagree about colour.
    mock(getBusinessSettings).mockResolvedValue({ brand_color: "#6d28d9", accent_color: "#f59e0b" })

    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    const iframe = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/go/summer-camp",
      businessId: BUSINESS_ID,
    })
    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    const fullScreen = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
      businessId: BUSINESS_ID,
    })

    if (iframe.kind !== "ok" || fullScreen.kind !== "ok") throw new Error("both should render")
    const normalise = (s: string) => s.split("/preview/summer-camp").join("/go/summer-camp")
    expect(normalise(fullScreen.css)).toBe(iframe.css)
    expect(iframe.css).toContain("--primary: #6d28d9")
    expect(iframe.css).toContain("--accent: #f59e0b")
  })
})

// ---------------------------------------------------------------------------
// G35: the canvas note on a live FAQ or testimonial section. The builder's
// iframe is the only render that shows it, and for a business that is not the
// platform it must not send the coach to the admin's FAQ and Testimonials
// lists — those are the platform's rows, which that coach's page never shows.
// `BUSINESS_ID` is not the platform's.
// ---------------------------------------------------------------------------

const LIVE_FEEDS_DOC: SectionDoc = {
  v: 1,
  engine: "sections",
  theme: { tone: "light", accent: "accent", radius: "soft" },
  sections: [
    { id: "voices", kind: "testimonial", variant: "grid", style: {}, props: { source: "live", limit: 3, featuredOnly: false } },
    { id: "questions", kind: "faq", variant: "stack", style: {}, props: { heading: "Questions", source: "live", pageKey: "camps" } },
  ],
} as unknown as SectionDoc

async function editableRender(businessId: string) {
  mock(getDraft).mockResolvedValue({ doc: LIVE_FEEDS_DOC, docInvalid: false, revision: 3 })
  const result = await renderDraftPreview({
    stepId: STEP_ID,
    funnelId: FUNNEL_ID,
    funnelBasePath: "/go/summer-camp",
    businessId,
    editable: true,
  })
  if (result.kind !== "ok") throw new Error(`expected the draft to render, got ${result.kind}`)
  return JSON.stringify(result.nodes)
}

describe("renderDraftPreview — the canvas note on a live feed (G35)", () => {
  it("tells a business off the platform to switch the section to its own content", async () => {
    // MUTANT: `renderDraftPreview` not passing the flag to `reassemble`, or
    // passing `true`. The canvas then points a coach at the platform's lists.
    const nodes = await editableRender(BUSINESS_ID)

    expect(nodes).toContain("Live testimonials are not available for this business. Switch this section to your own quotes.")
    expect(nodes).toContain("Live FAQs are not available for this business. Switch this section to your own FAQs.")
    expect(nodes).not.toMatch(/in the admin/)
  })

  it("still tells the truth when the catalogue could not be read", async () => {
    // MUTANT: the flag read off the loaded catalogue, with a guess in the
    // catch. Whether this business may use the platform's feeds is a pure
    // function of the business, so the degraded render says the same thing.
    mock(getPrograms).mockRejectedValue(new Error("catalogue unreadable"))
    mock(getAllPrograms).mockRejectedValue(new Error("catalogue unreadable"))

    const nodes = await editableRender(BUSINESS_ID)

    expect(nodes).toContain("Live FAQs are not available for this business. Switch this section to your own FAQs.")
    expect(nodes).not.toMatch(/in the admin/)
  })

  it("(control) points the platform's own canvas at its lists", async () => {
    // MUTANT: `false` passed for everyone.
    const nodes = await editableRender(platformBusinessId())

    expect(nodes).toMatch(/change them under Testimonials in the admin/)
    expect(nodes).toMatch(/change them under FAQs in the admin/)
    expect(nodes).not.toMatch(/not available for this business/)
  })
})
