import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { ScoreTrack } from "@/components/public/report/panels/ScoreTrack"

describe("ScoreTrack", () => {
  it("positions the marker at the score and explains the scale to screen readers", () => {
    const { container } = render(<ScoreTrack score={58} />)
    const dot = container.querySelector(".score-track-dot") as HTMLElement
    expect(dot.style.left).toBe("58%")
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/58.*Trained is 50.*Elite is 100/)
  })

  it("clamps out-of-range scores instead of overflowing the track", () => {
    const { container: over } = render(<ScoreTrack score={140} />)
    expect((over.querySelector(".score-track-dot") as HTMLElement).style.left).toBe("100%")
    const { container: under } = render(<ScoreTrack score={-20} />)
    expect((under.querySelector(".score-track-dot") as HTMLElement).style.left).toBe("0%")
  })

  it("carries the accent tone as a data attribute, not a hardcoded colour", () => {
    const { container } = render(<ScoreTrack score={50} tone="accent" />)
    expect(container.querySelector(".score-track")?.getAttribute("data-tone")).toBe("accent")
  })

  it("degrades to zero rather than rendering NaN%", () => {
    const { container } = render(<ScoreTrack score={Number.NaN} />)
    expect((container.querySelector(".score-track-dot") as HTMLElement).style.left).toBe("0%")
    expect(screen.getByRole("img").getAttribute("aria-label")).not.toMatch(/NaN/)
  })
})
