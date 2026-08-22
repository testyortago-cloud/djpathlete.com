// __tests__/app/draft-preview-route.test.tsx
//
// /preview/<slug>/<step> — the FULL-SCREEN draft.
//
// It mirrors /go's path shape so that `funnelBasePath` alone walks the funnel;
// everything else about it is the gate and the fail-soft notices. The two
// load-bearing claims are "only an admin or staff member sees it" and "its
// in-funnel buttons stay inside the preview".

import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactElement } from "react"

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/funnels", () => ({ getFunnelBySlug: vi.fn(), listSteps: vi.fn() }))
vi.mock("@/lib/funnels/preview-render", () => ({ renderDraftPreview: vi.fn() }))
// The renderer walks compiled nodes and reaches async islands; this page's
// tests are about the gate and the base path, not about island internals.
vi.mock("@/components/funnels/NodeRenderer", () => ({
  NodeRenderer: () => null,
}))

import Page, { metadata } from "@/app/(funnel)/preview/[slug]/[[...step]]/page"
import { auth } from "@/lib/auth"
import { getFunnelBySlug, listSteps } from "@/lib/db/funnels"
import { renderDraftPreview } from "@/lib/funnels/preview-render"

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const FUNNEL = {
  id: "ffffffff-1111-4222-8333-444444444444",
  slug: "summer-camp",
  name: "Summer camp",
  status: "draft",
  kind: "funnel",
}
const ENTRY = { id: "step-1", slug: "start", name: "Start", is_entry: true, position: 0, published_version_id: null }
const SECOND = { id: "step-2", slug: "thanks", name: "Thanks", is_entry: false, position: 1, published_version_id: null }

const render = (slug: string, step?: string[]) => Page({ params: Promise.resolve({ slug, step }) })
const html = async (slug: string, step?: string[]) =>
  renderToStaticMarkup((await render(slug, step)) as ReactElement)

beforeEach(() => {
  vi.resetAllMocks()
  mock(auth).mockResolvedValue({ user: { role: "admin" } })
  mock(getFunnelBySlug).mockResolvedValue(FUNNEL)
  mock(listSteps).mockResolvedValue([ENTRY, SECOND])
  mock(renderDraftPreview).mockResolvedValue({ kind: "ok", nodes: [], css: ".x{}", problems: [] })
})

describe("the gate", () => {
  it("404s anonymous, a client, and a session with no role", async () => {
    for (const session of [null, { user: { role: "client" } }, { user: {} }]) {
      mock(auth).mockResolvedValue(session)
      await expect(render("summer-camp")).rejects.toThrow("NEXT_NOT_FOUND")
    }
  })

  it("lets an admin and a staff member through", async () => {
    for (const role of ["admin", "staff"]) {
      mock(auth).mockResolvedValue({ user: { role } })
      await expect(render("summer-camp")).resolves.toBeTruthy()
    }
  })

  it("404s an unknown funnel slug", async () => {
    mock(getFunnelBySlug).mockResolvedValue(null)
    await expect(render("nope")).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("404s more than one segment past the slug", async () => {
    // MUTANT KILLED: dropping the catch-all length check /go already has.
    await expect(render("summer-camp", ["a", "b"])).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("is never indexed", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})

describe("which step it renders", () => {
  it("renders the entry step when no step segment is given", async () => {
    await render("summer-camp")
    expect(mock(renderDraftPreview).mock.calls[0][0].stepId).toBe("step-1")
  })

  it("renders the named step", async () => {
    await render("summer-camp", ["thanks"])
    expect(mock(renderDraftPreview).mock.calls[0][0].stepId).toBe("step-2")
  })

  it("404s a step slug this funnel does not have", async () => {
    await expect(render("summer-camp", ["ghost"])).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("renders against the PREVIEW base so in-funnel buttons stay in the preview", async () => {
    // MUTANT KILLED: passing /go/<slug>. Every step button would leave the
    // preview for a route that 404s until publish — the exact complaint that
    // this whole feature answers.
    await render("summer-camp")
    expect(mock(renderDraftPreview).mock.calls[0][0].funnelBasePath).toBe("/preview/summer-camp")
  })

  it("never renders editable, whatever else is passed", async () => {
    // MUTANT KILLED: accepting ?edit=1 here. The canvas anchors belong to the
    // builder's iframe alone; a slug-addressed URL must not reach them.
    await render("summer-camp")
    expect(mock(renderDraftPreview).mock.calls[0][0].editable).not.toBe(true)
  })
})

describe("what the owner sees", () => {
  it("shows the pill saying this is not the live page", async () => {
    expect(await html("summer-camp")).toMatch(/not published/i)
  })

  it("shows the publish-blocked banner above the page", async () => {
    mock(renderDraftPreview).mockResolvedValue({
      kind: "ok",
      nodes: [],
      css: "",
      problems: ["Two buy buttons on this page are dead."],
    })
    expect(await html("summer-camp")).toContain("Two buy buttons on this page are dead.")
  })

  it("says nothing to preview yet rather than 404ing an undrafted step", async () => {
    // MUTANT KILLED: notFound() here. "This page does not exist" is a different
    // and wrong statement from "you have not written it yet".
    mock(renderDraftPreview).mockResolvedValue({ kind: "no-draft" })
    expect(await html("summer-camp")).toMatch(/nothing to preview yet/i)
  })

  it("explains a document it cannot read, and keeps the pill", async () => {
    mock(renderDraftPreview).mockResolvedValue({ kind: "doc-invalid" })
    const out = await html("summer-camp")
    // NOT /can't be previewed/ — renderToStaticMarkup escapes the apostrophe to
    // `&#x27;`, so the obvious regex silently never matches and the assertion
    // passes for the wrong reason on any other copy.
    expect(out).toMatch(/be previewed/i)
    expect(out).toMatch(/old\s+drag-and-drop editor/i)
    expect(out).toMatch(/not published/i)
  })

  it("reports a page that will not compile", async () => {
    mock(renderDraftPreview).mockResolvedValue({ kind: "compile-failed", problems: ["Unknown element <marquee>."] })
    expect(await html("summer-camp")).toContain("Unknown element")
  })
})
