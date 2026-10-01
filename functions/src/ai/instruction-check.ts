import { statedExerciseTotal, parsePrescription } from "./instruction-count.js"

// ── Types ──

export interface InstructionCheckItem {
  instruction: string // the coach's words this line is about, short
  met: boolean
  detail: string // plain-language evidence
  source: "code" | "ai"
}
export interface InstructionCheck {
  status: "passed" | "failed" | "unchecked"
  items: InstructionCheckItem[]
  rebuilt: boolean
  rebuild_reason: string | null
  note: string | null
}
export interface CheckDayRow {
  day_of_week: number
  order: number
  exercise_id: string
  name: string
  movement_pattern: string | null
  primary_muscles: string[]
  role: string
  sets: number | null
  reps: string | null
  rest_seconds: number | null
  tempo: string | null
}
export interface CheckInput {
  scope: "day" | "week"
  instructions: string | null // the coach's ORIGINAL words
  rows: CheckDayRow[] // the finished day/week, in order
  pool: { ids: string[]; mode: "preferred" | "strict"; offeredIds: string[] } | null
  namedMatches: Array<{ phrase: string; exercise_ids: string[] }> // IntentResolution.matched
  bannedIds: string[]
  nameById: Record<string, string>
}

// ── Code checks ──

const EXEMPT_ROLES = new Set(["warm_up", "cool_down"])
const fmt = (r: [number, number], unit = "") => (r[0] === r[1] ? `${r[0]}${unit}` : `${r[0]}-${r[1]}${unit}`)
const normTempo = (t: string | null) => (t ?? "").trim().replace(/\./g, "-").toLowerCase()

/** "8", "8-10", "8 each side" → [8,8] / [8,10]; a hold ("30s hold", "20 sec") → null (exempt). */
function repsRange(reps: string | null): [number, number] | null {
  if (!reps) return null
  if (/\d\s*(s|sec|secs|seconds)\b|hold/i.test(reps)) return null
  const m = reps.match(/^\s*(\d+)(?:\s*[-–]\s*(\d+))?/)
  return m ? [Number(m[1]), Number(m[2] ?? m[1])] : null
}

export function runCodeChecks(input: CheckInput): InstructionCheckItem[] {
  const items: InstructionCheckItem[] = []
  const add = (instruction: string, met: boolean, detail: string) =>
    items.push({ instruction, met, detail, source: "code" })
  // Prescriptions are for working sets: warm-up / cool-down rows and holds
  // ("30s hold" — reps written as a time) are exempt from EVERY prescription line.
  const isHold = (r: CheckDayRow) => !!r.reps && repsRange(r.reps) === null
  const working = input.rows.filter((r) => !EXEMPT_ROLES.has(r.role) && !isHold(r))

  if (input.scope === "day") {
    const total = statedExerciseTotal(input.instructions)
    if (total !== null) {
      const n = input.rows.length
      add(`${total} exercises`, n === total, n === total ? `${n} in the day` : `the day has ${n}`)
    }
  }

  const p = parsePrescription(input.instructions)
  const firstOutside = (test: (r: CheckDayRow) => boolean | null) => working.find((r) => test(r) === false)
  if (p.sets) {
    const [lo, hi] = p.sets
    const bad = firstOutside((r) => (r.sets === null ? null : r.sets >= lo && r.sets <= hi))
    add(`${fmt(p.sets)} sets`, !bad, bad ? `“${bad.name}” has ${bad.sets}` : `every exercise has ${fmt(p.sets)}`)
  }
  if (p.reps) {
    const [lo, hi] = p.reps
    const bad = firstOutside((r) => {
      const rr = repsRange(r.reps)
      return rr === null ? null : rr[0] >= lo && rr[1] <= hi
    })
    add(`${fmt(p.reps)} reps`, !bad, bad ? `“${bad.name}” is ${bad.reps}` : `every exercise is within ${fmt(p.reps)}`)
  }
  if (p.restSeconds) {
    const [lo, hi] = p.restSeconds
    const bad = firstOutside((r) => (r.rest_seconds === null ? null : r.rest_seconds >= lo && r.rest_seconds <= hi))
    add(
      `${fmt(p.restSeconds)} sec rest`,
      !bad,
      bad ? `“${bad.name}” rests ${bad.rest_seconds} s` : `every exercise rests ${fmt(p.restSeconds, " s")}`,
    )
  }
  if (p.tempo) {
    const want = normTempo(p.tempo)
    const bad = firstOutside((r) => (repsRange(r.reps) === null ? null : normTempo(r.tempo) === want))
    add(`${p.tempo} tempo`, !bad, bad ? `“${bad.name}” has ${bad.tempo ?? "no tempo"}` : `every exercise is ${p.tempo}`)
  }

  if (input.pool) {
    const used = new Set(input.rows.map((r) => r.exercise_id))
    const name = (id: string) => input.nameById[id] ?? id
    if (input.pool.mode === "strict") {
      const pool = new Set(input.pool.ids)
      const outside = input.rows.filter((r) => !pool.has(r.exercise_id))
      add(
        "Exercise Pool",
        outside.length === 0,
        outside.length === 0
          ? "every exercise is from your pool"
          : `not from your pool: ${outside.map((r) => r.name).join(", ")}`,
      )
    } else {
      const offered = input.pool.ids.filter((id) => input.pool!.offeredIds.includes(id))
      const unused = offered.filter((id) => !used.has(id))
      const allPool = input.rows.length > 0 && input.rows.every((r) => offered.includes(r.exercise_id))
      const met = unused.length === 0 || (input.rows.length < offered.length && allPool)
      add(
        "Exercise Pool",
        met,
        unused.length === 0
          ? `all ${offered.length} used`
          : met
            ? `every exercise is from your pool (${input.rows.length} of ${offered.length} fit)`
            : `not used: ${unused.map(name).join(", ")}`,
      )
    }
  }

  for (const m of input.namedMatches) {
    const hit = input.rows.find((r) => m.exercise_ids.includes(r.exercise_id))
    add(m.phrase, !!hit, hit ? `${hit.name} is in` : "not in the day")
  }
  if (input.bannedIds.length > 0) {
    const banned = new Set(input.bannedIds)
    const hit = input.rows.find((r) => banned.has(r.exercise_id))
    add("Exercises you ruled out", !hit, hit ? `${hit.name} is in` : "none used")
  }
  return items
}

export function checkStatus(items: InstructionCheckItem[]): InstructionCheck["status"] {
  if (items.length === 0) return "unchecked"
  return items.some((i) => !i.met) ? "failed" : "passed"
}

export function unmetCount(check: InstructionCheck): number {
  return check.items.filter((i) => !i.met).length
}

export function buildComplianceFeedback(items: InstructionCheckItem[]): string {
  const unmet = items.filter((i) => !i.met)
  if (unmet.length === 0) return ""
  return `PREVIOUS ATTEMPT MISSED THESE COACH INSTRUCTIONS — fix every one:\n${unmet
    .map((i) => `- ${i.instruction}: ${i.detail}`)
    .join("\n")}`
}

export function buildInstructionCheckWarning(check: InstructionCheck): string[] {
  const n = unmetCount(check)
  if (n === 0) return []
  return [
    n === 1
      ? "1 of your instructions wasn't fully met — see “Your instructions, checked”."
      : `${n} of your instructions weren't fully met — see “Your instructions, checked”.`,
  ]
}
