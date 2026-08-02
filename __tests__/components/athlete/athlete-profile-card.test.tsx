import { render, screen } from "@testing-library/react"
import { describe, it, expect, beforeAll, vi } from "vitest"
import { AthleteProfileCard } from "@/components/public/athlete/AthleteProfileCard"
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
}

describe("AthleteProfileCard", () => {
  it("renders hero identity, physicals, records, program, badges", () => {
    render(<AthleteProfileCard data={base} />)
    expect(screen.getByText(/Marcus/)).toBeInTheDocument()
    expect(screen.getByText(/Point Guard/)).toBeInTheDocument()
    expect(screen.getByText(/188/)).toBeInTheDocument()
    expect(screen.getByText(/Back Squat/)).toBeInTheDocument()
    expect(screen.getByText(/Off-Season Power Block/)).toBeInTheDocument()
    expect(screen.getByText(/Iron Streak/)).toBeInTheDocument()
    expect(screen.getByText(/100 Workouts/)).toBeInTheDocument()
    expect(screen.getByText(/Pre-Season Speed/)).toBeInTheDocument()
    expect(screen.getByText(/Training with DJP since Mar 2024/)).toBeInTheDocument()
  })

  it("hides empty sections but always renders hero + stats", () => {
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
        }}
      />,
    )
    expect(screen.getByText(/Marcus/)).toBeInTheDocument()
    expect(screen.getByText(/Workouts/)).toBeInTheDocument()
    expect(screen.queryByText(/Personal Records/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Current Program/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Achievements/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Career/i)).not.toBeInTheDocument()
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
    expect(screen.getByText(/10m Sprint/)).toBeInTheDocument()
    expect(screen.getByText(/1\.8 s/)).toBeInTheDocument()
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
