// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import {
  InstructionCheckPanel,
  extractInstructionCheck,
  type InstructionCheck,
} from "@/components/admin/GenerationWarnings"

const FAILED: InstructionCheck = {
  status: "failed",
  items: [
    { instruction: "3 sets of 10", met: true, detail: "every exercise has 3 x 10", source: "code" },
    { instruction: "Mainly shoulder", met: false, detail: "only 3 of 12 are shoulder", source: "ai" },
  ],
  rebuilt: true,
  rebuild_reason: "the day had 8 exercises, not 12",
  note: "Checked after the rebuild.",
}

describe("extractInstructionCheck", () => {
  it("reads a well-formed value", () => {
    expect(extractInstructionCheck({ instruction_check: FAILED })).toEqual(FAILED)
  })

  it("returns null for null, a missing key or garbage", () => {
    expect(extractInstructionCheck(null)).toBeNull()
    expect(extractInstructionCheck({ warnings: [] })).toBeNull()
    expect(extractInstructionCheck({ instruction_check: "text" })).toBeNull()
    expect(extractInstructionCheck({ instruction_check: { status: "passed", items: "no" } })).toBeNull()
    expect(extractInstructionCheck({ instruction_check: { status: "weird", items: [] } })).toBeNull()
  })

  it("drops a malformed item but keeps the good ones", () => {
    const got = extractInstructionCheck({
      instruction_check: {
        ...FAILED,
        items: [FAILED.items[0], { instruction: 5, met: true, detail: "x" }, null, FAILED.items[1]],
      },
    })
    expect(got?.items).toEqual(FAILED.items)
  })
})

describe("InstructionCheckPanel", () => {
  it("shows ticks, crosses, details, the not-met count, the rebuild line and the note", () => {
    render(<InstructionCheckPanel check={FAILED} defaultOpen />)
    expect(screen.getByText("Your instructions, checked")).toBeTruthy()
    expect(screen.getByText(/1 not met/)).toBeTruthy()
    expect(screen.getByText("✓")).toBeTruthy()
    expect(screen.getByText("✗")).toBeTruthy()
    expect(screen.getByText("3 sets of 10")).toBeTruthy()
    expect(screen.getByText(/only 3 of 12 are shoulder/)).toBeTruthy()
    expect(screen.getByText(/Rebuilt once to fix: the day had 8 exercises, not 12/)).toBeTruthy()
    expect(screen.getByText("Checked after the rebuild.")).toBeTruthy()
  })

  it("has no not-met count when everything passed", () => {
    render(
      <InstructionCheckPanel
        check={{ status: "passed", items: [FAILED.items[0]], rebuilt: false, rebuild_reason: null, note: null }}
        defaultOpen
      />,
    )
    expect(screen.queryByText(/not met/)).toBeNull()
    expect(screen.queryByText(/Rebuilt once/)).toBeNull()
  })

  it("shows only the note when unchecked", () => {
    render(
      <InstructionCheckPanel
        check={{ status: "unchecked", items: [], rebuilt: false, rebuild_reason: null, note: "Ran out of time." }}
        defaultOpen
      />,
    )
    expect(screen.getByText("Ran out of time.")).toBeTruthy()
    expect(screen.queryByText("✓")).toBeNull()
  })

  it("renders nothing when unchecked with no items and no note, or no check", () => {
    const a = render(
      <InstructionCheckPanel
        check={{ status: "unchecked", items: [], rebuilt: false, rebuild_reason: null, note: null }}
      />,
    )
    expect(a.container.innerHTML).toBe("")
    const b = render(<InstructionCheckPanel check={null} />)
    expect(b.container.innerHTML).toBe("")
  })
})
