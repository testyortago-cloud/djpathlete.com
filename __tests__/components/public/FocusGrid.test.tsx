import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { FocusGrid } from "@/components/public/FocusGrid"

describe("FocusGrid", () => {
  const items = [
    { title: "Acceleration", body: "First-step intent." },
    { title: "Deceleration", body: "Braking with control." },
    { title: "Change of Direction", body: "Sharper repositioning." },
    { title: "Rotation", body: "Turning under pressure." },
  ]

  it("renders every item's title and body", () => {
    render(<FocusGrid items={items} />)
    for (const item of items) {
      expect(screen.getByText(item.title)).toBeInTheDocument()
      expect(screen.getByText(item.body)).toBeInTheDocument()
    }
  })

  it("numbers each card starting at 01", () => {
    render(<FocusGrid items={items} />)
    expect(screen.getByText("01")).toBeInTheDocument()
    expect(screen.getByText("02")).toBeInTheDocument()
    expect(screen.getByText("03")).toBeInTheDocument()
    expect(screen.getByText("04")).toBeInTheDocument()
  })

  it("renders nothing extra when given fewer items", () => {
    render(<FocusGrid items={items.slice(0, 2)} />)
    expect(screen.getByText("01")).toBeInTheDocument()
    expect(screen.getByText("02")).toBeInTheDocument()
    expect(screen.queryByText("03")).not.toBeInTheDocument()
  })
})
