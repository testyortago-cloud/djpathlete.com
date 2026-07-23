import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ExerciseInstructionsHint } from "@/components/admin/ExerciseInstructionsHint"

describe("<ExerciseInstructionsHint>", () => {
  it("shows the exercise's library instructions with the client-visibility label", () => {
    render(<ExerciseInstructionsHint instructions={"Keep a 90 degree angle.\nElbow tucked in."} />)

    expect(screen.getByText(/the client already sees these/i)).toBeInTheDocument()
    expect(screen.getByText(/keep a 90 degree angle/i)).toBeInTheDocument()
  })

  it("renders nothing when instructions are null", () => {
    const { container } = render(<ExerciseInstructionsHint instructions={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing when instructions are whitespace-only", () => {
    const { container } = render(<ExerciseInstructionsHint instructions={"   \n  "} />)
    expect(container).toBeEmptyDOMElement()
  })
})
