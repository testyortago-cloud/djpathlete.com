// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { NumberedFlow } from "@/components/public/NumberedFlow"

describe("NumberedFlow", () => {
  const steps = [
    "Prep the body properly",
    "Coach the key actions clearly",
    "Build it into reactive tasks",
    "Finish with pressure and competition",
  ]

  it("renders each step text", () => {
    render(<NumberedFlow steps={steps} />)
    for (const step of steps) {
      expect(screen.getByText(step)).toBeInTheDocument()
    }
  })

  it("numbers steps starting at 1", () => {
    render(<NumberedFlow steps={steps} />)
    expect(screen.getByText("01")).toBeInTheDocument()
    expect(screen.getByText("02")).toBeInTheDocument()
    expect(screen.getByText("03")).toBeInTheDocument()
    expect(screen.getByText("04")).toBeInTheDocument()
  })
})
