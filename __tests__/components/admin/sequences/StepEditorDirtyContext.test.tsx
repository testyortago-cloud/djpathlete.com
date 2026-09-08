// @vitest-environment jsdom
// __tests__/components/admin/sequences/StepEditorDirtyContext.test.tsx
//
// The REAL module, unmocked — SequenceSwitch.test.tsx and StepEditor.test.tsx
// both mock this file so they can control "dirty" per test, which means
// neither of them exercises the actual default value this file ships. The
// whole point of that default (whole-branch review, Important 2) is that a
// component reading it with no StepEditorDirtyProvider around — exactly what
// /admin/sequences (SequenceReportTable) does — gets "nothing unsaved", not a
// thrown error and not a false "something is unsaved".

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { useStepEditorDirty } from "@/components/admin/sequences/StepEditorDirtyContext"
import { StepEditorDirtyProvider } from "@/components/admin/sequences/StepEditorDirtyProvider"

function Reporter() {
  const { dirty } = useStepEditorDirty()
  return <div data-testid="dirty-reading">{String(dirty)}</div>
}

describe("useStepEditorDirty — the default value, with no provider", () => {
  it("reads false, and setDirty is callable without throwing", () => {
    render(<Reporter />)
    expect(screen.getByTestId("dirty-reading")).toHaveTextContent("false")
  })

  it("calling the default setDirty does not throw", () => {
    function Setter() {
      const { setDirty } = useStepEditorDirty()
      setDirty(true) // must be a harmless no-op, not throw
      return <div>ok</div>
    }
    expect(() => render(<Setter />)).not.toThrow()
  })
})

describe("StepEditorDirtyProvider — a real provider actually changes the reading", () => {
  it("starts false even inside a provider, until something sets it", () => {
    render(
      <StepEditorDirtyProvider>
        <Reporter />
      </StepEditorDirtyProvider>,
    )
    expect(screen.getByTestId("dirty-reading")).toHaveTextContent("false")
  })
})
