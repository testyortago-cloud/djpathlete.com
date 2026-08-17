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
    // `card-title` is the LINK PreviewCard renders, not a mirror of the prop.
    // An earlier draft asserted an `sr-only` span carrying the same string,
    // which would have passed even if the card stopped rendering a title at
    // all — and, being `sr-only`, announced every funnel's name twice to a
    // screen reader.
    const cards = screen.getAllByTestId("funnel-card")
    expect(cards.map((card) => within(card).getByTestId("card-title").textContent)).toEqual([
      "Ten-Session Pack",
      "Free Trial Week",
    ])
    // And a step name must NOT be a card title — that is the whole complaint.
    const titles = screen.getAllByTestId("card-title").map((n) => n.textContent)
    expect(titles).not.toContain("Checkout")
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
    //
    // Read off the RENDERED badge, not a mirror of the computed value: this is
    // the highest-value assertion in the file, and against a mirror it would
    // still pass if the badge vanished from the card entirely.
    expect(screen.getByTestId("card-badge").textContent).toBe("never published")
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
    const names = screen.getAllByTestId("card-title").map((n) => n.textContent)
    expect(names).toEqual(["Ten-Session Pack"])
  })

  it("explains what a funnel IS when there are none yet", () => {
    mount([])
    // MUTANT: the one-line "No funnels yet." this replaced. That regression was
    // silent — the board being retired carried a whole getting-started panel
    // for `kind="funnel"`, and this is the first screen a new owner meets,
    // before they have any idea what the feature does.
    expect(screen.getByText(/No funnels yet/i)).toBeInTheDocument()
    expect(screen.getByText(/more than one step in order/i)).toBeInTheDocument()
    // And it must describe the ONE-publish model, not the two-screen flow the
    // owner asked to have removed.
    expect(screen.getByText(/takes the whole funnel live/i)).toBeInTheDocument()
  })

  it("keeps a plain line for a search that matches nothing", () => {
    mount()
    fireEvent.change(screen.getByPlaceholderText(/search funnels/i), { target: { value: "zzzz" } })
    // MUTANT: showing the getting-started panel here. "No funnels yet" over an
    // account that HAS funnels is simply false.
    expect(screen.getByText(/Nothing matches that search/i)).toBeInTheDocument()
    expect(screen.queryByText(/No funnels yet/i)).toBeNull()
  })

  it("renders no step list at all for a funnel with no steps", () => {
    mount([{ funnel: funnel(), steps: [] }])
    // MUTANT: rendering the container unconditionally, which leaves an empty
    // bordered grey box on the card. `listSteps` degrades to `[]` on a failed
    // read, so this is reachable without any funnel being malformed.
    //
    // ASSERTS THE CONTAINER, NOT THE ROWS — and the first version of this test
    // asserted the rows, which is why it SURVIVED its own mutant: with no
    // steps there are no rows either way, so `queryAllByTestId("funnel-step-row")`
    // is empty whether the box renders or not. The box is the thing the owner
    // would see, so the box is the thing to assert.
    expect(screen.queryByTestId("funnel-step-list")).toBeNull()
    expect(screen.queryAllByTestId("funnel-step-row")).toHaveLength(0)
    expect(screen.getByTestId("card-title").textContent).toBe("Ten-Session Pack")
  })

  it("shows ONE arrow per destination, not one per button", () => {
    const twoButtonsToCheckout = {
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
            headline: "Ten sessions",
            sub: "No expiry.",
            primaryCta: { label: "Get started", target: { kind: "step", stepSlug: "checkout" } },
            secondaryCta: { label: "Buy now", target: { kind: "step", stepSlug: "checkout" } },
          },
        },
      ],
    } as unknown as SectionDoc

    mount([
      {
        funnel: funnel(),
        steps: [
          step({ id: "s1", name: "Offer", slug: "index", position: 0, is_entry: true, project_data: twoButtonsToCheckout }),
          step({ id: "s2", name: "Checkout", slug: "checkout", position: 1, is_entry: false }),
        ],
      },
    ])
    const rows = screen.getAllByTestId("funnel-step-row")
    // MUTANT: dropping the dedupe. A real page carries several buttons to the
    // same next step — the probe in connections.ts found six on one page — and
    // six identical arrows in a card this size is noise, not information.
    const arrows = within(rows[0]).getByTestId("step-exits").textContent ?? ""
    expect(arrows.match(/Checkout/g) ?? []).toHaveLength(1)
  })
})
