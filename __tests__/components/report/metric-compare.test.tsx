import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { MetricCompare } from "@/components/public/report/panels/MetricCompare"
import type { ScoredTest } from "@/lib/test-report/scoring"

const cmj: ScoredTest = {
  key: "cmj",
  testType: "cmj",
  label: "Countermovement Jump",
  // Every number here is distinct on purpose: 50 (now), 40 (prev), 65 (elite),
  // 45 (trained). A fixture that reuses a value makes getByText ambiguous and
  // the assertion stops proving which element it found.
  latest: 50,
  unit: "cm",
  latestDate: "2026-07-01",
  isPr: true,
  score: 62,
  deltaPct: 25,
  previous: 40,
  targets: { elite: 65, trained: 45, relativeToBodyWeight: false, direction: "higher" },
  points: [40, 50],
}

describe("MetricCompare", () => {
  it("shows the now value, the previous value and both coaching standards", () => {
    render(<MetricCompare test={cmj} />)
    expect(screen.getByText("50")).toBeInTheDocument()
    expect(screen.getByText(/Prev 40/)).toBeInTheDocument()
    expect(screen.getByText("65")).toBeInTheDocument()
    expect(screen.getByText("Elite")).toBeInTheDocument()
    expect(screen.getByText("Trained")).toBeInTheDocument()
    expect(screen.getByText(/Countermovement Jump/)).toBeInTheDocument()
    expect(screen.getByText("PR")).toBeInTheDocument()
  })

  it("never labels the standards as a percentile or a population average", () => {
    const { container } = render(<MetricCompare test={cmj} />)
    const text = container.textContent?.toLowerCase() ?? ""
    expect(text).not.toContain("percentile")
    expect(text).not.toContain("average")
    expect(text).not.toContain("professional")
  })

  it("shows an improvement as ↑ and a decline as ↓", () => {
    const { rerender } = render(<MetricCompare test={cmj} />)
    expect(screen.getByTestId("metric-delta").textContent).toContain("↑")
    rerender(<MetricCompare test={{ ...cmj, deltaPct: -8 }} />)
    const delta = screen.getByTestId("metric-delta")
    expect(delta.textContent).toContain("↓")
    // Always rendered as a positive magnitude — the arrow carries the direction.
    expect(delta.textContent).toContain("8%")
    expect(delta.textContent).not.toContain("-8")
  })

  it("omits the standards entirely when the test has none", () => {
    render(<MetricCompare test={{ ...cmj, targets: null, label: "Sled Push 20m" }} />)
    expect(screen.queryByText("Elite")).not.toBeInTheDocument()
    expect(screen.queryByText("Trained")).not.toBeInTheDocument()
    expect(screen.getByText(/Sled Push 20m/)).toBeInTheDocument()
  })

  it("omits the previous value and the delta on a first-ever test", () => {
    render(<MetricCompare test={{ ...cmj, previous: null, deltaPct: null, isPr: false }} />)
    expect(screen.queryByText(/Prev/)).not.toBeInTheDocument()
    expect(screen.queryByTestId("metric-delta")).not.toBeInTheDocument()
    expect(screen.getByText("50")).toBeInTheDocument()
  })
})
