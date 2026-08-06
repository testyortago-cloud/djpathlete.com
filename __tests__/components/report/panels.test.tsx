import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { KpiTile } from "@/components/public/report/panels/KpiTile"
import { BandPill } from "@/components/public/report/panels/BandPill"
import { ScoreBar } from "@/components/public/report/panels/ScoreBar"
import { RangeBar } from "@/components/public/report/panels/RangeBar"
import { CueBlock } from "@/components/public/report/panels/CueBlock"
import { CategoryChips } from "@/components/public/report/panels/CategoryChips"

describe("KpiTile", () => {
  it("renders value, unit and label", () => {
    render(<KpiTile value="45.7" unit="cm" label="CMJ Height" />)
    expect(screen.getByText("45.7")).toBeInTheDocument()
    expect(screen.getByText("cm")).toBeInTheDocument()
    expect(screen.getByText(/CMJ Height/i)).toBeInTheDocument()
  })

  it("renders the PR badge only when flagged", () => {
    const { rerender } = render(<KpiTile value="45.7" unit="cm" label="CMJ" isPr />)
    expect(screen.getByText("PR")).toBeInTheDocument()
    rerender(<KpiTile value="45.7" unit="cm" label="CMJ" />)
    expect(screen.queryByText("PR")).not.toBeInTheDocument()
  })
})

describe("BandPill", () => {
  it("labels each band", () => {
    const { rerender } = render(<BandPill band="strength" />)
    expect(screen.getByText(/Strength/i)).toBeInTheDocument()
    rerender(<BandPill band="priority" />)
    expect(screen.getByText(/Priority/i)).toBeInTheDocument()
  })
})

describe("ScoreBar", () => {
  it("renders the score and sizes the fill to it", () => {
    const { container } = render(<ScoreBar label="Speed" score={48} />)
    expect(screen.getByText("Speed")).toBeInTheDocument()
    expect(screen.getByText("48")).toBeInTheDocument()
    const fill = container.querySelector("[data-testid='score-fill']") as HTMLElement
    expect(fill.style.width).toBe("48%")
  })

  it("clamps an out-of-range score rather than overflowing the track", () => {
    const { container } = render(<ScoreBar label="Speed" score={140} />)
    const fill = container.querySelector("[data-testid='score-fill']") as HTMLElement
    expect(fill.style.width).toBe("100%")
  })
})

describe("RangeBar", () => {
  it("plots a single marker at the score", () => {
    render(<RangeBar score={70} />)
    const markers = screen.getAllByTestId("range-marker")
    expect(markers).toHaveLength(1)
    expect(markers[0].style.left).toBe("70%")
  })

  it("plots TWO markers and an asymmetry pill when bilateral values are supplied", () => {
    render(<RangeBar score={70} left={80} right={60} />)
    const markers = screen.getAllByTestId("range-marker")
    expect(markers).toHaveLength(2)
    expect(markers[0].style.left).toBe("80%")
    expect(markers[1].style.left).toBe("60%")
    expect(screen.getByText(/25% \(left\)/i)).toBeInTheDocument()
  })

  it("never calls itself a percentile", () => {
    const { container } = render(<RangeBar score={70} />)
    expect(container.textContent?.toLowerCase()).not.toContain("percentile")
    expect(container.textContent?.toLowerCase()).toContain("reference range")
  })
})

describe("CueBlock", () => {
  it("renders the cue text with its provenance caption", () => {
    render(<CueBlock cue="Cut the volume and raise the intensity." />)
    expect(screen.getByText(/Cut the volume/)).toBeInTheDocument()
    expect(screen.getByText(/Generated from this athlete/i)).toBeInTheDocument()
  })
})

describe("CategoryChips", () => {
  it("marks scorable categories active and the rest inactive", () => {
    render(<CategoryChips active={["Speed", "Power"]} />)
    expect(screen.getByText("Speed")).toHaveAttribute("data-active", "true")
    expect(screen.getByText("Power")).toHaveAttribute("data-active", "true")
    expect(screen.getByText("Mobility")).toHaveAttribute("data-active", "false")
    expect(screen.getByText("Endurance")).toHaveAttribute("data-active", "false")
  })
})
