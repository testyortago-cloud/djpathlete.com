import { describe, it, expect, beforeEach } from "vitest"
import {
  recordProgramExerciseUsage,
  getCoachRecentUsage,
  getClientRecentUsage,
} from "@/lib/db/exercise-usage"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_COACH = "00000000-0000-0000-0000-0000000aaaaa"
const TEST_CLIENT = "00000000-0000-0000-0000-0000000bbbbb"
const TEST_PROGRAM = "00000000-0000-0000-0000-0000000ccccc"
const TEST_EX_1 = "00000000-0000-0000-0000-0000000ddddd"
const TEST_EX_2 = "00000000-0000-0000-0000-0000000eeeee"

describe("exercise-usage DAL", () => {
  const supabase = createServiceRoleClient()

  beforeEach(async () => {
    await supabase.from("generated_exercise_usage").delete().eq("coach_id", TEST_COACH)
  })

  it("recordProgramExerciseUsage writes rows; getCoachRecentUsage returns them grouped by exercise_id", async () => {
    await recordProgramExerciseUsage({
      coach_id: TEST_COACH,
      client_id: TEST_CLIENT,
      program_id: TEST_PROGRAM,
      rows: [
        { exercise_id: TEST_EX_1, week_number: 1, day_number: 1 },
        { exercise_id: TEST_EX_1, week_number: 2, day_number: 1 },
        { exercise_id: TEST_EX_2, week_number: 1, day_number: 2 },
      ],
    })

    const usage = await getCoachRecentUsage(TEST_COACH, 60)
    expect(usage.get(TEST_EX_1)).toBeDefined()
    expect(usage.get(TEST_EX_1)).toBeLessThanOrEqual(1)
    expect(usage.get(TEST_EX_2)).toBeDefined()
  })

  it("getClientRecentUsage scopes to the given client only", async () => {
    await recordProgramExerciseUsage({
      coach_id: TEST_COACH,
      client_id: TEST_CLIENT,
      program_id: TEST_PROGRAM,
      rows: [{ exercise_id: TEST_EX_1, week_number: 1, day_number: 1 }],
    })

    const usage = await getClientRecentUsage(TEST_CLIENT, 90)
    expect(usage.get(TEST_EX_1)).toBeDefined()

    const otherClient = "99999999-9999-9999-9999-999999999999"
    const empty = await getClientRecentUsage(otherClient, 90)
    expect(empty.size).toBe(0)
  })

  it("getCoachRecentUsage respects the daysBack window", async () => {
    await supabase.from("generated_exercise_usage").insert({
      coach_id: TEST_COACH,
      client_id: TEST_CLIENT,
      exercise_id: TEST_EX_1,
      program_id: TEST_PROGRAM,
      week_number: 1,
      day_number: 1,
      assigned_at: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    })

    const usage60 = await getCoachRecentUsage(TEST_COACH, 60)
    expect(usage60.size).toBe(0)

    const usage180 = await getCoachRecentUsage(TEST_COACH, 180)
    expect(usage180.get(TEST_EX_1)).toBeDefined()
  })
})
