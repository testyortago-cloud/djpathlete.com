// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ExpandableText } from "@/components/shared/ExpandableText"

// How the program header uses it: an AI program's description is its full coach notes.
const props = { threshold: 400, clampClassName: "line-clamp-3", more: "See more", less: "See less" }

describe("ExpandableText", () => {
  it("clamps a long description behind See more and expands it in place", () => {
    const text = "x".repeat(2970)
    render(<ExpandableText text={text} {...props} />)
    expect(screen.getByText(text)).toHaveClass("line-clamp-3")
    fireEvent.click(screen.getByRole("button", { name: "See more" }))
    expect(screen.getByText(text)).not.toHaveClass("line-clamp-3")
    expect(screen.getByRole("button", { name: "See less" })).toHaveAttribute("aria-expanded", "true")
  })

  it("shows a short description whole, with no toggle", () => {
    render(<ExpandableText text={"x".repeat(400)} {...props} />)
    expect(screen.getByText("x".repeat(400))).not.toHaveClass("line-clamp-3")
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
