import { getSupabase } from "../lib/supabase.js"

// The client's previous program, so a new one follows on from it. Darren, 2026-10-30 (37:31), about what he
// had been typing into Additional instructions by hand: "acknowledge… the exercises that are done before,
// obviously not to replicate it, but to sort of show, like, Hey listen. In their previous program, there was a
// big focus on shoulder rehab".
//
// The section goes to the agents next to the coach instructions, never INTO them: the instructions are parsed
// for exercise names (extractInstructionIntent), and every old exercise would come back as a coach request.

export interface PreviousProgramExercise {
  week_number: number
  sets: number | null
  reps: string | null
  exercises: { name: string; movement_pattern: string | null } | null
}

export interface PreviousProgram {
  name: string
  description: string | null
  duration_weeks: number | null
  start_date: string
  status: string
  goals: string[]
  instructions: string | null
  exercises: PreviousProgramExercise[]
}

const MAX_EXERCISE_LINES = 40
const MAX_TEXT = 800

function clip(text: string | null | undefined): string | null {
  const t = text?.trim()
  if (!t) return null
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t
}

/**
 * The client's most recently started assignment. Null when there is none or the read fails: a missing history
 * must never fail a generation.
 */
export async function getPreviousProgramFromFn(clientId: string): Promise<PreviousProgram | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from("program_assignments")
    .select("program_id, start_date, status, programs(name, description, duration_weeks, ai_generation_params)")
    .eq("user_id", clientId)
    .order("start_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) {
    if (error) console.warn("[previous-program] assignment read failed:", error.message)
    return null
  }
  // A to-one embed: PostgREST returns one object, whatever the generated type says.
  const assignment = data as unknown as {
    program_id: string
    start_date: string
    status: string
    programs: Record<string, unknown> | null
  }
  const program = assignment.programs
  if (!program) return null

  const { data: rows, error: rowsError } = await supabase
    .from("program_exercises")
    .select("week_number, sets, reps, exercises(name, movement_pattern)")
    .eq("program_id", assignment.program_id)
  if (rowsError) console.warn("[previous-program] exercises read failed:", rowsError.message)

  const request = ((program.ai_generation_params as { request?: Record<string, unknown> } | null)?.request ?? {}) as {
    goals?: unknown
    additional_instructions?: unknown
  }
  return {
    name: String(program.name ?? "Untitled program"),
    description: (program.description as string | null) ?? null,
    duration_weeks: (program.duration_weeks as number | null) ?? null,
    start_date: assignment.start_date,
    status: assignment.status,
    goals: Array.isArray(request.goals) ? request.goals.filter((g): g is string => typeof g === "string") : [],
    instructions: typeof request.additional_instructions === "string" ? request.additional_instructions : null,
    exercises: (rows ?? []) as unknown as PreviousProgramExercise[],
  }
}

function weekRange(weeks: number[]): string {
  const lo = Math.min(...weeks)
  const hi = Math.max(...weeks)
  return lo === hi ? `week ${lo}` : `weeks ${lo}–${hi}`
}

/** The prompt section. Each exercise once: the weeks it ran and its prescription in the last of them. */
export function formatPreviousProgram(p: PreviousProgram): string {
  const byName = new Map<string, { pattern: string | null; weeks: number[]; last: PreviousProgramExercise }>()
  for (const row of p.exercises) {
    const name = row.exercises?.name
    if (!name) continue
    const entry = byName.get(name)
    if (!entry) {
      byName.set(name, { pattern: row.exercises?.movement_pattern ?? null, weeks: [row.week_number], last: row })
      continue
    }
    entry.weeks.push(row.week_number)
    if (row.week_number >= entry.last.week_number) entry.last = row
  }
  const ordered = [...byName.entries()].sort(
    (a, b) => new Set(b[1].weeks).size - new Set(a[1].weeks).size || a[0].localeCompare(b[0]),
  )
  const lines = ordered.slice(0, MAX_EXERCISE_LINES).map(([name, e]) => {
    const dose = e.last.sets && e.last.reps ? `, ${e.last.sets}×${e.last.reps}` : ""
    return `- ${name}${e.pattern ? ` (${e.pattern})` : ""}: ${weekRange(e.weeks)}${dose}`
  })
  if (ordered.length > MAX_EXERCISE_LINES) lines.push(`- …and ${ordered.length - MAX_EXERCISE_LINES} more`)

  const instructions = clip(p.instructions)
  const description = clip(p.description)
  return [
    "",
    "",
    "## Previous Program (the block this client did before)",
    `"${p.name}", started ${p.start_date}${p.duration_weeks ? `, ${p.duration_weeks} weeks` : ""}, status: ${p.status}.`,
    p.goals.length > 0 ? `Goals: ${p.goals.join(", ")}` : null,
    instructions ? `Coach's instructions for it: "${instructions}"` : null,
    description ? `Description: ${description}` : null,
    lines.length > 0 ? `Exercises it used (weeks they ran, last prescription):\n${lines.join("\n")}` : null,
    "",
    "The new program FOLLOWS ON from this block. Work out what it focused on (for example rehab or prehab work such as a shoulder focus, a strength phase, a return from injury) and carry that focus forward, progressed: a harder variation, more load or complexity, or the next phase. Do NOT copy its exercise list: choose new exercises or progressions that serve the same purpose. Staple exercises and exercises the coach names are the exception.",
  ]
    .filter((l): l is string => l !== null)
    .join("\n")
}
