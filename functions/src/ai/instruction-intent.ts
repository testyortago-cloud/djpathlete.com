import { z } from "zod"
import type { CompressedExercise } from "./types.js"
import { CANONICAL_EQUIPMENT, normalizeEquipment } from "./validate.js"
import { callAgent, MODEL_HAIKU } from "./anthropic.js"

// ─── Types ──────────────────────────────────────────────────────────────────

export const instructionIntentSchema = z.object({
  required_equipment: z.array(z.string()),
  excluded_equipment: z.array(z.string()),
  named_exercises: z.array(z.string()),
  excluded_exercises: z.array(z.string()),
})

export type InstructionIntent = z.infer<typeof instructionIntentSchema>

export const EMPTY_INTENT: InstructionIntent = {
  required_equipment: [],
  excluded_equipment: [],
  named_exercises: [],
  excluded_exercises: [],
}

export interface IntentResolution {
  unlockedIds: Set<string>
  bannedIds: Set<string>
  matched: Array<{ phrase: string; exercise_ids: string[] }>
  unmatched: string[]
}

// ─── Name matching ──────────────────────────────────────────────────────────

const NAME_STOPWORDS = new Set(["the", "and", "for", "with", "your", "use", "using", "from", "into", "onto", "per"])

/**
 * Flatten a library name to comparable tokens. The library uses a "_Muscle"
 * suffix convention ("Push up_Chest") and occasional dashes
 * ("...disassociation-Core"); collapsing every non-alphanumeric run to a space
 * handles both without needing to guess where the suffix starts.
 */
export function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function significantTokens(phrase: string): string[] {
  return normalizeExerciseName(phrase)
    .split(" ")
    .filter((t) => t.length >= 3 && !NAME_STOPWORDS.has(t))
}

// ─── Resolution (pure) ──────────────────────────────────────────────────────

/**
 * Resolve a coach's named/excluded phrases to concrete exercise ids.
 *
 * A phrase matches an exercise when EVERY significant token of the phrase
 * appears in the exercise's normalized name. "bench press" therefore unlocks
 * "Bench Press", "Dumbbell Barrel bench press_chest" and "Iso bench press_chest"
 * — which is the intent: the coach asked for bench pressing, not one row.
 *
 * required_equipment is deliberately NOT resolved to ids here. It widens the
 * caller's available-equipment set instead, which composes with the existing
 * equipment filter and validator rather than duplicating their logic.
 */
export function resolveIntentToExerciseIds(
  intent: InstructionIntent,
  exercises: CompressedExercise[],
): IntentResolution {
  const tokensById = new Map<string, Set<string>>()
  for (const ex of exercises) {
    tokensById.set(ex.id, new Set(normalizeExerciseName(ex.name).split(" ")))
  }

  const unlockedIds = new Set<string>()
  const bannedIds = new Set<string>()
  const matched: Array<{ phrase: string; exercise_ids: string[] }> = []
  const unmatched: string[] = []

  const collect = (phrases: string[], sink: Set<string>, track: boolean) => {
    for (const phrase of phrases) {
      const tokens = significantTokens(phrase)
      if (tokens.length === 0) {
        if (track) unmatched.push(phrase)
        continue
      }
      const ids: string[] = []
      for (const ex of exercises) {
        const nameSet = tokensById.get(ex.id)
        if (!nameSet) continue
        if (tokens.every((t) => nameSet.has(t))) {
          ids.push(ex.id)
          sink.add(ex.id)
        }
      }
      if (!track) continue
      if (ids.length > 0) matched.push({ phrase, exercise_ids: ids })
      else unmatched.push(phrase)
    }
  }

  collect(intent.named_exercises, unlockedIds, true)
  collect(intent.excluded_exercises, bannedIds, false)

  const excludedEquipment = new Set(intent.excluded_equipment.map(normalizeEquipment))
  if (excludedEquipment.size > 0) {
    for (const ex of exercises) {
      if (ex.equipment_required?.some((eq) => excludedEquipment.has(normalizeEquipment(eq)))) {
        bannedIds.add(ex.id)
      }
    }
  }

  // An explicit ban always beats an unlock.
  for (const id of bannedIds) unlockedIds.delete(id)

  return { unlockedIds, bannedIds, matched, unmatched }
}

// ─── Deterministic fallback ─────────────────────────────────────────────────

/**
 * Words that flip the polarity of a request. When any appear, the deterministic
 * fallback refuses to guess: unlocking "barbell" out of "NO barbell back squats"
 * is worse than doing nothing, so it degrades to current behaviour instead.
 */
const NEGATION_TOKENS = [
  "no ",
  "not ",
  "non-",
  "avoid",
  "without",
  "exclude",
  "never",
  "minimi",
  "skip",
  "don't",
  "dont",
  "limit",
  "reduce",
  "less ",
]

export function fallbackIntent(instructions: string): InstructionIntent {
  const lower = instructions.toLowerCase()
  if (NEGATION_TOKENS.some((t) => lower.includes(t))) return EMPTY_INTENT

  const found = new Set<string>()
  for (const term of CANONICAL_EQUIPMENT) {
    const pattern = new RegExp(`\\b${term.replace(/_/g, "[ _]")}s?\\b`)
    if (pattern.test(lower)) found.add(term)
  }
  return { ...EMPTY_INTENT, required_equipment: [...found] }
}

// ─── Extraction ─────────────────────────────────────────────────────────────

const INSTRUCTION_INTENT_PROMPT = `You extract structured constraints from a strength coach's free-text program instructions. You do NOT design programs and you do NOT judge the instructions — you only report what the coach explicitly asked for.

Return four lists:

- required_equipment: equipment the coach explicitly wants used.
- excluded_equipment: equipment the coach explicitly wants avoided.
- named_exercises: specific exercises or exercise families the coach explicitly asked FOR. Use the coach's own words ("bench press", "Olympic lifts", "med ball throws"). Include a family name when the coach names a category rather than one lift.
- excluded_exercises: specific exercises or families the coach explicitly wants avoided.

POLARITY IS THE ENTIRE POINT. "No barbell back squats" means excluded, NOT required. "Minimize bilateral pressing" means excluded. "Avoid overhead work" means excluded. Read each clause's polarity before assigning it to a list. Getting this backwards is the single worst failure you can make.

Only report what is EXPLICITLY stated. Do not infer equipment from an exercise name (do NOT add "barbell" just because the coach said "bench press" — the exercise name alone is enough). Do not add exercises the coach did not mention. If the instructions describe only sets, reps, tempo, rest, periodization, or session ordering, return four empty lists.

Normalize equipment to this vocabulary where possible: ${CANONICAL_EQUIPMENT.join(", ")}.`

function normalizeIntent(raw: InstructionIntent): InstructionIntent {
  const clean = (list: string[]) => [...new Set((list ?? []).map((s) => s.trim()).filter(Boolean))]
  return {
    required_equipment: [...new Set(clean(raw.required_equipment).map(normalizeEquipment))],
    excluded_equipment: [...new Set(clean(raw.excluded_equipment).map(normalizeEquipment))],
    named_exercises: clean(raw.named_exercises),
    excluded_exercises: clean(raw.excluded_exercises),
  }
}

/**
 * Turn free-text coach instructions into structured overrides.
 *
 * Never throws and never blocks generation: an API failure degrades to the
 * deterministic fallback, which itself refuses to act on negated text.
 */
export async function extractInstructionIntent(
  instructions: string | undefined,
  opts?: { signal?: AbortSignal },
): Promise<InstructionIntent> {
  if (!instructions || instructions.trim().length === 0) return EMPTY_INTENT

  try {
    const result = await callAgent<InstructionIntent>(
      INSTRUCTION_INTENT_PROMPT,
      `Coach instructions:\n${instructions}`,
      instructionIntentSchema,
      { model: MODEL_HAIKU, maxTokens: 2000, signal: opts?.signal },
    )
    const intent = normalizeIntent(result.content)
    console.log(
      `[instruction-intent] extracted — require: [${intent.required_equipment.join(", ")}], ` +
        `exclude: [${intent.excluded_equipment.join(", ")}], ` +
        `named: ${intent.named_exercises.length}, excluded: ${intent.excluded_exercises.length}`,
    )
    return intent
  } catch (e) {
    console.warn(
      "[instruction-intent] extraction failed, using deterministic fallback:",
      e instanceof Error ? e.message : e,
    )
    return fallbackIntent(instructions)
  }
}
