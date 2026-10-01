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
