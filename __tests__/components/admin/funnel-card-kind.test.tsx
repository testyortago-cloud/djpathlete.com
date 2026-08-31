// ONE CARD, TWO KINDS OF ROW.
//
// `/admin/pages` and `/admin/funnels` render the same `FunnelCard` now. What
// differs is not the screen but the ROW: `funnel.kind` decides how a row is
// administered, so a page listed anywhere still behaves like a page.
//
// Every difference is asserted in BOTH directions on purpose. "No settings
// button on a landing page" passes just as well when nothing rendered at all,
// so each absence has the matching presence beside it.
//
// The sharpest of these is the ⚙ button. `/admin/pages/<id>` redirects to the
// list by design (see landing-page-has-no-detail-screen.test.tsx), so a
// settings control on a page is a button whose only outcome is a bounce back
// to the screen the owner is already looking at — the exact dead end that
// redirect was added to remove, and the first bug this merge would have
// introduced.
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { FunnelCard } from "@/components/admin/funnels/FunnelCard"
import type { Funnel, FunnelStep } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// CAST AT THE END. A `Partial<Funnel>` spread widens every optional-in-the-
// partial field to include `undefined`, which `Funnel` does not accept.
const funnel = (over: Partial<Funnel> = {}): Funnel =>
  ({
    id: "f1",
    slug: "free-trial",
    name: "Free Trial",
    description: null,
    status: "draft",
    kind: "page",
    goal: "leads",
    created_by: null,
    created_at: "",
    updated_at: "",
    ...over,
  }) as Funnel

const step = (over: Partial<FunnelStep> = {}): FunnelStep =>
  ({
    id: "s1",
    funnel_id: "f1",
    slug: "index",
    name: "Landing page",
    position: 0,
    is_entry: true,
    published_version_id: null,
    project_data: null,
    created_at: "",
    updated_at: "",
    ...over,
  }) as FunnelStep

const card = (f: Funnel, steps: FunnelStep[] = [step()]) =>
  render(<FunnelCard funnel={f} steps={steps} leadCount={0} onDelete={() => {}} />)

describe("FunnelCard, per kind of row", () => {
  it("names a landing page's goal, because a landing page IS one page", () => {
    card(funnel({ kind: "page", goal: "leads" }))
    expect(screen.getByText("Capture leads")).toBeTruthy()
  })

  it("names NO goal on a funnel, whose steps carry the goals", () => {
    // A container has no single goal, so showing one would invent a fact.
    card(funnel({ kind: "funnel", goal: "leads" }))
    expect(screen.queryByText("Capture leads")).toBeNull()
  })

  it("offers the settings screen on a funnel, which has one", () => {
    card(funnel({ kind: "funnel" }))
    expect(screen.getByLabelText("Free Trial settings").getAttribute("href")).toBe("/admin/funnels/f1")
  })

  it("offers NO settings screen on a landing page, which has none", () => {
    card(funnel({ kind: "page" }))
    expect(screen.queryByLabelText("Free Trial settings")).toBeNull()
  })

  it("offers Convert to funnel on a landing page", () => {
    card(funnel({ kind: "page" }))
    expect(screen.getByRole("button", { name: /convert/i })).toBeTruthy()
  })

  it("offers no Convert control on something that is already a funnel", () => {
    card(funnel({ kind: "funnel" }))
    expect(screen.queryByRole("button", { name: /convert/i })).toBeNull()
  })

  it("calls a landing page a landing page in the rename dialog", () => {
    // ASSERTED INSIDE THE DIALOG, not on the trigger. `RenameDialog`'s
    // aria-label is `Rename ${name}` — it never contains the noun — so an
    // assertion on the button would be green for "funnel" and "landing page"
    // alike, which is the whole thing this test exists to tell apart.
    card(funnel({ kind: "page" }))
    fireEvent.click(screen.getByLabelText("Rename Free Trial"))
    expect(screen.getByText("Rename landing page")).toBeTruthy()
  })

  it("calls a funnel a funnel in the rename dialog", () => {
    card(funnel({ kind: "funnel" }))
    fireEvent.click(screen.getByLabelText("Rename Free Trial"))
    expect(screen.getByText("Rename funnel")).toBeTruthy()
  })
})

describe("FunnelCard's step list", () => {
  it("lists the steps of a multi-step funnel", () => {
    card(funnel({ kind: "funnel" }), [
      step({ id: "s1", name: "Signup", slug: "index", is_entry: true }),
      step({ id: "s2", name: "Thank you", slug: "thank-you", is_entry: false, position: 1 }),
    ])
    expect(screen.getByTestId("funnel-step-list")).toBeTruthy()
    expect(screen.getAllByTestId("funnel-step-row")).toHaveLength(2)
  })

  it("shows no step list for a landing page, whose single step IS the card", () => {
    // A bordered box holding one row that repeats the card's own title is the
    // "emptier copy" problem the landing-page detail screen was deleted over.
    card(funnel({ kind: "page" }), [step({ name: "Landing page" })])
    expect(screen.queryByTestId("funnel-step-list")).toBeNull()
  })

  it("shows no step list for a ONE-STEP FUNNEL either — the count decides, not the kind", () => {
    // A quiz funnel is kind="funnel" with exactly one step, and it has no
    // sequence to draw any more than a landing page does. Keying this on
    // `isPage` would put an empty box on every quiz funnel's card.
    card(funnel({ kind: "funnel" }), [step({ name: "Quiz" })])
    expect(screen.queryByTestId("funnel-step-list")).toBeNull()
  })
})
