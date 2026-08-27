import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

export interface ExerciseBlock {
  id: string
  coach_id: string
  client_id: string | null
  exercise_id: string
  reason: string | null
  created_by: string
  created_at: string
}

export interface ExerciseBlockRow extends ExerciseBlock {
  exercises: { id: string; name: string; movement_pattern: string | null } | null
}

const BLOCK_SELECT = "id,coach_id,client_id,exercise_id,reason,created_by,created_at"
const ROW_SELECT = `${BLOCK_SELECT},exercises(id,name,movement_pattern)`

/**
 * Every exercise id blocked for this generation: the coach's studio-wide
 * blocks, plus this client's own.
 *
 * Returns an EMPTY SET on failure. A blocklist outage must degrade to the
 * pre-blocklist behaviour, never fail a generation — a coach waiting on a
 * generated day would rather have a day with one unwanted exercise than no day.
 */
export async function getBlockedExerciseIds(coachId: string, clientId: string | null): Promise<Set<string>> {
  const supabase = getClient()
  let query = supabase.from("exercise_blocks").select("exercise_id").eq("coach_id", coachId)
  query = clientId ? query.or(`client_id.is.null,client_id.eq.${clientId}`) : query.is("client_id", null)
  const { data, error } = await query
  if (error) {
    console.warn("[exercise-blocks] getBlockedExerciseIds failed:", error.message)
    return new Set()
  }
  return new Set((data ?? []).map((r: { exercise_id: string }) => r.exercise_id))
}

export async function listStudioBlocks(coachId: string): Promise<ExerciseBlockRow[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_blocks")
    .select(ROW_SELECT)
    .eq("coach_id", coachId)
    .is("client_id", null)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as ExerciseBlockRow[]
}

export async function listClientBlocks(coachId: string, clientId: string): Promise<ExerciseBlockRow[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_blocks")
    .select(ROW_SELECT)
    .eq("coach_id", coachId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as ExerciseBlockRow[]
}

export interface CreateExerciseBlockInput {
  coachId: string
  clientId: string | null
  exerciseId: string
  reason: string | null
  createdBy: string
}

/**
 * Idempotent by design. The block button is one click and a double press must
 * not read as an error, so an existing block is returned as-is rather than
 * conflicting. The two partial unique indexes make the race safe.
 */
export async function createExerciseBlock(input: CreateExerciseBlockInput): Promise<ExerciseBlock> {
  const supabase = getClient()
  const existingQuery = supabase
    .from("exercise_blocks")
    .select(BLOCK_SELECT)
    .eq("coach_id", input.coachId)
    .eq("exercise_id", input.exerciseId)
  const { data: existing } = await (input.clientId
    ? existingQuery.eq("client_id", input.clientId)
    : existingQuery.is("client_id", null)
  ).maybeSingle()
  if (existing) return existing as ExerciseBlock

  const { data, error } = await supabase
    .from("exercise_blocks")
    .insert({
      coach_id: input.coachId,
      client_id: input.clientId,
      exercise_id: input.exerciseId,
      reason: input.reason,
      created_by: input.createdBy,
    })
    .select(BLOCK_SELECT)
    .single()
  if (error) throw error
  return data as ExerciseBlock
}

/** Returns false when the id matched no row for this coach. */
export async function deleteExerciseBlock(coachId: string, id: string): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_blocks")
    .delete()
    .eq("coach_id", coachId)
    .eq("id", id)
    .select("id")
  if (error) throw error
  return (data ?? []).length > 0
}

/**
 * How many exercises would still be available in `movementPattern` if
 * `excludingExerciseId` were blocked for this scope. Zero means the block
 * starves the pattern, and the coach is warned before committing.
 *
 * `excludingExerciseId` is what makes this answerable BEFORE the write as well
 * as after it — after the write the id is already in the blocked set, so the
 * explicit exclusion is redundant but harmless.
 */
export async function countUsableInPattern(
  coachId: string,
  clientId: string | null,
  movementPattern: string,
  excludingExerciseId: string,
): Promise<number> {
  const supabase = getClient()
  const { data, error } = await supabase.from("exercises").select("id").eq("movement_pattern", movementPattern)
  if (error) throw error
  const blocked = await getBlockedExerciseIds(coachId, clientId)
  return (data ?? []).filter((e: { id: string }) => e.id !== excludingExerciseId && !blocked.has(e.id)).length
}
