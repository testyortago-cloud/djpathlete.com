import { describe, it, expect } from "vitest"
import {
  measurementsToTests,
  localDate,
  looksLikeClient,
  syncWindows,
  type OutputMeasurement,
} from "@/lib/output-sports/map"

let n = 0
function m(
  exerciseId: string,
  completedDate: string,
  metrics: Record<string, number>,
  category = "Jumps",
): OutputMeasurement {
  return {
    id: `m${++n}`,
    athleteId: "ath1",
    exerciseId,
    exerciseCategory: category,
    completedDate,
    variant: null,
    metrics: Object.entries(metrics).map(([field, value]) => ({ field, value })),
  }
}

describe("measurementsToTests", () => {
  it("turns a day's CMJs into one result: the best jump, in cm, with every jump as a trial", () => {
    const { rows } = measurementsToTests(
      [
        m("BILATERAL_CMJ", "2026-11-03T14:00:00Z", { jumpHeight: 0.4512, flightTime: 0.6 }),
        m("BILATERAL_CMJ", "2026-11-03T14:02:00Z", { jumpHeight: 0.4798 }),
        m("BILATERAL_CMJ", "2026-11-03T14:04:00Z", { jumpHeight: 0.4662 }),
      ],
      "UTC",
    )
    expect(rows).toEqual([
      expect.objectContaining({
        output_key: "cmj:2026-11-03",
        test_type: "cmj",
        test_date: "2026-11-03",
        result_value: 48,
        result_unit: "cm",
        trial_values: [45.1, 48, 46.6],
        best_method: "highest",
      }),
    ])
  })

  it("takes the FASTEST sprint, since lower is better, and merges Output's two 20 m exercises", () => {
    const { rows } = measurementsToTests(
      [
        m("20_METRE_TIME_INPUT", "2026-11-03T15:00:00Z", { duration: 3.21 }, "Inputs"),
        m("20_METRE_SPEED", "2026-11-03T15:05:00Z", { duration: 3.087 }, "Speed & Agility"),
      ],
      "UTC",
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      test_type: "sprint_20m",
      result_value: 3.09,
      result_unit: "sec",
      best_method: "lowest",
    })
    expect(rows[0].trial_values).toEqual([3.21, 3.09])
  })

  it("keeps different days and different tests apart", () => {
    const { rows } = measurementsToTests(
      [
        m("BILATERAL_CMJ", "2026-11-03T14:00:00Z", { jumpHeight: 0.45 }),
        m("BILATERAL_CMJ", "2026-11-04T14:00:00Z", { jumpHeight: 0.46 }),
        m("SQUAT_JUMP", "2026-11-03T14:10:00Z", { jumpHeight: 0.4 }),
      ],
      "UTC",
    )
    expect(rows.map((r) => r.output_key).sort()).toEqual(["cmj:2026-11-03", "cmj:2026-11-04", "squat_jump:2026-11-03"])
  })

  it("files a session by the coach's own calendar day, not UTC", () => {
    // 01:30 UTC on the 4th is still the evening of the 3rd in New York.
    const { rows } = measurementsToTests(
      [m("BILATERAL_CMJ", "2026-11-04T01:30:00Z", { jumpHeight: 0.45 })],
      "America/New_York",
    )
    expect(rows[0].test_date).toBe("2026-11-03")
  })

  it("imports a lift as the estimated 1RM Output works out from bar speed, and says so", () => {
    const { rows } = measurementsToTests(
      [
        m(
          "BARBELL_BACK_SQUAT",
          "2026-11-03T18:00:00Z",
          { meanVelocity: 0.7, estimatedOneRepMax: 125.389 },
          "Barbell Velocity",
        ),
        m(
          "BARBELL_BACK_SQUAT",
          "2026-11-03T18:05:00Z",
          { meanVelocity: 0.6, estimatedOneRepMax: 127.04 },
          "Barbell Velocity",
        ),
      ],
      "UTC",
    )
    expect(rows[0]).toMatchObject({ test_type: "back_squat_1rm", result_value: 127, result_unit: "kg" })
    expect(rows[0].notes).toMatch(/estimated/i)
  })

  it("files a single-leg CMJ under its own leg, apart from the other leg and the two-leg jump", () => {
    // The shape Output sent on 2026-11-02: UNILATERAL_CMJ once per leg, told apart only by variant.
    const side = (variant: string | null, at: string, jumpHeight: number) => ({
      ...m("UNILATERAL_CMJ", at, { jumpHeight }),
      variant,
    })
    const { rows, skipped } = measurementsToTests(
      [
        side("Left", "2026-11-02T14:14:44Z", 0.2779),
        side("Right", "2026-11-02T14:15:04Z", 0.124),
        side("Left", "2026-11-02T14:16:00Z", 0.1923),
        m("BILATERAL_CMJ", "2026-11-02T14:20:00Z", { jumpHeight: 0.2993 }),
        side(null, "2026-11-02T14:21:00Z", 0.3),
      ],
      "UTC",
    )
    expect(rows.map((r) => [r.test_type, r.result_value, r.trial_values])).toEqual([
      ["cmj_left", 27.8, [27.8, 19.2]],
      ["cmj_right", 12.4, [12.4]],
      ["cmj", 29.9, [29.9]],
    ])
    expect(rows[0].output_key).toBe("cmj_left:2026-11-02")
    // Without a leg there is nothing to file it under, so it stays in Output.
    expect(skipped).toEqual({ Jumps: 1 })
  })

  // The tests Darren asked for on 2026-11-03. Shapes as Output sent them on 2026-11-02/03.
  const sided = (
    exerciseId: string,
    variant: string | null,
    at: string,
    metrics: Record<string, number>,
    category: string,
  ) => ({
    ...m(exerciseId, at, metrics, category),
    variant,
  })

  it("takes Repeated Jumps' average RSI, per leg for the single-leg version", () => {
    const { rows } = measurementsToTests(
      [
        m("REPEATED_JUMPS", "2026-11-03T14:00:00Z", { averageRsi: 1.8234, maxRsi: 2.1 }, "Reactive Strength"),
        sided(
          "UNILATERAL_REPEATED_JUMPS",
          "Left",
          "2026-11-03T14:01:00Z",
          { averageRsi: 0.1441, maxRsi: 0.1836 },
          "Reactive Strength",
        ),
        sided(
          "UNILATERAL_REPEATED_JUMPS",
          "Right",
          "2026-11-03T14:02:00Z",
          { averageRsi: 0.2, maxRsi: 0.25 },
          "Reactive Strength",
        ),
      ],
      "UTC",
    )
    expect(rows.map((r) => [r.test_type, r.result_value, r.result_unit])).toEqual([
      ["repeated_jumps", 1.82, "RSI"],
      ["repeated_jumps_left", 0.14, "RSI"],
      ["repeated_jumps_right", 0.2, "RSI"],
    ])
  })

  it("takes the SHORTEST average ground contact of a day's sprints, in ms, per leg", () => {
    const { rows } = measurementsToTests(
      [
        sided(
          "SPRINTING_CONTACTS",
          "Left",
          "2026-11-03T14:00:00Z",
          { averageContactTime: 0.3367, bestContactTime: 0.196 },
          "Contacts",
        ),
        sided("SPRINTING_CONTACTS", "Left", "2026-11-03T14:05:00Z", { averageContactTime: 0.2912 }, "Contacts"),
        sided("SPRINTING_CONTACTS", "Right", "2026-11-03T14:06:00Z", { averageContactTime: 0.305 }, "Contacts"),
      ],
      "UTC",
    )
    expect(rows.map((r) => [r.test_type, r.result_value, r.result_unit, r.best_method, r.trial_values])).toEqual([
      ["sprint_contact_left", 291, "ms", "lowest", [337, 291]],
      ["sprint_contact_right", 305, "ms", "lowest", [305]],
    ])
  })

  it("takes the med ball throw's peak ball speed and notes the ball's weight once", () => {
    const { rows } = measurementsToTests(
      [
        m(
          "MEDBALL_VERTICAL_PRESS_SQUAT_THROW_SST",
          "2026-11-03T14:00:00Z",
          { peakVelocity: 3.8475, peakPower: 845, weight: 4.54 },
          "Slams, Swings & Throws",
        ),
        m(
          "MEDBALL_VERTICAL_PRESS_SQUAT_THROW_SST",
          "2026-11-03T14:02:00Z",
          { peakVelocity: 3.91, weight: 4.54 },
          "Slams, Swings & Throws",
        ),
      ],
      "UTC",
    )
    expect(rows[0]).toMatchObject({ test_type: "med_ball_squat_throw", result_value: 3.91, result_unit: "m/s" })
    expect(rows[0].notes).toBe("Imported from Output Sports. 4.54 kg ball")
  })

  it("takes the trap bar's estimated 1RM and keeps each set's load and bar speed as the load-velocity profile", () => {
    const { rows } = measurementsToTests(
      [
        m(
          "TRAP_BAR_DEADLIFT",
          "2026-11-03T14:00:00Z",
          { weight: 60, meanVelocity: 1.6571, estimatedOneRepMax: 71.406 },
          "Barbell Velocity",
        ),
        m(
          "TRAP_BAR_DEADLIFT",
          "2026-11-03T14:05:00Z",
          { weight: 100, meanVelocity: 0.8123, estimatedOneRepMax: 140.2 },
          "Barbell Velocity",
        ),
      ],
      "UTC",
    )
    expect(rows[0]).toMatchObject({ test_type: "trap_bar_deadlift_1rm", result_value: 140.2, result_unit: "kg" })
    expect(rows[0].notes).toBe(
      "Imported from Output Sports. 1RM estimated by Output from bar speed. 60 kg at 1.66 m/s, 100 kg at 0.81 m/s",
    )
  })

  it("takes torso rotation's range of motion per side", () => {
    const { rows } = measurementsToTests(
      [
        sided("TORSO_ROTATION", "Left", "2026-11-03T14:00:00Z", { rangeOfMotion: 52.34 }, "Mobility"),
        sided("TORSO_ROTATION", "Right", "2026-11-03T14:01:00Z", { rangeOfMotion: 47.9 }, "Mobility"),
      ],
      "UTC",
    )
    expect(rows.map((r) => [r.test_type, r.result_value, r.result_unit])).toEqual([
      ["torso_rotation_left", 52.3, "deg"],
      ["torso_rotation_right", 47.9, "deg"],
    ])
  })

  it("keeps the drop jump's height as the result and its RSI in the note", () => {
    const { rows } = measurementsToTests(
      [m("BILATERAL_DROP_JUMP", "2026-11-03T14:00:00Z", { rsi: 1.874, jumpHeight: 0.38 }, "Reactive Strength")],
      "UTC",
    )
    expect(rows[0]).toMatchObject({ test_type: "drop_jump", result_value: 38, result_unit: "cm" })
    expect(rows[0].notes).toContain("RSI 1.87")
  })

  it("counts what it leaves in Output by Output's own category, and imports none of it", () => {
    const { rows, skipped } = measurementsToTests(
      [
        m("KNEE_TO_WALL", "2026-11-03T13:00:00Z", { rangeOfMotion: 58 }, "Mobility"),
        m("SHOULDER_FLEXION", "2026-11-03T13:01:00Z", { rangeOfMotion: 160 }, "Mobility"),
        m("UNILATERAL_HURDLE_HOPS_CONTACTS", "2026-11-03T13:02:00Z", { repCount: 5 }, "Contacts"),
        m("BILATERAL_CMJ", "2026-11-03T14:00:00Z", { jumpHeight: 0.45 }),
      ],
      "UTC",
    )
    expect(rows.map((r) => r.test_type)).toEqual(["cmj"])
    expect(skipped).toEqual({ Mobility: 2, Contacts: 1 })
  })

  it("skips a mapped measurement that lacks its number instead of importing a zero", () => {
    const { rows, skipped } = measurementsToTests(
      [
        m("BILATERAL_CMJ", "2026-11-03T14:00:00Z", { flightTime: 0.6 }),
        m("BILATERAL_CMJ", "2026-11-03T14:01:00Z", { jumpHeight: 0 }),
      ],
      "UTC",
    )
    expect(rows).toEqual([])
    expect(skipped).toEqual({ Jumps: 2 })
  })

  it("rejects a measurement for a different athlete than the one asked for", () => {
    const other = { ...m("BILATERAL_CMJ", "2026-11-03T14:00:00Z", { jumpHeight: 0.6 }), athleteId: "someone-else" }
    const mine = m("BILATERAL_CMJ", "2026-11-03T14:01:00Z", { jumpHeight: 0.45 })
    const { rows } = measurementsToTests([other, mine], "UTC", "ath1")
    expect(rows[0]).toMatchObject({ result_value: 45, trial_values: [45] })
  })
})

describe("looksLikeClient", () => {
  const athlete = { firstName: "Chris", lastName: "Hall", fullName: "Chris  Hall", dateOfBirth: "2004-05-06T00:00:00Z" }
  it("matches the same full name, whatever the case and spacing", () => {
    expect(looksLikeClient(athlete, { first_name: "chris", last_name: "HALL ", date_of_birth: null })).toBe(true)
  })
  it("matches a nickname when surname and date of birth agree", () => {
    expect(
      looksLikeClient(athlete, { first_name: "Christopher", last_name: "Hall", date_of_birth: "2004-05-06" }),
    ).toBe(true)
  })
  it("does not match on date of birth alone, or on an empty name", () => {
    expect(looksLikeClient(athlete, { first_name: "Sam", last_name: "Lee", date_of_birth: "2004-05-06" })).toBe(false)
    const blank = { firstName: null, lastName: null, fullName: null, dateOfBirth: null }
    expect(looksLikeClient(blank, { first_name: null, last_name: null, date_of_birth: null })).toBe(false)
  })
})

describe("localDate", () => {
  it("falls back to UTC for a time zone the runtime does not know", () => {
    expect(localDate("2026-11-04T01:30:00Z", "Not/AZone")).toBe("2026-11-04")
  })
})

describe("syncWindows", () => {
  it("splits a long range into windows of at most 31 days that cover it end to end", () => {
    const from = new Date("2026-01-01T00:00:00Z")
    const to = new Date("2026-03-15T00:00:00Z")
    const w = syncWindows(from, to)
    expect(w[0].start).toEqual(from)
    expect(w[w.length - 1].end).toEqual(to)
    for (let i = 0; i < w.length; i++) {
      expect(w[i].end.getTime() - w[i].start.getTime()).toBeLessThanOrEqual(31 * 86_400_000)
      if (i > 0) expect(w[i].start).toEqual(w[i - 1].end)
    }
  })
})
