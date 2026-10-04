import type { ProgramWeek } from "./types.js"

/**
 * The architect's slots, made checkable (2026-10-04). target_muscles was free
 * text — the prompt's own examples wrote "anti-rotation", "cardiovascular",
 * "single-leg stability" — and the selector was told to match it against the
 * library's primary_muscles, which it cannot. Numbers had no bounds anywhere:
 * 0 sets, RPE 11 and 900 s rest all passed the schema.
 */

export function normalizeMuscleName(m: string): string {
  return m
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
}

/** Distinct library muscles with at least `minUses` uses. Live library (2026-10-04): 18 main values. */
export function muscleVocabulary(library: Array<{ primary_muscles?: string[] | null }>, minUses = 3): string[] {
  const counts = new Map<string, number>()
  for (const ex of library)
    for (const m of ex.primary_muscles ?? []) {
      const k = normalizeMuscleName(m)
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  return [...counts.entries()].filter(([, n]) => n >= minUses).map(([m]) => m)
}

/** Words the architect writes that are not library muscles. Applied only when the word is not itself in the list. */
const MUSCLE_ALIASES: Record<string, string[]> = {
  anti_rotation: ["core", "obliques"],
  anti_extension: ["core"],
  anti_lateral_flexion: ["obliques", "core"],
  abs: ["core"],
  rectus_abdominis: ["core"],
  transverse_abdominis: ["core"],
  scapular_stabilizers: ["upper_back"],
  rhomboids: ["upper_back"],
  rotator_cuff: ["shoulders"],
  rear_delts: ["shoulders"],
  delts: ["shoulders"],
  deltoids: ["shoulders"],
  quads: ["quadriceps"],
  hams: ["hamstrings"],
  glute: ["glutes"],
  erectors: ["lower_back"],
  spinal_erectors: ["lower_back"],
  posterior_chain: ["glutes", "hamstrings"],
  single_leg_stability: ["glutes"],
  hip_stabilizers: ["glutes", "abductors"],
  pecs: ["chest"],
  latissimus_dorsi: ["lats"],
}

const PATTERN_DEFAULT_MUSCLES: Record<string, string[]> = {
  squat: ["quadriceps", "glutes"],
  lunge: ["quadriceps", "glutes"],
  hinge: ["hamstrings", "glutes"],
  push: ["chest", "shoulders", "triceps"],
  pull: ["lats", "upper_back", "biceps"],
  carry: ["core", "forearms"],
  rotation: ["obliques", "core"],
  isometric: ["core"],
  locomotion: ["calves", "glutes"],
  conditioning: ["quadriceps", "glutes"],
}

export interface SlotChange {
  slot_id: string
  field: string
  from: unknown
  to: unknown
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function normalizeSkeletonInPlace(weeks: ProgramWeek[], vocab: string[]): SlotChange[] {
  const allowed = new Set(vocab)
  const changes: SlotChange[] = []
  for (const week of weeks)
    for (const day of week.days)
      for (const slot of day.slots) {
        const note = (field: string, from: unknown, to: unknown) =>
          changes.push({ slot_id: slot.slot_id, field, from, to })

        // Muscles
        const mapped: string[] = []
        for (const raw of slot.target_muscles ?? []) {
          const m = normalizeMuscleName(raw)
          const out = allowed.has(m) ? [m] : (MUSCLE_ALIASES[m] ?? []).filter((a) => allowed.has(a))
          for (const o of out) if (!mapped.includes(o)) mapped.push(o)
        }
        let muscles = mapped
        if (muscles.length === 0) {
          muscles = (PATTERN_DEFAULT_MUSCLES[slot.movement_pattern] ?? []).filter((a) => allowed.has(a))
        }
        if (muscles.length === 0) muscles = slot.target_muscles // nothing better: keep, never empty
        if (JSON.stringify(muscles) !== JSON.stringify(slot.target_muscles)) {
          note("target_muscles", slot.target_muscles, muscles)
          slot.target_muscles = muscles
        }

        // Numbers
        const sets = Number.isFinite(slot.sets) ? clamp(Math.round(slot.sets), 1, 10) : 3
        if (sets !== slot.sets) {
          note("sets", slot.sets, sets)
          slot.sets = sets
        }
        const rest = Number.isFinite(slot.rest_seconds) ? clamp(Math.round(slot.rest_seconds), 0, 600) : 90
        if (rest !== slot.rest_seconds) {
          note("rest_seconds", slot.rest_seconds, rest)
          slot.rest_seconds = rest
        }
        if (slot.rpe_target != null) {
          const rpe = Number.isFinite(slot.rpe_target) ? clamp(slot.rpe_target, 1, 10) : null
          if (rpe !== slot.rpe_target) {
            note("rpe_target", slot.rpe_target, rpe)
            slot.rpe_target = rpe
          }
        }
        if (slot.intensity_pct != null) {
          const pct = Number.isFinite(slot.intensity_pct) ? clamp(slot.intensity_pct, 30, 110) : null
          if (pct !== slot.intensity_pct) {
            note("intensity_pct", slot.intensity_pct, pct)
            slot.intensity_pct = pct
          }
        }
      }
  return changes
}

/**
 * intensity_pct × estimated 1RM becomes the athlete's suggested weight, so a
 * percentage the architect invented is a load nobody chose. Keep slot
 * percentages only when the coach's words contain one.
 */
export function stripUnrequestedIntensity(weeks: ProgramWeek[], coachText: string | undefined): SlotChange[] {
  if (/\d\s*%/.test(coachText ?? "")) return []
  const changes: SlotChange[] = []
  for (const week of weeks)
    for (const day of week.days)
      for (const slot of day.slots) {
        if (slot.intensity_pct == null) continue
        changes.push({ slot_id: slot.slot_id, field: "intensity_pct", from: slot.intensity_pct, to: null })
        slot.intensity_pct = null
      }
  return changes
}
