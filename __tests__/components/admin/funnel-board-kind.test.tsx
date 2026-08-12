// The split is the whole feature, and it lives here. A board that renders the
// same chrome for both kinds would look done and be exactly the thing the owner
// complained about.

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

describe("<FunnelBoard kind='page'>", () => {
  it("offers the landing page dialog, not a bare input", () => {
    // MUTANT KILLED: leaving the inline "New landing page name" input in place,
    // which is the control this whole feature replaces.
    render(<FunnelBoard kind="page" pages={[]} funnels={[]} leadCounts={{}} />)
    expect(screen.getByRole("button", { name: /new landing page/i })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/new landing page name/i)).not.toBeInTheDocument()
  })

  it("teaches the flow when there is nothing yet", () => {
    // MUTANT KILLED: the old one-line "No landing pages yet." empty state,
    // which told a first-time owner nothing about what this screen makes.
    render(<FunnelBoard kind="page" pages={[]} funnels={[]} leadCounts={{}} />)
    expect(screen.getByText(/one focused page/i)).toBeInTheDocument()
  })

  it("shows the goal badge on a page card", () => {
    render(
      <FunnelBoard
        kind="page"
        pages={[{ step: step(), funnel: funnel() }]}
        funnels={[funnel()]}
        leadCounts={{}}
      />,
    )
    expect(screen.getByText("Capture leads")).toBeInTheDocument()
  })
})

describe("<FunnelBoard kind='funnel'>", () => {
  it("uses funnel vocabulary and hides the goal badge", () => {
    // MUTANT KILLED: reusing the page copy on the funnels screen — the two
    // screens would be indistinguishable, which is the original complaint.
    render(
      <FunnelBoard
        kind="funnel"
        pages={[{ step: step(), funnel: funnel({ kind: "funnel", goal: null }) }]}
        funnels={[funnel({ kind: "funnel", goal: null })]}
        leadCounts={{}}
      />,
    )
    expect(screen.getByRole("button", { name: /new funnel/i })).toBeInTheDocument()
    expect(screen.queryByText("Capture leads")).not.toBeInTheDocument()
  })

  it("says something funnel-shaped when empty", () => {
    render(<FunnelBoard kind="funnel" pages={[]} funnels={[]} leadCounts={{}} />)
    expect(screen.getByText(/more than one step/i)).toBeInTheDocument()
  })
})
