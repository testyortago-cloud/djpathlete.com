import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ScheduleToolbar } from "@/components/admin/schedule/ScheduleToolbar"

describe("ScheduleToolbar", () => {
  it("renders Month/Week/List toggle links preserving the anchor", () => {
    render(<ScheduleToolbar view="week" anchor="2026-07-08" today="2026-07-06" />)
    expect(screen.getByRole("link", { name: "Month" })).toHaveAttribute(
      "href",
      "/admin/schedule?view=month&anchor=2026-07-08",
    )
    expect(screen.getByRole("link", { name: "Week" })).toHaveAttribute(
      "href",
      "/admin/schedule?view=week&anchor=2026-07-08",
    )
    expect(screen.getByRole("link", { name: "List" })).toHaveAttribute(
      "href",
      "/admin/schedule?view=list&anchor=2026-07-08",
    )
  })

  it("marks the active view", () => {
    render(<ScheduleToolbar view="week" anchor="2026-07-08" today="2026-07-06" />)
    expect(screen.getByRole("link", { name: "Week" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Month" })).not.toHaveAttribute("aria-current")
  })

  it("navigates weeks by ±7 days and Today back to the current date", () => {
    render(<ScheduleToolbar view="week" anchor="2026-07-08" today="2026-07-06" />)
    expect(screen.getByRole("link", { name: /previous/i })).toHaveAttribute(
      "href",
      "/admin/schedule?view=week&anchor=2026-07-01",
    )
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
      "href",
      "/admin/schedule?view=week&anchor=2026-07-15",
    )
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute(
      "href",
      "/admin/schedule?view=week&anchor=2026-07-06",
    )
  })

  it("navigates months by ±1 month and labels the month", () => {
    render(<ScheduleToolbar view="month" anchor="2026-07-15" today="2026-07-06" />)
    expect(screen.getByRole("link", { name: /previous/i })).toHaveAttribute(
      "href",
      "/admin/schedule?view=month&anchor=2026-06-15",
    )
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
      "href",
      "/admin/schedule?view=month&anchor=2026-08-15",
    )
    expect(screen.getByText(/July 2026/)).toBeInTheDocument()
  })

  it("labels the week range", () => {
    render(<ScheduleToolbar view="week" anchor="2026-07-08" today="2026-07-06" />)
    expect(screen.getByText(/Jul 5/)).toBeInTheDocument()
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })
})
