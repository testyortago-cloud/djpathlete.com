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
// A limit right before the number: "at least 2", "max 3".
const LIMIT_BEFORE =
  /\b(?:at least|at most|max(?:imum)?|min(?:imum)?|no more than|up to|fewer than|less than|more than)\s*:?\s*$/i
// A selection FROM something: "pick 5 exercises from the pool". "Choose 12 exercises for a
// shoulder day" is the day's count, so the verb alone is not enough (I4).
const SELECT_BEFORE = /\b(?:pick|choose|select)\b[^\d]*$/i
const FROM_AFTER = /^\s*(?:from|of|out\s+of)\b/i
// "Choose from the pool: 5 exercises" — the selection is named before the count.
const FROM_IN_CLAUSE_BEFORE = /\bfrom\b[^,;.]*$/i
// "3 exercises per block" is a per-block count, not the day's; "per day/session/workout" is the day's.
const PER_AFTER = /^\s*per\b(?!\s+(?:training\s+)?(?:day|session|workout)\b)/i
// The ONLY lead-ins that leave a count as the day's total (Ruling 11). A deny-list of
// sub-count words ("add 2", "swap 2") kept missing real wording ("change 2", "plus 3",
// "also 2", "do 3 for upper back"), so the clause before the count must be empty or exactly
// one of these. Only statedExerciseTotal reads this; the architect directive does not.
const PLAIN_LEAD_IN = /^(?:choose|select|pick|i want|want|need|give me|aim for)?$/i
const SUBSET_BETWEEN = new Set(["more", "extra", "additional", "another"])
// "Pick 5 exercises, from the pool": a selection named after a comma.
const FROM_AFTER_BOUNDARY = /^\s*[,;:]\s*(?:from|of|out\s+of)\b/i
// Within a line, a clause starts after `,` `;` `:` or a full stop ("1. 12 …" splits too);
// a bullet or dash list marker in front of the count is stripped.
const CLAUSE_BOUNDARY = /[,;:.]/
const LIST_MARKER = /^\s*(?:[-–—•*·]|\d+\))?\s*/

interface CountMention {
  n: number
  isRange: boolean
  /** A number that is a limit, a selection or a per-block count, not a stated count. */
  rejected: boolean
  /** "total" is attached to this count: "N exercises total", "total of N", "total: N", "N total exercises". */
  total: boolean
  /** The count opens its clause, or follows only a plain lead-in ("choose", "I want") — see PLAIN_LEAD_IN. */
  standalone: boolean
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
        const after = line.slice(nounEnd)
        const between = words.slice(0, i).map((x) => x[0].toLowerCase())
        const leadIn = (before.split(CLAUSE_BOUNDARY).pop() ?? "").replace(LIST_MARKER, "").trim().replace(/\s+/g, " ")
        out.push({
          n: Number(m[2] ?? m[1]),
          isRange: m[2] !== undefined,
          rejected:
            LIMIT_BEFORE.test(before) ||
            (SELECT_BEFORE.test(before) && FROM_AFTER.test(after)) ||
            FROM_IN_CLAUSE_BEFORE.test(before) ||
            PER_AFTER.test(after),
          total:
            between.includes("total") || /^\s*[,(-]?\s*total\b/i.test(after) || /\btotal\s*(?:of|:)?\s*$/i.test(before),
          standalone:
            PLAIN_LEAD_IN.test(leadIn) &&
            !between.some((b) => SUBSET_BETWEEN.has(b)) &&
            !FROM_AFTER_BOUNDARY.test(after),
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
 * attached wins; otherwise exactly one count in the text is the total, and only
 * when the coach states it plainly: the count opens its clause or follows only
 * "choose", "I want", "need" and the like (PLAIN_LEAD_IN). "Add 2", "change 2",
 * "plus 3 for upper back" are sub-counts and get no line. Limits ("max 3"),
 * selections ("pick 5 from"), per-block counts, ranges ("10-12", "10 to 12") and
 * several per-area counts with no total are not a single number and are left to
 * the AI judge.
 *
 * A wrong number here shows the coach a red ✗ AND drives the rebuild with wrong
 * feedback; a missed one costs nothing, because the judge still reads the text.
 */
export function statedExerciseTotal(text: string | null | undefined): number | null {
  if (!text) return null
  const counts = allMentions(text).filter((c) => !c.rejected)
  const totals = counts.filter((c) => c.total && !c.isRange)
  if (totals.length === 1) return totals[0].n
  if (counts.length === 1 && !counts[0].isRange && counts[0].standalone) return counts[0].n
  return null
}

export interface CoachPrescription {
  sets?: [number, number]
  reps?: [number, number]
  restSeconds?: [number, number]
  tempo?: string
}

const RANGE = String.raw`(\d+)(?:\s*(?:-|–|—|to)\s*(\d+))?`
const TIME_UNIT = String.raw`(sec|secs|seconds|s|min|mins|minutes)`
// The only words allowed after a sets/reps value: "8 reps each side", "3 sets per side".
const TAIL = String.raw`(?:\s+(?:each(?:\s+side)?|per\s+(?:set|side)))?`
const TEMPO = String.raw`(\d+(?:[-.:]\d+){2,3})`
// A clause ends at a newline, `,`, `;`, or a full stop that is not between two digits
// ("4.2.4" and "1.5" stay whole; "1. 12 exercises" and "…reps. Rest 90 sec" split).
const CLAUSE_SPLIT = /\r?\n|[,;]|(?<!\d)\.|\.(?!\d)/
const LEADING_MARKER = /^[\s•*·–—-]+/

/**
 * The one clause that holds the field's word, matched WHOLE against `patterns`.
 * The field is left to the AI judge when the word appears more than once (a
 * second prescription) or when its clause holds anything but the value: a limit
 * ("max 4 sets", "up to 90 sec rest"), RIR / rep-max wording ("2 reps in
 * reserve", "3 rep max"), an addition ("add 1 set") or a scope ("on compounds",
 * "main lifts only"). Anchoring the whole clause rejects all of those at once.
 */
function fieldClause(text: string, word: RegExp, patterns: RegExp[]): RegExpMatchArray | undefined {
  if ((text.match(new RegExp(word.source, "gi")) ?? []).length !== 1) return undefined
  const clause = text
    .split(CLAUSE_SPLIT)
    .find((c) => word.test(c))
    ?.replace(LEADING_MARKER, "")
    .trim()
  if (!clause) return undefined
  for (const p of patterns) {
    const m = clause.match(p)
    if (m) return m
  }
  return undefined
}

function oneRange(text: string, word: RegExp, patterns: RegExp[]): [number, number] | undefined {
  const m = fieldClause(text, word, patterns)
  if (!m) return undefined
  const unit = (m[3] ?? "").toLowerCase()
  const k = unit.startsWith("m") ? 60 : 1
  return [Number(m[1]) * k, Number(m[2] ?? m[1]) * k]
}

const whole = (pattern: string) => new RegExp(`^${pattern}$`, "i")

/**
 * The single sets / reps / rest / tempo prescription the coach wrote, per field.
 * A field the coach mentions more than once ("4-8 reps … Low reps (3-5)") is
 * omitted: that is two prescriptions for different work, and only the AI judge
 * can tell which exercise each applies to. So is a field whose clause says
 * anything beyond the value (see fieldClause): a wrong exact line shows a red ✗
 * and drives the rebuild with wrong feedback, while a missed one costs nothing.
 */
export function parsePrescription(text: string | null | undefined): CoachPrescription {
  if (!text) return {}
  const out: CoachPrescription = {}
  const sets = oneRange(text, /\bsets?\b/i, [whole(String.raw`${RANGE}\s*sets?${TAIL}`)])
  if (sets) out.sets = sets
  const reps = oneRange(text, /\breps?\b/i, [whole(String.raw`${RANGE}\s*reps?${TAIL}`)])
  if (reps) out.reps = reps
  const rest = oneRange(text, /\brest\b/i, [
    whole(String.raw`${RANGE}\s*${TIME_UNIT}\s*(?:of\s+)?rest`),
    whole(String.raw`rest\s*(?:of\s+|:\s*)?${RANGE}\s*${TIME_UNIT}`),
  ])
  if (rest) out.restSeconds = rest
  const tempo = fieldClause(text, /\btempo\b/i, [
    whole(String.raw`${TEMPO}\s*tempo`),
    whole(String.raw`tempo\s*:?\s*${TEMPO}`),
  ])
  if (tempo) out.tempo = tempo[1].replace(/[.:]/g, "-")
  return out
}
