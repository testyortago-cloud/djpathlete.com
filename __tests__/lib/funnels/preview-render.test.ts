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

import { renderDraftPreview } from "@/lib/funnels/preview-render"
import { getDraft } from "@/lib/db/funnel-builder"
import { listSteps } from "@/lib/db/funnels"
import { getAllPrograms, getPrograms } from "@/lib/db/programs"
import { listActiveProducts, listAllProducts } from "@/lib/db/session-pack-products"
import { getEvents, getPublishedEvents } from "@/lib/db/events"
import { getFaqCountsByPage } from "@/lib/db/faqs"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STEP_ID = "3f1b7c5e-1111-4222-8333-444444444444"
const FUNNEL_ID = "ffffffff-1111-4222-8333-444444444444"

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
    })
    expect(result.kind).toBe("doc-invalid")
  })

  it("renders a clean draft with no problems", async () => {
    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    const result = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
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
    })
    mock(getDraft).mockResolvedValue({ doc: DOC, docInvalid: false, revision: 3 })
    const preview = await renderDraftPreview({
      stepId: STEP_ID,
      funnelId: FUNNEL_ID,
      funnelBasePath: "/preview/summer-camp",
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
