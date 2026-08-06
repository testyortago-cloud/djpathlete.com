import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { ReportPreview } from "@/components/admin/performance/ReportPreview"

const URL = "https://www.darrenjpaul.com/athlete/tok123"

describe("ReportPreview", () => {
  it("embeds the REAL report page rather than a re-implementation", () => {
    const { container } = render(<ReportPreview reportUrl={URL} clientName="Marcus Johnson" />)
    const frame = container.querySelector("iframe") as HTMLIFrameElement
    expect(frame).toBeTruthy()
    expect(frame.getAttribute("src")).toBe(URL)
    expect(frame.getAttribute("loading")).toBe("lazy")
  })

  it("is non-interactive so a stray click cannot scroll or print inside the frame", () => {
    const { container } = render(<ReportPreview reportUrl={URL} clientName="Marcus Johnson" />)
    const frame = container.querySelector("iframe") as HTMLIFrameElement
    expect(frame.className).toContain("pointer-events-none")
  })

  it("opens the report in a new tab with a safe rel", () => {
    render(<ReportPreview reportUrl={URL} clientName="Marcus Johnson" />)
    const link = screen.getByRole("link", { name: /open/i })
    expect(link).toHaveAttribute("href", URL)
    expect(link).toHaveAttribute("target", "_blank")
    expect(link.getAttribute("rel")).toContain("noopener")
  })

  it("copies the absolute report link", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ReportPreview reportUrl={URL} clientName="Marcus Johnson" />)
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }))
    expect(writeText).toHaveBeenCalledWith(URL)
  })

  it("remounts the iframe on Refresh so freshly logged tests show up", () => {
    const { container } = render(<ReportPreview reportUrl={URL} clientName="Marcus Johnson" />)
    const before = container.querySelector("iframe")
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }))
    const after = container.querySelector("iframe")
    expect(after).toBeTruthy()
    // A changed key forces a new element rather than reusing the cached frame.
    expect(after).not.toBe(before)
  })

  it("addresses the client by first name", () => {
    render(<ReportPreview reportUrl={URL} clientName="Marcus Johnson" />)
    expect(screen.getByText(/what Marcus and their parents see/i)).toBeInTheDocument()
    expect(screen.queryByText(/Marcus Johnson and their parents/i)).not.toBeInTheDocument()
  })
})
