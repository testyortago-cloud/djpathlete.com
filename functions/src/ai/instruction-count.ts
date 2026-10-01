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

// A number or a range ("10-12", "10 to 12"). ONE pattern, shared by every reader below.
const NUMBER_OR_RANGE = /(\d+)(?:\s*(?:[-–—]|to)\s*(\d+))?/g
// A limit or a selection right before the number: "at least 2", "max 3", "pick the best 5".
const LIMIT_BEFORE =
  /\b(?:at least|at most|max(?:imum)?|min(?:imum)?|no more than|up to|fewer than|less than|more than)\s*:?\s*$|\b(?:pick|choose|select)\b[^\d]*$/i
// "3 exercises per block" is a per-block count, not the day's; "per day/session/workout" is the day's.
const PER_AFTER = /^\s*per\b(?!\s+(?:training\s+)?(?:day|session|workout)\b)/i

interface CountMention {
  n: number
  isRange: boolean
  /** A number that is a limit, a selection or a per-block count, not a stated count. */
  rejected: boolean
  /** "total" is attached to this count: "N exercises total", "total of N", "total: N", "N total exercises". */
  total: boolean
}

/** Every "<number> … <exercise noun>" on one line. */
function countMentions(line: string): CountMention[] {
  const out: CountMention[] = []
  const re = new RegExp(NUMBER_OR_RANGE.source, "gi")
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const afterNumber = m.index + m[0].length
    const words = [...line.slice(afterNumber).matchAll(/[a-z0-9_-]+/gi)]
    for (let i = 0; i <= MAX_WORDS_BETWEEN && i < words.length; i++) {
      const w = words[i][0].toLowerCase()
      if (COUNT_NOUN.test(w)) {
        const nounEnd = afterNumber + words[i].index! + w.length
        const before = line.slice(0, m.index)
        const between = words.slice(0, i).map((x) => x[0].toLowerCase())
        out.push({
          n: Number(m[2] ?? m[1]),
          isRange: m[2] !== undefined,
          rejected: LIMIT_BEFORE.test(before) || PER_AFTER.test(line.slice(nounEnd)),
          total:
            between.includes("total") ||
            /^\s*[,(-]?\s*total\b/i.test(line.slice(nounEnd)) ||
            /\btotal\s*(?:of|:)?\s*$/i.test(before),
        })
        break
      }
      if (UNIT_WORDS.has(w) || /^\d/.test(w)) break
    }
  }
  return out
}

function allMentions(text: string): CountMention[] {
  return text.split(/\r?\n/).flatMap(countMentions)
}

export function statesExerciseCount(instructions: string | undefined | null): boolean {
  if (!instructions) return false
  return allMentions(instructions).some((c) => !c.rejected)
}

/**
 * The ONE total exercise count the coach stated, or null. A count with "total"
 * attached wins; otherwise exactly one count in the text is the total. Limits
 * ("max 3"), selections ("pick 5 from"), per-block counts, ranges ("10-12",
 * "10 to 12") and several per-area counts with no total are not a single
 * number and are left to the AI judge.
 */
export function statedExerciseTotal(text: string | null | undefined): number | null {
  if (!text) return null
  const counts = allMentions(text).filter((c) => !c.rejected)
  const totals = counts.filter((c) => c.total && !c.isRange)
  if (totals.length === 1) return totals[0].n
  if (counts.length === 1 && !counts[0].isRange) return counts[0].n
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
