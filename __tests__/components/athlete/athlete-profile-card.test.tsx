import { render, screen } from "@testing-library/react"
import { describe, it, expect, beforeAll, vi } from "vitest"
import { AthleteProfileCard } from "@/components/admin/arena/AthleteProfileCard"
import type { AthleteProfileData } from "@/lib/profile-share/data"

// jsdom has no IntersectionObserver; framer-motion's useInView/whileInView need one.
beforeAll(() => {
  class IO {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
    takeRecords = vi.fn(() => [])
    root = null
    rootMargin = ""
    thresholds = []
  }
  vi.stubGlobal("IntersectionObserver", IO)
})

const base: AthleteProfileData = {
  name: { first: "Marcus", last: "Johnson" },
  avatarUrl: null,
  sport: "Basketball",
  position: "Point Guard",
  experienceLevel: "advanced",
  heightCm: 188,
  weightKg: 84,
  weightUnit: "kg",
  age: 24,
  memberSince: "2024-03-10T00:00:00Z",
  stats: { workouts: 247, streakDays: 18, totalVolumeKg: 412300, prCount: 31 },
  gymRecords: [{ exercise: "Back Squat", valueKg: 140, date: "2026-05-01T00:00:00Z" }],
  fieldRecords: [{ label: "CMJ", value: 48, unit: "cm", date: "2026-06-01" }],
  radarTests: [],
  program: {
    name: "Off-Season Power Block",
    currentWeek: 6,
    totalWeeks: 12,
    difficulty: "advanced",
    categories: ["strength"],
    splitType: "upper_lower",
  },
  career: [{ name: "Pre-Season Speed", completedAt: "2026-04-15T00:00:00Z" }],
  badges: [
    { id: "iron_streak", name: "Iron Streak", description: "18 consecutive training days", icon: "Flame", tier: "gold" },
  ],
  milestones: [{ title: "100 Workouts", description: null, type: "milestone", earnedAt: "2026-02-01T00:00:00Z" }],
  monthlyTraining: [
    { month: "2026-06", label: "Jun", sessions: 14, volumeKg: 52000 },
    { month: "2026-07", label: "Jul", sessions: 16, volumeKg: 58500 },
  ],
  assessments: [
    {
      title: "Mid-Season Testing",
      date: "2026-07-10T00:00:00Z",
      items: [{ name: "Back Squat", value: 140, unit: "kg" }],
    },
  ],
}

describe("AthleteProfileCard", () => {
  it("renders hero identity, physicals, records, program, badges", () => {
    render(<AthleteProfileCard data={base} />)
    expect(screen.getByText(/Marcus/)).toBeInTheDocument()
    expect(screen.getByText(/Point Guard/)).toBeInTheDocument()
    expect(screen.getByText(/188/)).toBeInTheDocument()
    // Appears in gym records AND the assessment battery — both intended.
    expect(screen.getAllByText(/Back Squat/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/Off-Season Power Block/)).toBeInTheDocument()
    expect(screen.getByText(/Iron Streak/)).toBeInTheDocument()
    expect(screen.getByText(/100 Workouts/)).toBeInTheDocument()
    expect(screen.getByText(/Pre-Season Speed/)).toBeInTheDocument()
    expect(screen.getByText(/Training with DJP since Mar 2024/)).toBeInTheDocument()
  })

  it("hides empty sections and their tabs but always renders hero + stats", () => {
    render(
      <AthleteProfileCard
        data={{
          ...base,
          gymRecords: [],
          fieldRecords: [],
          radarTests: [],
          program: null,
          career: [],
          badges: [],
          milestones: [],
          monthlyTraining: [],
          assessments: [],
        }}
      />,
    )
    expect(screen.getByText(/Marcus/)).toBeInTheDocument()
    expect(screen.getByText(/Workouts/)).toBeInTheDocument()
    expect(screen.queryByText(/Personal Records/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Current Program/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Achievements/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Career/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  })

  it("groups the card into tabs and keeps every panel's content in the DOM (print shows all)", () => {
    render(<AthleteProfileCard data={base} />)
    const tabNames = screen.getAllByRole("tab").map((t) => t.textContent)
    expect(tabNames).toEqual(["Progress", "Performance", "Program", "Awards"])
    // Force-mounted panels: content from every tab is present even though
    // only the first is visible on screen.
    expect(screen.getByText(/Mid-Season Testing/)).toBeInTheDocument()
    expect(screen.getByText(/Training Load/)).toBeInTheDocument()
    expect(screen.getByText(/Off-Season Power Block/)).toBeInTheDocument()
    expect(screen.getByText(/Iron Streak/)).toBeInTheDocument()
  })

  it("omits physical pills that are null", () => {
    render(<AthleteProfileCard data={{ ...base, heightCm: null, weightKg: null, age: null }} />)
    expect(screen.queryByText("188 CM")).not.toBeInTheDocument()
    expect(screen.queryByText(/AGE 24/)).not.toBeInTheDocument()
    expect(screen.queryByText(/84 KG/)).not.toBeInTheDocument()
  })

  it("shows weight and gym records in lbs when that is the client's unit", () => {
    render(<AthleteProfileCard data={{ ...base, weightUnit: "lbs" }} />)
    expect(screen.getByText(/185 LBS/)).toBeInTheDocument()
    expect(screen.getByText(/309 lbs/)).toBeInTheDocument() // 140 kg back squat
  })

  it("renders performance progression with direction-aware improvement when a test has 2+ results", () => {
    render(
      <AthleteProfileCard
        data={{
          ...base,
          radarTests: [
            // Faster sprint: raw -10% must render as ↑10% improvement.
            { testType: "sprint_10m", resultValue: 2.0, resultUnit: "s", customName: null, bodyWeightKg: null, testDate: "2026-01-01" },
            { testType: "sprint_10m", resultValue: 1.8, resultUnit: "s", customName: null, bodyWeightKg: null, testDate: "2026-03-01" },
          ],
        }}
      />,
    )
    expect(screen.getByText(/Performance Progression/i)).toBeInTheDocument()
    // Progression panel + Test Trends small-multiple — both render the series.
    expect(screen.getAllByText(/10m Sprint/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText(/1\.8 s/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("10%")).toBeInTheDocument()
  })

  it("hides performance progression when no test type has 2+ results", () => {
    render(
      <AthleteProfileCard
        data={{
          ...base,
          radarTests: [
            { testType: "cmj", resultValue: 48, resultUnit: "cm", customName: null, bodyWeightKg: null, testDate: "2026-06-01" },
          ],
        }}
      />,
    )
    expect(screen.queryByText(/Performance Progression/i)).not.toBeInTheDocument()
  })
})
