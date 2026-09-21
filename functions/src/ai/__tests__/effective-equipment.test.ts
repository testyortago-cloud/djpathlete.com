import { describe, it, expect } from "vitest"
import { resolveEffectiveEquipment } from "../shared-helpers.js"

const PROFILE = ["dumbbell", "barbell", "cable_machine"]

describe("resolveEffectiveEquipment — precedence", () => {
  it("uses the profile, widened by equipment the coach named, when nothing constrains it", () => {
    const r = resolveEffectiveEquipment({
      override: null,
      profileEquipment: PROFILE,
      intentRequired: ["kettlebell"],
      intentOnly: null,
    })
    expect(r.equipment.sort()).toEqual(["barbell", "cable_machine", "dumbbell", "kettlebell"])
    expect(r.strict).toBe(false)
    expect(r.source).toBe("profile")
  })

  it("an explicit override REPLACES the profile rather than adding to it", () => {
    const r = resolveEffectiveEquipment({
      override: ["yoga_mat"],
      profileEquipment: PROFILE,
      intentRequired: [],
      intentOnly: null,
    })
    expect(r.equipment).toEqual(["yoga_mat"])
    expect(r.strict).toBe(true)
    expect(r.source).toBe("override")
  })

  it("an EMPTY override means nothing at all, not 'unset'", () => {
    const r = resolveEffectiveEquipment({
      override: [],
      profileEquipment: PROFILE,
      intentRequired: [],
      intentOnly: null,
    })
    expect(r.equipment).toEqual([])
    expect(r.strict).toBe(true)
    expect(r.source).toBe("override")
  })

  it("an override is NOT widened by equipment inferred from the coach's prose", () => {
    // Otherwise unticking "dumbbell" and writing "hotel week" hands it back.
    const r = resolveEffectiveEquipment({
      override: ["yoga_mat"],
      profileEquipment: PROFILE,
      intentRequired: ["dumbbell"],
      intentOnly: null,
    })
    expect(r.equipment).toEqual(["yoga_mat"])
  })

  it("a typed restriction narrows the profile when no override was set", () => {
    const r = resolveEffectiveEquipment({
      override: null,
      profileEquipment: PROFILE,
      intentRequired: [],
      intentOnly: [],
    })
    expect(r.equipment).toEqual([])
    expect(r.strict).toBe(true)
    expect(r.source).toBe("instructions")
  })

  it("a typed 'bands only' restriction wins over the client's full gym", () => {
    const r = resolveEffectiveEquipment({
      override: null,
      profileEquipment: PROFILE,
      intentRequired: [],
      intentOnly: ["resistance_band"],
    })
    expect(r.equipment).toEqual(["resistance_band"])
    expect(r.strict).toBe(true)
  })

  it("an explicit override beats a typed restriction — the coach ticked boxes second", () => {
    const r = resolveEffectiveEquipment({
      override: ["dumbbell"],
      profileEquipment: PROFILE,
      intentRequired: [],
      intentOnly: [],
    })
    expect(r.equipment).toEqual(["dumbbell"])
    expect(r.source).toBe("override")
  })

  it("treats a null/undefined override as 'no override'", () => {
    for (const override of [null, undefined]) {
      const r = resolveEffectiveEquipment({
        override,
        profileEquipment: PROFILE,
        intentRequired: [],
        intentOnly: null,
      })
      expect(r.source).toBe("profile")
      expect(r.strict).toBe(false)
    }
  })

  it("deduplicates without reordering the surviving items", () => {
    const r = resolveEffectiveEquipment({
      override: null,
      profileEquipment: ["dumbbell", "dumbbell", "bench"],
      intentRequired: ["bench"],
      intentOnly: null,
    })
    expect(r.equipment).toEqual(["dumbbell", "bench"])
  })
})
