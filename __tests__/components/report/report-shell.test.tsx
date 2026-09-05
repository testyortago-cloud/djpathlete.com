// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, beforeEach } from "vitest"
import { ReportShell } from "@/components/public/report/ReportShell"

beforeEach(() => {
  window.localStorage.clear()
})

function scopeOf(container: HTMLElement): string {
  return (container.querySelector("main") as HTMLElement).className
}

describe("ReportShell", () => {
  it("defaults to the light scope — this is a print-first document", () => {
    const { container } = render(
      <ReportShell>
        <p>body</p>
      </ReportShell>,
    )
    expect(scopeOf(container)).toContain("report-light")
    expect(scopeOf(container)).not.toContain("athlete-arena")
  })

  it("honours an explicit dark initial theme", () => {
    const { container } = render(
      <ReportShell initialTheme="dark">
        <p>body</p>
      </ReportShell>,
    )
    expect(scopeOf(container)).toContain("athlete-arena")
  })

  it("swaps the palette scope when toggled, and persists the choice", () => {
    const { container } = render(
      <ReportShell>
        <p>body</p>
      </ReportShell>,
    )
    fireEvent.click(screen.getByRole("button", { name: /switch to dark mode/i }))
    expect(scopeOf(container)).toContain("athlete-arena")
    expect(scopeOf(container)).not.toContain("report-light")
    expect(window.localStorage.getItem("djp-report-theme")).toBe("dark")

    fireEvent.click(screen.getByRole("button", { name: /switch to light mode/i }))
    expect(scopeOf(container)).toContain("report-light")
    expect(window.localStorage.getItem("djp-report-theme")).toBe("light")
  })

  it("restores a previously saved theme over the server default", () => {
    window.localStorage.setItem("djp-report-theme", "dark")
    const { container } = render(
      <ReportShell initialTheme="light">
        <p>body</p>
      </ReportShell>,
    )
    expect(scopeOf(container)).toContain("athlete-arena")
  })

  it("keeps the toolbar out of the printed document", () => {
    const { container } = render(
      <ReportShell>
        <p>body</p>
      </ReportShell>,
    )
    const toolbar = screen.getByRole("button", { name: /save as pdf/i }).parentElement as HTMLElement
    expect(toolbar.className).toContain("print:hidden")
    expect(container.textContent).toContain("body")
  })
})
