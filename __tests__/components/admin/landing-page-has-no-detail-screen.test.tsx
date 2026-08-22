// __tests__/components/admin/landing-page-has-no-detail-screen.test.tsx
//
// A landing page is ONE page, so `/admin/pages/<id>` — a step list — rendered a
// single card repeating the one `/admin/pages` already shows, and leaving the
// editor dropped the owner onto that emptier copy instead of the list. Every
// control it held (go live, public URL, convert, delete) is on the list card.
//
// Three routes into the dead screen had to close together, which is why they
// are asserted together: the editor's back link, the ⚙ button on the card, and
// the URL itself. Closing two of three leaves the screen reachable and the fix
// looks done.
//
// A FUNNEL keeps all three. Its detail screen lists steps — information the
// board genuinely cannot show — so an assertion that only checked the page case
// would pass just as well on a change that deleted the screen for everyone.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { FunnelBoard } from "@/components/admin/funnels/FunnelBoard"
import type { Funnel, FunnelStep } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const funnel = (over: Partial<Funnel> = {}): Funnel => ({
  id: "f1",
  slug: "free-trial",
  name: "Free Trial",
  description: "For HS athletes.",
  status: "published",
  kind: "page",
  goal: "leads",
  created_by: null,
  created_at: "",
  updated_at: "",
  ...over,
})

const step = (over: Partial<FunnelStep> = {}): FunnelStep =>
  ({
    id: "s1",
    funnel_id: "f1",
    slug: "index",
    name: "Landing page",
    position: 0,
    is_entry: true,
    published_version_id: "v1",
    project_data: null,
    ...over,
  }) as FunnelStep

beforeEach(() => vi.clearAllMocks())

/**
 * Every link to THIS row's detail screen.
 *
 * Anchored to the row's own id rather than to a `/admin/<base>/<something>`
 * shape: the card also links `/admin/funnels/leads?funnelId=f1`, which fits
 * that shape exactly and made the first version of this test fail for a reason
 * that had nothing to do with the change.
 */
function detailLinks(container: HTMLElement): string[] {
  return [...container.querySelectorAll("a[href]")]
    .map((a) => a.getAttribute("href") ?? "")
    .filter((href) => href === "/admin/pages/f1" || href === "/admin/funnels/f1")
}

describe("the landing page board", () => {
  it("has no link to a landing page's own detail screen", () => {
    const { container } = render(
      <FunnelBoard
        kind="page"
        pages={[{ step: step(), funnel: funnel() }]}
        funnels={[funnel()]}
        leadCounts={{}}
      />,
    )

    // Asserted on the HREF, not on the icon. The ⚙ carries no accessible name,
    // so querying for the button would pass on a change that kept the link and
    // swapped the icon.
    expect(detailLinks(container)).toEqual([])
    // The card is still the way into the page itself — this must not read as
    // "the card lost its links".
    expect(container.querySelector('a[href="/admin/pages/f1/edit/s1"]')).not.toBeNull()
  })

  it("still links a FUNNEL to its step list", () => {
    const { container } = render(
      <FunnelBoard
        kind="funnel"
        pages={[{ step: step(), funnel: funnel({ kind: "funnel", goal: null }) }]}
        funnels={[funnel({ kind: "funnel", goal: null })]}
        leadCounts={{}}
      />,
    )

    expect(detailLinks(container)).toEqual(["/admin/funnels/f1"])
  })
})

describe("the builder's back link", () => {
  // The builder is heavy — it pulls the preview frame, the transcript and the
  // publish review. Only the header link is under test, so the module is loaded
  // once and the assertion reads the rendered href.
  async function renderBuilder(kind: "page" | "funnel") {
    const { FunnelBuilder } = await import("@/components/admin/funnels/FunnelBuilder")
    return render(
      <FunnelBuilder
        funnelId="f1"
        funnelName="Free Trial"
        stepId="s1"
        stepName="Landing page"
        publicUrl="/go/free-trial"
        previewUrl="/preview/free-trial"
        funnelStatus="published"
        funnelKind={kind}
        initialDoc={null}
        initialRevision={0}
        docInvalid={false}
        resetToRevision={null}
        initialUnresolved={[]}
        initialDanglingAnchors={[]}
        initialCompile={null}
        initialResolutionError={null}
        initialMessages={[]}
        initialPrompt={null}
        maxMessageLength={2000}
        renderForPublish={async () => ({ ok: true }) as never}
      />,
    )
  }

  it("takes a landing page back to the LIST, not to its own screen", async () => {
    await renderBuilder("page")
    // Scoped by name: the header renders several links, and an unscoped href
    // query would happily match a different one.
    const back = screen.getByRole("link", { name: /free trial/i })
    expect(back).toHaveAttribute("href", "/admin/pages")
  })

  it("takes a funnel back to its step list", async () => {
    await renderBuilder("funnel")
    const back = screen.getByRole("link", { name: /free trial/i })
    expect(back).toHaveAttribute("href", "/admin/funnels/f1")
  })
})

describe("/admin/pages/[id]", () => {
  // The riskiest edit in the change: a redirect that picked the wrong condition
  // could bounce between two routes forever. Each kind is asserted, including
  // the row that must NOT be redirected here.
  async function visit(funnelRow: Partial<Funnel> | null) {
    vi.resetModules()
    const redirect = vi.fn((to: string) => {
      throw new Error(`REDIRECT:${to}`)
    })
    const detail = vi.fn(() => null)

    vi.doMock("next/navigation", () => ({ redirect, notFound: vi.fn() }))
    vi.doMock("@/lib/db/funnels", () => ({
      getFunnelById: vi.fn(async () => funnelRow),
      listSteps: vi.fn(async () => []),
    }))
    vi.doMock("@/app/(admin)/admin/funnels/[id]/page", () => ({ FunnelDetailScreen: detail }))

    const mod = await import("@/app/(admin)/admin/pages/[id]/page")
    let redirectedTo: string | null = null
    // The ELEMENT the route returned, not a call to the component: returning
    // `<FunnelDetailScreen …/>` does not invoke it, so a "was it called"
    // assertion fails no matter what the route does.
    let rendered: { type: unknown; props: Record<string, unknown> } | null = null
    try {
      rendered = (await mod.default({ params: Promise.resolve({ id: "f1" }) })) as typeof rendered
    } catch (error) {
      const match = /^REDIRECT:(.*)$/.exec((error as Error).message)
      if (!match) throw error
      redirectedTo = match[1]
    }
    return { redirectedTo, rendered, detail }
  }

  it("sends a landing page to the list", async () => {
    const { redirectedTo } = await visit(funnel())
    expect(redirectedTo).toBe("/admin/pages")
  })

  it("hands a FUNNEL to the shared screen, which owns the mismatch redirect", async () => {
    // MUTANT KILLED: redirecting unconditionally. That would send a funnel
    // reached on this URL to the landing-pages list — the wrong tab, which is
    // the bug this whole split exists to prevent.
    const { redirectedTo, rendered, detail } = await visit(funnel({ kind: "funnel" }))
    expect(redirectedTo).toBeNull()
    expect(rendered?.type).toBe(detail)
    // `base: "pages"` is the load-bearing half — it is what tells the shared
    // screen it was reached on the wrong URL and must redirect to /admin/funnels.
    expect(rendered?.props).toMatchObject({ id: "f1", base: "pages" })
  })

  it("hands a missing row to the shared screen, which owns notFound()", async () => {
    const { redirectedTo, rendered, detail } = await visit(null)
    expect(redirectedTo).toBeNull()
    expect(rendered?.type).toBe(detail)
  })
})
