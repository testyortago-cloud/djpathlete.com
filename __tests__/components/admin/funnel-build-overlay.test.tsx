// The build overlay, which the owner reported as mostly empty space.
//
// jsdom has no layout, so these assert the DECISIONS rather than measured
// pixels: the wrapper is not capped small, the stage is told to fill it, and
// the things that must survive a visual change — the polite live region, the
// aria-hidden wireframe, the motion-reduce escape — still do.

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import {
  GenerationStage,
  BUILD_STAGE_WRAPPER_CLASS,
} from "@/components/admin/funnels/builder/GenerationStage"

function stage(props: Partial<React.ComponentProps<typeof GenerationStage>> = {}) {
  render(
    <GenerationStage
      phase="writing"
      sections={[]}
      tokens={null}
      doc={null}
      attempt={1}
      findings={[]}
      {...props}
    />,
  )
}

describe("BUILD_STAGE_WRAPPER_CLASS", () => {
  it("is not capped at the old card width", () => {
    // MUTANT KILLED: leaving `max-w-md`. That 448px cap in a ~1260px pane is
    // the reported problem — the one moment the app is visibly working looked
    // mostly like empty space.
    expect(BUILD_STAGE_WRAPPER_CLASS).not.toContain("max-w-md")
  })

  it("fills its container in both directions", () => {
    expect(BUILD_STAGE_WRAPPER_CLASS).toContain("w-full")
    expect(BUILD_STAGE_WRAPPER_CLASS).toContain("h-full")
  })

  it("still has an upper bound", () => {
    // Uncapped, the skeleton stops reading as a page and starts reading as
    // stretched bars — a real page's content column does not grow forever.
    expect(BUILD_STAGE_WRAPPER_CLASS).toMatch(/max-w-/)
  })
})

describe("<GenerationStage>", () => {
  it("fills the wrapper it is given", () => {
    stage()
    const root = screen.getByTestId("generation-stage")
    expect(root.className).toContain("h-full")
    expect(root.className).toContain("w-full")
  })

  it("keeps the phase in a polite live region", () => {
    // A screen-reader user gets the phase and nothing else. Announcing each
    // decorative block would interrupt them eight times in twenty seconds.
    stage()
    const live = document.querySelector('[aria-live="polite"]')
    expect(live).not.toBeNull()
    expect(live!.textContent).toMatch(/writing sections/i)
  })

  it("keeps the wireframe out of the accessibility tree", () => {
    stage({ sections: [{ key: "s1", op: "add_section", kind: "hero", id: "a", headline: "Hi" }] })
    const wireframe = screen.getByText("hero").closest("[aria-hidden]")
    expect(wireframe).not.toBeNull()
  })

  it("keeps an escape hatch for reduced motion", () => {
    // MUTANT KILLED: a bigger, livelier overlay that forgets the users who
    // asked the OS for less of exactly this.
    stage()
    expect(document.querySelector(".motion-reduce\\:animate-none")).not.toBeNull()
  })

  it("still draws a hero differently from an unknown kind", () => {
    // The shapes are the reason this is a wireframe rather than a spinner.
    // Scaling them up must not collapse them into one generic block.
    const { container: heroBox } = render(
      <GenerationStage
        phase="writing"
        sections={[{ key: "s1", op: "add_section", kind: "hero", id: "a", headline: null }]}
        tokens={null}
        doc={null}
        attempt={1}
        findings={[]}
      />,
    )
    const { container: unknownBox } = render(
      <GenerationStage
        phase="writing"
        sections={[{ key: "s2", op: "add_section", kind: "made-up", id: "b", headline: null }]}
        tokens={null}
        doc={null}
        attempt={1}
        findings={[]}
      />,
    )
    expect(heroBox.innerHTML).not.toBe(unknownBox.innerHTML)
  })

  it("scrolls the section list rather than overflowing the pane", () => {
    // A ten-section plan must not push the token meter off the bottom.
    stage({ sections: [{ key: "s1", op: "add_section", kind: "hero", id: "a", headline: null }] })
    const list = screen.getByText("hero").closest("[aria-hidden]")!
    expect(list.className).toContain("overflow-y-auto")
  })
})
