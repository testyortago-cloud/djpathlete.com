// __tests__/components/admin/funnel-list.test.tsx
//
// THE REPORT, verbatim: "why connected funnels is not compiled, and also the
// category filter is wrong its filtering the name".
//
// Both halves were the same decision. The funnels screen rendered ONE CARD PER
// STEP and put the funnel's NAME in a filter chip above them — so a three-step
// funnel was three loose cards plus a chip, the funnel itself had no card, and
// the chip read as a category the owner had assigned. `FunnelBoard`'s own
// comment already admitted the second half.
//
// EVERY TEST HERE NAMES THE MUTANT IT KILLS. This repo's dominant defect class
// is a test that cannot fail, and this feature's sibling plan shipped six of
// them in one night.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within, fireEvent } from "@testing-library/react"
import { FunnelList } from "@/components/admin/funnels/FunnelList"
import type { Funnel, FunnelStep } from "@/types/database"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

// next/navigation is globally mocked in __tests__/setup.tsx.

function funnel(overrides: Partial<Funnel> = {}): Funnel {
  return {
    id: "f1",
    slug: "ten-session-pack",
    name: "Ten-Session Pack",
    kind: "funnel",
    status: "draft",
    goal: null,
    description: null,
    // SPREAD LAST, and its absence was a real bug in this file's first draft:
    // without it every `funnel({...})` returned the same row, so the two-funnel
    // tests rendered one funnel twice and the live-badge test asserted against
    // a DRAFT funnel while claiming to test a published one. It passed. That is
    // this repo's dominant defect class reproduced in the helper rather than in
    // an assertion, where it is harder to see.
    ...overrides,
  } as unknown as Funnel
}

/**
 * A one-hero page whose only CTA points at `toSlug`.
 *
 * `primaryCta`, NOT `cta` — `heroPropsSchema` requires `primaryCta` and has no
 * `cta` key, so a fixture using the wrong name throws inside the resolver and
 * every assertion below would pass for the wrong reason. That exact mistake
 * shipped in the sibling plan and made three tests vacuous.
 */
function docLinkingTo(toSlug: string): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero",
        kind: "hero",
        variant: "centered",
        style: { headline: "lg", align: "center" },
        props: {
          headline: "Ten sessions, used whenever suits",
          sub: "No expiry, no subscription.",
          // `stepSlug`, NOT `slug` — `destinationForTarget` reads
          // `target.stepSlug` for a step link, and a fixture using the wrong
          // field name resolves to `{kind:"step", slug:""}`, which reports as
          // "leads nowhere" no matter how well the card works. Verified against
          // lib/funnels/connections.ts:148 rather than guessed.
          primaryCta: { label: "Get started", target: { kind: "step", stepSlug: toSlug } },
        },
      },
    ],
  } as unknown as SectionDoc
}

function step(overrides: Partial<FunnelStep> = {}): FunnelStep {
  return {
    id: "s1",
    funnel_id: "f1",
    name: "Offer",
    slug: "index",
    position: 0,
    is_entry: true,
    published_version_id: null,
    project_data: null,
    ...overrides,
  } as unknown as FunnelStep
}

/** The Ten-Session Pack from the owner's screenshot: three steps, none live. */
const THREE_STEPS: FunnelStep[] = [
  step({ id: "s1", name: "Offer", slug: "index", position: 0, is_entry: true, project_data: docLinkingTo("checkout") }),
  step({ id: "s2", name: "Checkout", slug: "checkout", position: 1, is_entry: false, project_data: docLinkingTo("thank-you") }),
  step({ id: "s3", name: "Confirmation", slug: "thank-you", position: 2, is_entry: false }),
]

function mount(
  entries: { funnel: Funnel; steps: FunnelStep[] }[] = [{ funnel: funnel(), steps: THREE_STEPS }],
  leadCounts: Record<string, number> = {},
) {
  return render(<FunnelList funnels={entries} leadCounts={leadCounts} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch
})

describe("<FunnelList>", () => {
  it("renders ONE card per funnel, not one per step", () => {
    mount([
      { funnel: funnel(), steps: THREE_STEPS },
      { funnel: funnel({ id: "f2", name: "Free Trial Week", slug: "free-trial-week" }), steps: [step({ id: "s4", name: "Signup" })] },
    ])

    // MUTANT: the old `funnels.flatMap(f => steps.map(...))` shape, which put a
    // card on screen for every STEP. Asserted by the cards' accessible names
    // rather than by a count: a count of 2 would also pass for a board that
    // dropped a funnel and duplicated another.
    const cards = screen.getAllByTestId("funnel-card")
    expect(cards.map((card) => within(card).getByTestId("funnel-name").textContent)).toEqual([
      "Ten-Session Pack",
      "Free Trial Week",
    ])
    // And the step names must NOT be card titles — that is the whole complaint.
    expect(screen.queryByTestId("funnel-card-Checkout")).toBeNull()
  })

  it("lists the funnel's steps INSIDE its card, in position order", () => {
    mount()
    const card = screen.getByTestId("funnel-card")
    const rows = within(card).getAllByTestId("funnel-step-row")
    // MUTANT: dropping the sort, or rendering only the entry step. Asserting
    // the names in order is what distinguishes "all three, ordered" from "three
    // rows".
    expect(rows.map((row) => within(row).getByTestId("step-name").textContent)).toEqual([
      "Offer",
      "Checkout",
      "Confirmation",
    ])
  })

  it("draws what leads where, so the card answers 'is it connected?'", () => {
    mount()
    const rows = screen.getAllByTestId("funnel-step-row")
    // MUTANT: rendering the step list without consulting `funnelConnections`.
    // The arrows are the entire "connected funnels is not compiled" complaint —
    // a list of names alone says nothing about whether they join up.
    expect(within(rows[0]).getByTestId("step-exits").textContent).toContain("Checkout")
    expect(within(rows[1]).getByTestId("step-exits").textContent).toContain("Confirmation")
    // The LAST page is supposed to end. Saying so is the difference between a
    // card that reports a problem and one that nags about a thank-you page.
    expect(within(rows[2]).getByTestId("step-exits").textContent).toContain("ends here")
  })

  it("warns on a middle page that leads nowhere", () => {
    mount([
      {
        funnel: funnel(),
        steps: [
          // Entry links nowhere, and it is NOT the last page.
          step({ id: "s1", name: "Offer", slug: "index", position: 0, is_entry: true }),
          step({ id: "s2", name: "Checkout", slug: "checkout", position: 1, is_entry: false }),
        ],
      },
    ])
    const rows = screen.getAllByTestId("funnel-step-row")
    // MUTANT: treating every exit-less page as "ends here". That would report a
    // broken funnel as a finished one — the failure this whole area exists to
    // surface.
    expect(within(rows[0]).getByTestId("step-exits").textContent).toContain("leads nowhere")
    expect(within(rows[1]).getByTestId("step-exits").textContent).toContain("ends here")
  })

  it("shows NO filter chips at all", () => {
    mount([
      { funnel: funnel(), steps: THREE_STEPS },
      { funnel: funnel({ id: "f2", name: "Free Trial Week", slug: "free-trial-week" }), steps: [step({ id: "s4" })] },
    ])
    // MUTANT: keeping the funnel-name chips. With one card per funnel the
    // grouping IS the card, so a chip labelled with a funnel's name is the
    // "category filter is wrong its filtering the name" complaint restated.
    expect(screen.queryByRole("button", { name: /^Ten-Session Pack \(\d+\)$/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^All \(\d+\)$/ })).toBeNull()
  })

  it("says a funnel is live only when the funnel is published AND its entry is", () => {
    mount([
      {
        funnel: funnel({ status: "published" }),
        steps: [step({ id: "s1", published_version_id: null })],
      },
    ])
    // MUTANT: badging on `funnel.status` alone. A published funnel whose entry
    // page has no compiled version serves nothing — calling that "live" is the
    // lie the rest of this area was built to stop telling.
    expect(screen.getByTestId("funnel-status").textContent).toBe("never published")
  })

  it("searches step names and surfaces the parent funnel", () => {
    mount([
      { funnel: funnel(), steps: THREE_STEPS },
      { funnel: funnel({ id: "f2", name: "Free Trial Week", slug: "free-trial-week" }), steps: [step({ id: "s4", name: "Signup" })] },
    ])
    // `fireEvent.change`, not a raw `dispatchEvent`. React tracks an input's
    // value on the node and ignores a mutation it did not see, so the raw
    // version left the query empty and the assertion below passed or failed for
    // reasons unrelated to searching.
    const input = screen.getByPlaceholderText(/search funnels/i)
    fireEvent.change(input, { target: { value: "checkout" } })

    // MUTANT: matching only funnel name and slug. Typing a page's name and
    // getting "nothing matches" is the search failing at the one thing the
    // flattened board did well.
    const names = screen.getAllByTestId("funnel-name").map((n) => n.textContent)
    expect(names).toEqual(["Ten-Session Pack"])
  })
})
