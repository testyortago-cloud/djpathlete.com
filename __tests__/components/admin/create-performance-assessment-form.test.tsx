// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { CreatePerformanceAssessmentForm } from "@/components/admin/CreatePerformanceAssessmentForm"

/**
 * The coach (2026-10-30 meeting): assessment exercises are mostly his own names, not the
 * library; the old library picker could not be typed in and showed 20 exercises; and once
 * a library exercise was picked, the custom-name box was disabled for good.
 */
const exercises = Array.from({ length: 30 }, (_, i) => ({ id: `ex-${i}`, name: `Library Move ${i}` }))
const renderForm = () => render(<CreatePerformanceAssessmentForm clients={[]} exercises={exercises} />)
const nameBox = () => screen.getByLabelText("Exercise name") as HTMLInputElement

describe("CreatePerformanceAssessmentForm exercise name", () => {
  it("takes any name as a custom exercise", () => {
    renderForm()
    fireEvent.change(nameBox(), { target: { value: "Pogo hops 20s" } })
    expect(nameBox().value).toBe("Pogo hops 20s")
    expect(screen.getByText("Custom")).toBeInTheDocument()
  })
  it("links a library exercise when the name matches one", () => {
    renderForm()
    fireEvent.change(nameBox(), { target: { value: "library move 7" } })
    expect(screen.getByText("From Library")).toBeInTheDocument()
    expect(nameBox().value).toBe("Library Move 7")
  })
  it("can still be changed to a custom name after a library pick", () => {
    renderForm()
    fireEvent.change(nameBox(), { target: { value: "Library Move 7" } })
    expect(nameBox()).not.toBeDisabled()
    fireEvent.change(nameBox(), { target: { value: "Library Move 7 (banded)" } })
    expect(screen.getByText("Custom")).toBeInTheDocument()
    expect(screen.queryByText("From Library")).not.toBeInTheDocument()
  })
  it("suggests the whole library, not the first 20", () => {
    const { container } = renderForm()
    expect(nameBox()).toHaveAttribute("list", "assessment-exercise-library")
    expect(container.querySelectorAll("#assessment-exercise-library option")).toHaveLength(30)
  })
})
