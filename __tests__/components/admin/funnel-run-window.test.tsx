// A camp funnel's run window, on the card.
//
// The window is stored whether or not the job that acts on it is switched on,
// so the card must describe the DATES and never imply the automation. The two
// are separate facts and the funnel detail screen is where the second one is
// answered.

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PreviewCard } from "@/components/admin/funnels/PreviewCard"
import { formatRunWindow } from "@/lib/funnels/run-window"

function card(props: Partial<React.ComponentProps<typeof PreviewCard>> = {}) {
  render(
    <PreviewCard
      title="Summer Camp 2026"
      previewUrl={null}
      href="/admin/funnels/f1"
      badgeLabel="live"
      badgeTone="success"
      {...props}
    />,
  )
}

describe("formatRunWindow", () => {
  it("renders both ends when both are set", () => {
    expect(formatRunWindow("2026-06-01T00:00:00.000Z", "2026-08-15T00:00:00.000Z")).toBe(
      "Runs 1 Jun – 15 Aug 2026",
    )
  })

  it("keeps both years when the window crosses one", () => {
    // MUTANT KILLED: printing the year once from the end date. A window running
    // Nov 2026 to Feb 2027 would read "1 Nov – 3 Feb 2027", which is wrong
    // about the start by a year.
    expect(formatRunWindow("2026-11-01T00:00:00.000Z", "2027-02-03T00:00:00.000Z")).toBe(
      "Runs 1 Nov 2026 – 3 Feb 2027",
    )
  })

  it("handles one open end", () => {
    expect(formatRunWindow("2026-06-01T00:00:00.000Z", null)).toBe("Runs from 1 Jun 2026")
    expect(formatRunWindow(null, "2026-08-15T00:00:00.000Z")).toBe("Runs until 15 Aug 2026")
  })

  it("is null when there is no window at all", () => {
    // MUTANT KILLED: returning a string like "Runs — – —" for the null case,
    // which would put a meaningless line on every funnel that ever existed.
    expect(formatRunWindow(null, null)).toBeNull()
  })

  it("is null rather than 'Invalid Date' for unparseable input", () => {
    expect(formatRunWindow("not-a-date", null)).toBeNull()
  })
})

describe("<PreviewCard> run window", () => {
  it("shows the window when there is one", () => {
    card({ runWindow: "Runs 1 Jun – 15 Aug 2026" })
    expect(screen.getByText("Runs 1 Jun – 15 Aug 2026")).toBeInTheDocument()
  })

  it("renders no window line when there is none", () => {
    // Every funnel and landing page that predates this feature. A card that
    // shows an empty window row for all of them is worse than one that shows
    // nothing.
    card()
    expect(screen.queryByTestId("card-run-window")).not.toBeInTheDocument()
  })

  it("does not claim the funnel will go offline by itself", () => {
    // The checkbox records an intent; the job honouring it is flag-gated and
    // off by default. A card asserting the automation would be a promise the
    // deployment has not made.
    card({ runWindow: "Runs 1 Jun – 15 Aug 2026" })
    expect(screen.queryByText(/automatically/i)).not.toBeInTheDocument()
  })
})
