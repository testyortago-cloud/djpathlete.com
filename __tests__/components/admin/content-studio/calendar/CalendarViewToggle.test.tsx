import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CalendarViewToggle } from "@/components/admin/content-studio/calendar/CalendarViewToggle"

const replaceMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/content",
  useSearchParams: () => new URLSearchParams("tab=calendar&view=month&anchor=2026-04-20"),
}))

describe("<CalendarViewToggle>", () => {
  it("renders Month/Week/Day buttons with Month active", () => {
    render(<CalendarViewToggle />)
    expect(screen.getByRole("button", { name: /^month$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByRole("button", { name: /^week$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    expect(screen.getByRole("button", { name: /^day$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
  })

  it("clicking Week updates the URL", () => {
    replaceMock.mockClear()
    render(<CalendarViewToggle />)
    fireEvent.click(screen.getByRole("button", { name: /^week$/i }))
    expect(replaceMock).toHaveBeenCalledWith(expect.stringMatching(/view=week/), {
      scroll: false,
    })
  })

  it("pressing 'w' switches to week view", () => {
    replaceMock.mockClear()
    render(<CalendarViewToggle />)
    fireEvent.keyDown(document, { key: "w" })
    expect(replaceMock).toHaveBeenCalledWith(expect.stringMatching(/view=week/), {
      scroll: false,
    })
  })

  it("pressing 'm' switches to month view", () => {
    replaceMock.mockClear()
    render(<CalendarViewToggle />)
    fireEvent.keyDown(document, { key: "m" })
    expect(replaceMock).toHaveBeenCalledWith(expect.stringMatching(/view=month/), {
      scroll: false,
    })
  })

  it("pressing 'd' switches to day view", () => {
    replaceMock.mockClear()
    render(<CalendarViewToggle />)
    fireEvent.keyDown(document, { key: "d" })
    expect(replaceMock).toHaveBeenCalledWith(expect.stringMatching(/view=day/), {
      scroll: false,
    })
  })

  it("pressing 't' jumps to today", () => {
    replaceMock.mockClear()
    render(<CalendarViewToggle />)
    fireEvent.keyDown(document, { key: "t" })
    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringMatching(/anchor=\d{4}-\d{2}-\d{2}/),
      { scroll: false },
    )
  })

  it("Prev arrow moves anchor backwards", () => {
    replaceMock.mockClear()
    render(<CalendarViewToggle />)
    fireEvent.click(screen.getByRole("button", { name: /previous period/i }))
    expect(replaceMock).toHaveBeenCalled()
    const call = replaceMock.mock.calls[0][0] as string
    expect(call).toMatch(/anchor=2026-03-/)
  })

  it("does not trigger shortcuts while typing in an input", () => {
    replaceMock.mockClear()
    render(<CalendarViewToggle />)
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: "w" })
    expect(replaceMock).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })
})
