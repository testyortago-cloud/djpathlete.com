/**
 * Whether a coach's instructions state how many EXERCISES to build — "12 exercises",
 * "HINGE BLOCK (3 exercises)", "2 power exercises" — as opposed to sets, reps, rest or
 * tempo numbers that merely sit near the word.
 *
 * The day architect is told to take its slot count from the coach whenever this is
 * true, and from the program's own history otherwise. Before 2026-10-01 it was told
 * the coach set the count whenever ANY instructions existed, so "2-4 sets" alone
 * produced a 2-slot day.
 *
 * Deliberately narrow: a number counts only when an exercise noun follows it on the
 * SAME line within a few words, and no unit word (sets, reps, per, …) comes between.
 * A miss falls back to history, which is the safe direction.
 */

const COUNT_NOUN = /^(exercises?|movements?|drills?)$/
const UNIT_WORDS = new Set([
  "set",
  "sets",
  "rep",
  "reps",
  "round",
  "rounds",
  "sec",
  "secs",
  "second",
  "seconds",
  "s",
  "min",
  "mins",
  "minute",
  "minutes",
  "rest",
  "tempo",
  "rpe",
  "per",
  "each",
  "x",
  "kg",
  "lb",
  "lbs",
  "between",
  "to",
  "of",
])
const MAX_WORDS_BETWEEN = 3

export function statesExerciseCount(instructions: string | undefined | null): boolean {
  if (!instructions) return false
  for (const line of instructions.split(/\r?\n/)) {
    // Words after each number (or range "10-12") on this line.
    const re = /\d+(?:\s*[-–—]\s*\d+)?/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      const words = line
        .slice(m.index + m[0].length)
        .toLowerCase()
        .split(/[^a-z0-9_-]+/)
        .filter(Boolean)
      for (let i = 0; i <= MAX_WORDS_BETWEEN && i < words.length; i++) {
        const w = words[i]
        if (COUNT_NOUN.test(w)) return true
        if (UNIT_WORDS.has(w) || /^\d/.test(w)) break
      }
    }
  }
  return false
}

const COUNT_LINE = /(\d+)(?!\s*[-–—]\s*\d)\s+(?:[a-z_-]+\s+){0,3}?(?:exercises?|movements?|drills?)\b/i

/**
 * The ONE total exercise count the coach stated, or null. A line that says
 * "total" wins; otherwise exactly one count line in the text is the total;
 * several per-area counts with no total line, or a range ("10-12"), are not a
 * single number and are left to the AI judge.
 */
export function statedExerciseTotal(text: string | null | undefined): number | null {
  if (!text) return null
  const counts: Array<{ n: number; total: boolean }> = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(COUNT_LINE)
    if (m && !/\d\s*[-–—]\s*\d+\s+(?:[a-z_-]+\s+){0,3}?(?:exercises?|movements?|drills?)/i.test(line)) {
      counts.push({ n: Number(m[1]), total: /\btotal\b/i.test(line) })
    }
  }
  const totals = counts.filter((c) => c.total)
  if (totals.length === 1) return totals[0].n
  if (counts.length === 1 && statesExerciseCount(text)) return counts[0].n
  return null
}

export interface CoachPrescription {
  sets?: [number, number]
  reps?: [number, number]
  restSeconds?: [number, number]
  tempo?: string
}

const RANGE = String.raw`(\d+)(?:\s*(?:-|–|—|to)\s*(\d+))?`

function oneRange(text: string, word: RegExp, patterns: RegExp[]): [number, number] | undefined {
  // Mentioned more than once → a second prescription exists; leave it to the AI.
  if ((text.match(word) ?? []).length !== 1) return undefined
  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      const unit = (m[3] ?? "").toLowerCase()
      const k = unit.startsWith("m") ? 60 : 1
      return [Number(m[1]) * k, Number(m[2] ?? m[1]) * k]
    }
  }
  return undefined
}

/**
 * The single sets / reps / rest / tempo prescription the coach wrote, per field.
 * A field the coach mentions more than once ("4-8 reps … Low reps (3-5)") is
 * omitted: that is two prescriptions for different work, and only the AI judge
 * can tell which exercise each applies to.
 */
export function parsePrescription(text: string | null | undefined): CoachPrescription {
  if (!text) return {}
  const out: CoachPrescription = {}
  const sets = oneRange(text, /\bsets?\b/gi, [new RegExp(String.raw`${RANGE}\s*sets?\b`, "i")])
  if (sets) out.sets = sets
  const reps = oneRange(text, /\breps?\b/gi, [new RegExp(String.raw`${RANGE}\s*reps?\b`, "i")])
  if (reps) out.reps = reps
  const rest = oneRange(text, /\brest\b/gi, [
    new RegExp(String.raw`${RANGE}\s*(sec|secs|seconds|s|min|mins|minutes)\b\s*(?:of\s+)?rest`, "i"),
    new RegExp(String.raw`rest\s*(?:of\s+|:\s*)?${RANGE}\s*(sec|secs|seconds|s|min|mins|minutes)\b`, "i"),
  ])
  if (rest) out.restSeconds = rest
  if ((text.match(/\btempo\b/gi) ?? []).length === 1) {
    const t = text.match(/(\d+(?:[-.]\d+){2,3})\s*tempo/i) ?? text.match(/tempo\s*[:\s]\s*(\d+(?:[-.]\d+){2,3})/i)
    if (t) out.tempo = t[1].replace(/\./g, "-")
  }
  return out
}
