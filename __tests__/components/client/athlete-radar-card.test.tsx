// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"

// Recharts draws nothing at jsdom's zero size; the chart's data is what is under test.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  RadarChart: ({ data }: { data: { category: string; score: number }[] }) => (
    <ul>
      {data.map((d) => (
        <li key={d.category}>{`${d.category}:${d.score}`}</li>
      ))}
    </ul>
  ),
  Radar: () => null,
  PolarGrid: () => null,
  PolarAngleAxis: () => null,
  PolarRadiusAxis: () => null,
  Tooltip: () => null,
}))

import { AthleteRadarCard } from "@/components/client/profile/athlete-radar-card"
import type { PerformanceTest } from "@/types/database"

const cmj40 = { test_type: "cmj", result_value: 40, body_weight_kg: null, test_date: "2026-10-01" } as PerformanceTest

const standards = [
  { test_type: "cmj", age_min: null, age_max: null, floor_value: 20, trained_value: 50, elite_value: 70 },
  { test_type: "cmj", age_min: 13, age_max: 15, floor_value: 20, trained_value: 40, elite_value: 60 },
]

describe("AthleteRadarCard", () => {
  it("scores against the coach's age group: a result at its Trained value scores 65", () => {
    render(<AthleteRadarCard tests={[cmj40]} standards={standards} age={14} />)
    expect(screen.getByText("Power:65")).toBeInTheDocument()
  })

  it("uses the coach's all-ages row when the age is unknown", () => {
    render(<AthleteRadarCard tests={[cmj40]} standards={standards} age={null} />)
    // 65 × (40 − 20) / (50 − 20) = 43.3
    expect(screen.getByText("Power:43")).toBeInTheDocument()
  })

  it("falls back to the built-in standard with no rows", () => {
    render(<AthleteRadarCard tests={[cmj40]} />)
    // built-in cmj: floor 25, Trained 45 → 65 × 15 / 20 = 48.75
    expect(screen.getByText("Power:49")).toBeInTheDocument()
  })
})
