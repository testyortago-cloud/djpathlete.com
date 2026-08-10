// __tests__/app/funnel-draft-preview-page.test.tsx
//
// The draft preview exists because `?preview=1` on /go/... CANNOT show a
// draft: `getPublishedStep(..., {includeUnpublished: true})` never reads
// `project_data` and falls back to the newest VERSION row. The tests below are
// written around that: the strongest claim this page makes is that what it
// renders came from `project_data` THIS REQUEST, through the same compiler
// publish uses.
//
// Each test names the mutant it kills.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/funnel-builder", () => ({ getDraft: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({ getStep: vi.fn(), getFunnelById: vi.fn() }))

import Page from "@/app/(funnel)/funnel-preview/[stepId]/page"
import { metadata } from "@/app/(funnel)/funnel-preview/[stepId]/page"
import { auth } from "@/lib/auth"
import { getDraft } from "@/lib/db/funnel-builder"
import { getFunnelById, getStep } from "@/lib/db/funnels"
import { FUNNEL_ROOT_ID } from "@/lib/funnels/compile"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import type { FunnelNode } from "@/lib/funnels/compile/types"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STEP_ID = "3f1b7c5e-1111-4222-8333-444444444444"
const STEP = { id: STEP_ID, funnel_id: "ffffffff-1111-4222-8333-444444444444", slug: "apply", name: "Apply" }
const FUNNEL = { id: STEP.funnel_id, slug: "summer-camp", name: "Summer camp", status: "draft" }

const HEADLINE = "Eight weeks. Measurable rotational power."

function doc(): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero",
        kind: "hero",
        variant: "centered",
        style: { headline: "xl" },
        props: {
          headline: HEADLINE,
          primaryCta: { label: "See the plans", target: { kind: "anchor", sectionId: "pricing" } },
        },
      },
      {
        id: "pricing",
        kind: "pricing",
        variant: "single",
        style: {},
        props: {
          heading: "One plan",
          plans: [
            {
              name: "Eight weeks",
              price: "$480",
              features: ["Two sessions a week"],
              // A step CTA, so the funnelBasePath thread is observable.
              cta: { label: "Apply", target: { kind: "step", stepSlug: "thanks" } },
            },
          ],
        },
      },
    ],
  }
}

const render = () => Page({ params: Promise.resolve({ stepId: STEP_ID }) })

/** Walks a returned element tree for the NodeRenderer's `nodes` prop. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findNodes(element: any): FunnelNode[] | null {
  if (!element || typeof element !== "object") return null
  if (element.props && Array.isArray(element.props.nodes)) return element.props.nodes as FunnelNode[]
  const children = element.props?.children
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    const found = findNodes(child)
    if (found) return found
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findContext(element: any): Record<string, unknown> | null {
  if (!element || typeof element !== "object") return null
  if (element.props && element.props.context) return element.props.context as Record<string, unknown>
  const children = element.props?.children
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    const found = findContext(child)
    if (found) return found
  }
  return null
}

/** Every text node in the tree, concatenated — enough to assert copy reached the page. */
function textOf(nodes: FunnelNode[]): string {
  return nodes
    .map((node) => {
      if (node.t === "text") return node.v
      if (node.t === "el") return textOf(node.children)
      return ""
    })
    .join(" ")
}

function allElements(nodes: FunnelNode[]): Extract<FunnelNode, { t: "el" }>[] {
  const out: Extract<FunnelNode, { t: "el" }>[] = []
  for (const node of nodes) {
    if (node.t === "el") {
      out.push(node)
      out.push(...allElements(node.children))
    }
  }
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  mock(auth).mockResolvedValue({ user: { id: "u1", role: "admin" } })
  mock(getDraft).mockResolvedValue({ doc: doc(), docInvalid: false, revision: 4 })
  mock(getStep).mockResolvedValue(STEP)
  mock(getFunnelById).mockResolvedValue(FUNNEL)
})

describe("/funnel-preview/[stepId] — the gate", () => {
  it("404s an anonymous visitor without touching the draft", async () => {
    // MUTANT: no self-gate. `middleware.ts` matches only /admin/* and
    // /client/*, so this path is PUBLIC unless the page itself refuses — and an
    // unpublished draft is exactly the thing that must not leak.
    mock(auth).mockResolvedValue(null)
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(getDraft).not.toHaveBeenCalled()
  })

  it("404s a client, and does not confirm the step exists", async () => {
    // MUTANT: `redirect("/login")` instead of `notFound()`, which tells an
    // unauthorised visitor that this step id is real.
    mock(auth).mockResolvedValue({ user: { id: "u2", role: "client" } })
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(getDraft).not.toHaveBeenCalled()
  })

  it("lets staff in, not just admins", async () => {
    // MUTANT: gating on `role === "admin"` alone. Staff are the people who
    // build these pages; a preview they cannot open reads as broken.
    mock(auth).mockResolvedValue({ user: { id: "u3", role: "staff" } })
    const element = await render()
    expect(findNodes(element)).toBeTruthy()
  })

  it("404s an unknown step", async () => {
    mock(getDraft).mockResolvedValue(null)
    mock(getStep).mockResolvedValue(null)
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("is marked noindex", async () => {
    // MUTANT: omitting the robots directive. A draft that gets indexed
    // competes with the published page it is a draft of.
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})

describe("/funnel-preview/[stepId] — what it renders", () => {
  it("renders the DRAFT from project_data, compiled, inside the funnel root", async () => {
    // MUTANT: reading the published version row (the bug this route exists to
    // fix). `getDraft` is the only source of the headline below, and
    // `getPublishedStep` is not even imported — asserting the copy arrives
    // proves the draft was the source.
    const element = await render()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((element as any).props.id).toBe(FUNNEL_ROOT_ID)

    const nodes = findNodes(element)
    expect(nodes).toBeTruthy()
    expect(textOf(nodes!)).toContain(HEADLINE)
  })

  it("keeps every attribute through the compile round trip — dropped ones are SILENT", async () => {
    // MUTANT: any renderer/compiler drift that makes `filterAttrs` drop an
    // attribute. `compiled.ok` cannot see it — a `<a>` stripped of its href is
    // perfectly valid markup and compiles green. So this asserts the two
    // attributes that would go missing: the in-page anchor and the step link
    // built from `funnelBasePath`. The step href in particular proves
    // `funnelBasePath` was threaded through `reassemble` at all — without it
    // render.ts degrades that CTA to a disabled <span> with no href, and
    // nothing else in the page would look different.
    const nodes = findNodes(await render())!
    const hrefs = allElements(nodes)
      .filter((el) => el.tag === "a")
      .map((el) => el.attrs.href)
    expect(hrefs).toContain("#pricing")
    expect(hrefs).toContain("/go/summer-camp/thanks")
  })

  it("marks the render as a preview so islands cannot create real records", async () => {
    // MUTANT: `isPreview: false`, or deriving it from a query string. A draft
    // preview that posts a real lead or opens a real Stripe session puts
    // rubbish in the owner's live data.
    const context = findContext(await render())
    expect(context).toMatchObject({
      isPreview: true,
      funnelId: FUNNEL.id,
      funnelSlug: FUNNEL.slug,
      stepId: STEP_ID,
      stepSlug: STEP.slug,
    })
  })

  it("emits the scoped stylesheet", async () => {
    // MUTANT: rendering nodes without the CSS. Every section would appear
    // unstyled, which reads as "the AI built a broken page".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = (await render()) as any
    const children = element.props.children as unknown[]
    const style = children.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (child: any) => child && child.type === "style",
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const css = (style as any).props.dangerouslySetInnerHTML.__html as string
    expect(css).toContain(`#${FUNNEL_ROOT_ID}`)
  })
})

describe("/funnel-preview/[stepId] — the pages that are not pages", () => {
  it("explains an unreadable draft instead of 404ing or throwing", async () => {
    // MUTANT 1: `notFound()`, which says the step does not exist — a different
    // and wrong statement that sends the owner looking for a deleted page.
    // MUTANT 2: treating `docInvalid` as `doc: null` and showing "nothing yet",
    // which invites the owner to overwrite a page that is still there.
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 4 })
    const element = await render()
    expect(findNodes(element)).toBeNull()
    expect(JSON.stringify(element)).toContain("can't be previewed")
  })

  it("says there is nothing to preview when no draft exists", async () => {
    mock(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 0 })
    const element = await render()
    expect(findNodes(element)).toBeNull()
    expect(JSON.stringify(element)).toContain("Nothing to preview yet")
  })

  // NOTE ON A TEST THAT IS DELIBERATELY ABSENT. There is no "renders
  // compiled.errors" test, because a document the REGISTRY accepts and the
  // compiler then rejects is not constructible: every island the renderer
  // emits is built from props render.ts has already validated, and an
  // unresolved CTA degrades to a disabled span rather than an invalid island.
  // Writing one anyway would mean stubbing `compileFunnelStep`, which would
  // assert only that a branch exists — the exact shape of test this repo keeps
  // shipping and this feature has already produced six of. The reachable
  // failure is a throw from `reassemble`, and that one is proven below.

  it("reports a document reassemble refuses rather than 500ing", async () => {
    // MUTANT: no try/catch around `reassemble`. It re-parses the document and
    // THROWS on a bad one; an uncaught throw in a server component is a 500
    // error page for an owner who only wanted to look at their draft.
    mock(getDraft).mockResolvedValue({
      // Past `getDraft`'s own parse in this test because that parse is mocked —
      // which is exactly the real-world shape of the hazard: a document that
      // was valid when stored and stopped being valid when the registry
      // tightened.
      doc: { v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" }, sections: [] },
      docInvalid: false,
      revision: 1,
    })
    const element = await render()
    expect(findNodes(element)).toBeNull()
    expect(JSON.stringify(element)).toContain("can't be rendered")
  })
})
