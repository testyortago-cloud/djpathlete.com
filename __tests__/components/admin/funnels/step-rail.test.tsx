// components/admin/funnels/StepRail.tsx — the funnel drawn as a funnel.
//
// EVERY QUERY IS SCOPED WITH `within`. A rail renders N rows carrying similar
// text, and this repo has twice shipped a test that found the wrong one and
// passed for the wrong reason. `getByText(/thanks/i)` unscoped would match a
// row title, an arrow label and a destination name.
//
// `@testing-library/user-event` is not a dependency here — `fireEvent` only.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within, fireEvent } from "@testing-library/react"

const pathnameMock = vi.fn(() => "/admin/funnels/f1/edit/s1")
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }))
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { StepRail } from "@/components/admin/funnels/StepRail"
import {
  ConnectionsProvider,
  useRegisterRepair,
  type RailPage,
} from "@/components/admin/funnels/connections-context"
import type { StepWithDoc } from "@/lib/funnels/connections"
import type { Section, SectionDoc } from "@/lib/funnels/sections/registry"

function docOf(sections: Section[]): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections,
  } as SectionDoc
}

function heroWith(target: unknown, label = "Get my spot"): SectionDoc {
  return docOf([
    {
      id: "he1",
      kind: "hero",
      variant: "centered",
      style: {},
      props: { headline: "Camp", primaryCta: { label, target } },
    } as Section,
  ])
}

const PAGES: RailPage[] = [
  { id: "s1", name: "Opt-in", slug: "index", position: 0, isEntry: true, published: true, live: true },
  { id: "s2", name: "Thanks", slug: "thanks", position: 1, isEntry: false, published: false, live: false },
]

function docsFor(first: SectionDoc | null): StepWithDoc[] {
  return [
    { id: "s1", name: "Opt-in", slug: "index", position: 0, isEntry: true, doc: first },
    { id: "s2", name: "Thanks", slug: "thanks", position: 1, isEntry: false, doc: null },
  ]
}

function renderRail(first: SectionDoc | null, pages: RailPage[] = PAGES) {
  render(
    <ConnectionsProvider
      funnelId="f1"
      funnelSlug="camp"
      funnelKind="funnel"
      pages={pages}
      initialDocs={docsFor(first).slice(0, pages.length)}
    >
      <StepRail />
    </ConnectionsProvider>,
  )
  return screen.getByRole("navigation", { name: /pages in this funnel/i })
}

beforeEach(() => {
  pathnameMock.mockReturnValue("/admin/funnels/f1/edit/s1")
})

describe("StepRail", () => {
  it("lists every page in position order, with its slug", () => {
    const rail = renderRail(heroWith({ kind: "step", stepSlug: "thanks" }))
    const items = within(rail).getAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText("Opt-in")).toBeInTheDocument()
    expect(within(items[0]).getByText("/index")).toBeInTheDocument()
    expect(within(items[1]).getByText("Thanks")).toBeInTheDocument()
  })

  it("orders by POSITION, not by the order it was handed the pages", () => {
    // MUTANT TO KILL: rendering `pages` as given. The rail is the owner's
    // mental model of the sequence, so a wrong order is worse than no rail.
    const reversed = [PAGES[1], PAGES[0]]
    render(
      <ConnectionsProvider
        funnelId="f1"
        funnelSlug="camp"
        funnelKind="funnel"
        pages={reversed}
        initialDocs={docsFor(null)}
      >
        <StepRail />
      </ConnectionsProvider>,
    )
    const rail = screen.getByRole("navigation", { name: /pages in this funnel/i })
    const items = within(rail).getAllByRole("listitem")
    expect(within(items[0]).getByText("Opt-in")).toBeInTheDocument()
  })

  it("marks the page being edited as current, and links the others", () => {
    const rail = renderRail(null)
    const items = within(rail).getAllByRole("listitem")
    expect(within(items[0]).getByRole("link")).toHaveAttribute("aria-current", "page")
    expect(within(items[1]).getByRole("link")).not.toHaveAttribute("aria-current")
    expect(within(items[1]).getByRole("link")).toHaveAttribute(
      "href",
      "/admin/funnels/f1/edit/s2",
    )
  })

  it("draws an arrow naming the button that carries the link and where it goes", () => {
    const rail = renderRail(heroWith({ kind: "step", stepSlug: "thanks" }))
    const items = within(rail).getAllByRole("listitem")
    expect(within(items[0]).getByText("Get my spot")).toBeInTheDocument()
    expect(within(items[0]).getByText(/→\s*Thanks/)).toBeInTheDocument()
  })

  it("draws ONE arrow PER exit, because a page may legitimately have two", () => {
    const doc = docOf([
      {
        id: "he1",
        kind: "hero",
        variant: "centered",
        style: {},
        props: {
          headline: "Camp",
          primaryCta: { label: "Get my spot", target: { kind: "step", stepSlug: "thanks" } },
          secondaryCta: { label: "Skip ahead", target: { kind: "step", stepSlug: "thanks" } },
        },
      } as Section,
    ])
    const rail = renderRail(doc)
    const items = within(rail).getAllByRole("listitem")
    expect(within(items[0]).getByText("Get my spot")).toBeInTheDocument()
    expect(within(items[0]).getByText("Skip ahead")).toBeInTheDocument()
  })

  it("names the missing page when a link is broken, rather than just flagging it", () => {
    const rail = renderRail(heroWith({ kind: "step", stepSlug: "offer-page" }))
    const items = within(rail).getAllByRole("listitem")
    // The slug is the only thing the owner can search their page list for.
    expect(within(items[0]).getByText(/no page called/i)).toBeInTheDocument()
    expect(within(items[0]).getByText(/offer-page/)).toBeInTheDocument()
  })

  it("says a non-final page with no exit leads nowhere", () => {
    const rail = renderRail(heroWith({ kind: "url", href: "/" }))
    const items = within(rail).getAllByRole("listitem")
    expect(within(items[0]).getByText(/leads nowhere/i)).toBeInTheDocument()
  })

  it("does NOT call the last page a dead end — it is supposed to end", () => {
    // MUTANT TO KILL: warning on any page with no exit. A thank-you page ends
    // by design, and a rail that nags about it teaches the owner to ignore it,
    // which costs the real warnings their meaning.
    const rail = renderRail(heroWith({ kind: "step", stepSlug: "thanks" }))
    const items = within(rail).getAllByRole("listitem")
    expect(within(items[1]).queryByText(/leads nowhere/i)).toBeNull()
    expect(within(items[1]).getByText(/ends here/i)).toBeInTheDocument()
  })

  it("shows live only when the page is published AND the funnel is", () => {
    const rail = renderRail(null)
    const items = within(rail).getAllByRole("listitem")
    expect(within(items[0]).getByText("live")).toBeInTheDocument()
    expect(within(items[1]).getByText("never published")).toBeInTheDocument()
  })

  it("says page, never step", () => {
    // The owner-facing vocabulary the funnel screens already use. "Step" is
    // the column name, not their word.
    const rail = renderRail(heroWith({ kind: "step", stepSlug: "thanks" }))
    expect(within(rail).queryByText(/\bstep\b/i)).toBeNull()
  })

  it("renders nothing for a single-page funnel", () => {
    // A landing page always lands here. A one-row rail costs 220px to say
    // nothing, so the landing-page editor is unchanged by this feature.
    render(
      <ConnectionsProvider
        funnelId="f1"
        funnelSlug="camp"
        funnelKind="page"
        pages={[PAGES[0]]}
        initialDocs={docsFor(null).slice(0, 1)}
      >
        <StepRail />
      </ConnectionsProvider>,
    )
    expect(screen.queryByRole("navigation", { name: /pages in this funnel/i })).toBeNull()
  })

  it("renders nothing outside a provider, rather than throwing", () => {
    // `FunnelBuilder` mounts standalone in tests and in the preview harness.
    render(<StepRail />)
    expect(screen.queryByRole("navigation", { name: /pages in this funnel/i })).toBeNull()
  })

  it("links to /admin/pages for a landing page, so the sidebar lights the right tab", () => {
    const pages: RailPage[] = [
      PAGES[0],
      { ...PAGES[1], id: "s2" },
    ]
    render(
      <ConnectionsProvider
        funnelId="f1"
        funnelSlug="camp"
        funnelKind="page"
        pages={pages}
        initialDocs={docsFor(null)}
      >
        <StepRail />
      </ConnectionsProvider>,
    )
    const rail = screen.getByRole("navigation", { name: /pages in this funnel/i })
    const items = within(rail).getAllByRole("listitem")
    expect(within(items[1]).getByRole("link")).toHaveAttribute("href", "/admin/pages/f1/edit/s2")
  })
})

// ---------------------------------------------------------------------------
// "Connect to <page>" — the repair tool, offered where the problem is named.
//
// It can only ever act on the page the BUILDER is holding, because applying
// ops needs a revision and the layout has none. So the rail reports every page
// that leads nowhere and offers the fix on exactly one of them.
// ---------------------------------------------------------------------------
describe("StepRail — connecting a page that leads nowhere", () => {
  const apply = vi.fn()

  function renderWithRepair(first: SectionDoc | null, stepId = "s1") {
    render(
      <ConnectionsProvider
        funnelId="f1"
        funnelSlug="camp"
        funnelKind="funnel"
        pages={PAGES}
        initialDocs={docsFor(first)}
      >
        <RepairRegistration stepId={stepId} apply={apply} />
        <StepRail />
      </ConnectionsProvider>,
    )
    return screen.getByRole("navigation", { name: /pages in this funnel/i })
  }

  beforeEach(() => {
    apply.mockClear()
    vi.spyOn(window, "confirm").mockReturnValue(true)
  })

  it("offers the fix on the page being edited", () => {
    const rail = renderWithRepair(heroWith({ kind: "url", href: "/" }))
    const items = within(rail).getAllByRole("listitem")
    expect(within(items[0]).getByRole("button", { name: /connect to thanks/i })).toBeInTheDocument()
  })

  it("previews every change and applies NOTHING when the owner cancels", () => {
    // MUTANT KILLED: applying first and confirming after, or not confirming.
    // This rewrites the owner's page; doing it without showing what changes
    // means diffing their own page afterwards to find out.
    vi.spyOn(window, "confirm").mockReturnValue(false)
    const rail = renderWithRepair(heroWith({ kind: "url", href: "/" }))
    fireEvent.click(within(rail).getByRole("button", { name: /connect to thanks/i }))
    expect(window.confirm).toHaveBeenCalled()
    expect(String(vi.mocked(window.confirm).mock.calls[0][0])).toContain("Get my spot")
    expect(apply).not.toHaveBeenCalled()
  })

  it("sends the repair through the builder's own writer, so it is revertible", () => {
    const rail = renderWithRepair(heroWith({ kind: "url", href: "/" }))
    fireEvent.click(within(rail).getByRole("button", { name: /connect to thanks/i }))
    expect(apply).toHaveBeenCalledWith([
      {
        op: "update_section",
        id: "he1",
        props: {
          primaryCta: { label: "Get my spot", target: { kind: "step", stepSlug: "thanks" } },
        },
      },
    ])
  })

  it("does NOT offer a fix on a page the builder is not holding", () => {
    // No revision for it, so the write would either skip the staleness check
    // or invent one — both are silently clobbering another tab.
    const rail = renderWithRepair(heroWith({ kind: "url", href: "/" }), "s2")
    expect(within(rail).queryByRole("button", { name: /connect to/i })).toBeNull()
  })

  it("does NOT offer a fix when every button is a deliberate choice", () => {
    // MUTANT TO KILL: rendering the button whenever a page leads nowhere. A
    // program CTA is a real destination the repair tool refuses to touch, so
    // the button would be pressable and do nothing — which teaches the owner
    // the control is broken.
    const rail = renderWithRepair(heroWith({ kind: "program", ref: "Comeback Code" }))
    expect(within(rail).queryByRole("button", { name: /connect to/i })).toBeNull()
    // The warning still stands: the page really does lead nowhere.
    const items = within(rail).getAllByRole("listitem")
    expect(within(items[0]).getByText(/leads nowhere/i)).toBeInTheDocument()
  })

  it("offers no fix on the last page, which is supposed to end", () => {
    const rail = renderWithRepair(null, "s2")
    expect(within(rail).queryByRole("button", { name: /connect to/i })).toBeNull()
  })
})

/** Stands in for `FunnelBuilder`, lending the rail a writer for one page. */
function RepairRegistration({ stepId, apply }: { stepId: string; apply: (ops: unknown[]) => void }) {
  useRegisterRepair(stepId, apply as never)
  return null
}
