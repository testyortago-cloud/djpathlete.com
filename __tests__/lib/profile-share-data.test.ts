import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  getProfileByUserId: vi.fn(),
  getCompletedSessionCount: vi.fn(),
  getTotalVolumeKg: vi.fn(),
  getWorkoutStreak: vi.fn(),
  getAchievements: vi.fn(),
  getAchievementsByType: vi.fn(),
  getPRsByUser: vi.fn(),
  listTests: vi.fn(),
  listTrainingSessions: vi.fn(),
  listReadiness: vi.fn(),
  getActiveAssignmentWithProgram: vi.fn(),
  getCompletedAssignments: vi.fn(),
  getExerciseNamesByIds: vi.fn(),
}))

vi.mock("@/lib/db/users", () => ({ getUserById: mocks.getUserById }))
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: mocks.getProfileByUserId }))
vi.mock("@/lib/db/workout-sessions", () => ({
  getCompletedSessionCount: mocks.getCompletedSessionCount,
  getTotalVolumeKg: mocks.getTotalVolumeKg,
}))
vi.mock("@/lib/db/progress", () => ({ getWorkoutStreak: mocks.getWorkoutStreak }))
vi.mock("@/lib/db/achievements", () => ({
  getAchievements: mocks.getAchievements,
  getAchievementsByType: mocks.getAchievementsByType,
}))
vi.mock("@/lib/db/performance-tests", () => ({
  getPRsByUser: mocks.getPRsByUser,
  listByUser: mocks.listTests,
}))
vi.mock("@/lib/db/training-sessions", () => ({ listByUser: mocks.listTrainingSessions }))
vi.mock("@/lib/db/daily-readiness", () => ({ listByUser: mocks.listReadiness }))
vi.mock("@/lib/db/assignments", () => ({
  getActiveAssignmentWithProgram: mocks.getActiveAssignmentWithProgram,
  getCompletedAssignments: mocks.getCompletedAssignments,
}))
vi.mock("@/lib/db/exercises", () => ({ getExerciseNamesByIds: mocks.getExerciseNamesByIds }))

import { getAthleteProfileData, computeAge } from "@/lib/profile-share/data"

const activeClient = {
  id: "u1", role: "client", status: "active",
  first_name: "Marcus", last_name: "Johnson",
  avatar_url: null, created_at: "2024-03-10T00:00:00Z",
}
const fullProfile = {
  user_id: "u1", is_minor: false, sport: "Basketball", position: "Point Guard",
  experience_level: "advanced", height_cm: 188, weight_kg: 84, weight_unit: "kg",
  date_of_birth: "2002-01-15", training_years: 4,
}

function armHappyPath() {
  mocks.getUserById.mockResolvedValue(activeClient)
  mocks.getProfileByUserId.mockResolvedValue(fullProfile)
  mocks.getCompletedSessionCount.mockResolvedValue(247)
  mocks.getTotalVolumeKg.mockResolvedValue(412300)
  mocks.getWorkoutStreak.mockResolvedValue(18)
  mocks.getAchievements.mockResolvedValue([
    { id: "m1", achievement_type: "milestone", title: "100 Workouts", description: null, earned_at: "2026-02-01T00:00:00Z" },
    { id: "p9", achievement_type: "pr", title: "Weight PR!", earned_at: "2026-01-01T00:00:00Z" },
  ])
  mocks.getAchievementsByType.mockResolvedValue([
    { id: "a1", title: "Weight PR!", exercise_id: "e1", metric_value: 140, earned_at: "2026-05-01T00:00:00Z" },
    { id: "a2", title: "Weight PR!", exercise_id: "e1", metric_value: 135, earned_at: "2026-03-01T00:00:00Z" },
    { id: "a3", title: "Rep PR!", exercise_id: "e1", metric_value: 12, earned_at: "2026-04-01T00:00:00Z" },
    { id: "a4", title: "Weight PR!", exercise_id: null, metric_value: 90, earned_at: "2026-04-01T00:00:00Z" },
  ])
  mocks.getPRsByUser.mockResolvedValue([
    { test_type: "cmj", custom_name: null, result_value: 48, result_unit: "cm", test_date: "2026-06-01", best_method: "highest" },
    { test_type: "custom", custom_name: "Med Ball Throw", result_value: 12.5, result_unit: "m", test_date: "2026-05-20", best_method: "highest" },
  ])
  mocks.listTests.mockResolvedValue([{ test_type: "cmj", result_value: 48, test_date: "2026-06-01", body_weight_kg: null }])
  mocks.listTrainingSessions.mockResolvedValue([])
  mocks.listReadiness.mockResolvedValue([])
  mocks.getActiveAssignmentWithProgram.mockResolvedValue({
    current_week: 6, total_weeks: 10, start_date: "2026-06-01",
    programs: { name: "Off-Season Power Block", duration_weeks: 12, difficulty: "advanced", category: ["strength"], split_type: "upper_lower" },
  })
  mocks.getCompletedAssignments.mockResolvedValue([
    { updated_at: "2026-04-15T00:00:00Z", programs: { name: "Pre-Season Speed" } },
  ])
  mocks.getExerciseNamesByIds.mockResolvedValue({ e1: "Back Squat" })
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
})

describe("computeAge", () => {
  it("computes age from an ISO date", () => {
    expect(computeAge("2002-01-15", new Date("2026-07-11T00:00:00Z"))).toBe(24)
  })
  it("handles pre-birthday", () => {
    expect(computeAge("2002-12-31", new Date("2026-07-11T00:00:00Z"))).toBe(23)
  })
  it("returns null for null/invalid", () => {
    expect(computeAge(null)).toBeNull()
    expect(computeAge("not-a-date")).toBeNull()
  })
})

describe("getAthleteProfileData", () => {
  it("assembles the full card", async () => {
    armHappyPath()
    const d = await getAthleteProfileData("u1")
    expect(d).not.toBeNull()
    expect(d!.name).toEqual({ first: "Marcus", last: "Johnson" })
    expect(d!.age).toBe(24) // as of 2026 vs 2002-01-15 (post-birthday)
    expect(d!.stats.workouts).toBe(247)
    expect(d!.stats.totalVolumeKg).toBe(412300)
    // gym records: best weight PR per exercise, name resolved, rep PR + null-exercise excluded
    expect(d!.gymRecords).toEqual([{ exercise: "Back Squat", valueKg: 140, date: "2026-05-01T00:00:00Z" }])
    // field records: custom tests labeled by custom_name
    expect(d!.fieldRecords.map((r) => r.label)).toEqual(expect.arrayContaining(["Med Ball Throw"]))
    // program uses effectiveTotalWeeks(10, 12) = 12
    expect(d!.program).toMatchObject({ name: "Off-Season Power Block", currentWeek: 6, totalWeeks: 12 })
    expect(d!.career).toEqual([{ name: "Pre-Season Speed", completedAt: "2026-04-15T00:00:00Z" }])
    // milestones exclude PR-type achievements
    expect(d!.milestones.map((m) => m.title)).toEqual(["100 Workouts"])
    // prCount = gym PR achievements (4) + field PR rows (2)
    expect(d!.stats.prCount).toBe(6)
  })

  it("returns null for non-clients, inactive users, minors, and missing users", async () => {
    armHappyPath()
    mocks.getUserById.mockResolvedValue({ ...activeClient, role: "admin" })
    expect(await getAthleteProfileData("u1")).toBeNull()

    armHappyPath()
    mocks.getUserById.mockResolvedValue({ ...activeClient, status: "inactive" })
    expect(await getAthleteProfileData("u1")).toBeNull()

    armHappyPath()
    mocks.getProfileByUserId.mockResolvedValue({ ...fullProfile, is_minor: true })
    expect(await getAthleteProfileData("u1")).toBeNull()

    armHappyPath()
    mocks.getUserById.mockRejectedValue(new Error("no row"))
    expect(await getAthleteProfileData("u1")).toBeNull()
  })

  it("degrades failed sources to empty sections instead of throwing", async () => {
    armHappyPath()
    mocks.getPRsByUser.mockRejectedValue(new Error("view missing"))
    mocks.getAchievementsByType.mockRejectedValue(new Error("boom"))
    mocks.getActiveAssignmentWithProgram.mockRejectedValue(new Error("boom"))
    const d = await getAthleteProfileData("u1")
    expect(d).not.toBeNull()
    expect(d!.gymRecords).toEqual([])
    expect(d!.fieldRecords).toEqual([])
    expect(d!.program).toBeNull()
  })

  it("renders with a missing client_profiles row (nulled physicals)", async () => {
    armHappyPath()
    mocks.getProfileByUserId.mockResolvedValue(null)
    const d = await getAthleteProfileData("u1")
    expect(d).not.toBeNull()
    expect(d!.age).toBeNull()
    expect(d!.heightCm).toBeNull()
    expect(d!.sport).toBeNull()
  })
})
