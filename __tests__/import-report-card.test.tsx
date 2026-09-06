// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ImportReportCard } from "@/components/admin/ImportReportCard"

const params = {
  source: "excel_import",
  file_name: "block.xlsx",
  client_id: null,
  matched: [{ raw_name: "Squat", exercise_id: "e1", exercise_name: "Back Squat", method: "semantic", confidence: 0.8 }],
  created: [{ raw_name: "Sled Push", exercise_id: "e2" }],
  unresolved: [],
  gaps_filled: ["assumed 4 weeks"],
  assumptions: [],
  interpretation_notes: null,
  counts: { days: 3, exercises: 12, weeks: 4 },
}

describe("ImportReportCard", () => {
  it("renders import counts and the created-exercises callout", () => {
    render(<ImportReportCard params={params} />)
    expect(screen.getByText(/imported from excel/i)).toBeInTheDocument()
    expect(screen.getByText(/Sled Push/)).toBeInTheDocument()
    expect(screen.getByText(/12/)).toBeInTheDocument()
  })

  it("renders nothing for non-import params", () => {
    const { container } = render(<ImportReportCard params={{ validation: {} }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders a warning callout listing unresolved exercise names", () => {
    render(<ImportReportCard params={{ ...params, unresolved: ["Bulgarian Death March"] }} />)
    expect(screen.getByText(/couldn.t be added/i)).toBeInTheDocument()
    expect(screen.getByText(/Bulgarian Death March/)).toBeInTheDocument()
  })
})
