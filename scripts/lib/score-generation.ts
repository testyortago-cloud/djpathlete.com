/**
 * Scores the rows a generation saved, for before/after replay comparison
 * (2026-10-04 strict-prompts work). Deliberately its own regexes, not
 * functions/src/ai/note-guard.ts: a scorer that shares the fixer's patterns
 * cannot see the fixer's misses.
 */
const SPORT_RE =
  /\b(tennis|pickleball|padel|golf|soccer|football|basketball|lacrosse|baseball|softball|cricket|volleyball|hockey|rugby|swimming)\b/gi
const PRESCRIPTION_RE =
  /\b\d+\s*(?:sets?|reps?|repetitions?)\b|\b\d+\s*[x×]\s*\d+|\d\s*%|\bRPE\s*\d|\b\d+\s*(?:each|per)\s*(?:side|leg|arm)\b|\brest\b[^.!?]*\d/i

export interface GenerationScore {
  rows: number
  notes_foreign_sport: number
  notes_prescription: number
  samples: string[]
}

export function scoreRows(rows: Array<{ notes: string | null }>, athleteSport: string | null): GenerationScore {
  let foreign = 0
  let prescription = 0
  const samples: string[] = []
  for (const r of rows) {
    const note = r.notes ?? ""
    if (!note) continue
    const sports = [...note.replace(/tennis balls?/gi, "").matchAll(SPORT_RE)].map((m) => m[1].toLowerCase())
    const isForeign = sports.some((s) => s !== athleteSport)
    const isPrescription = PRESCRIPTION_RE.test(note)
    if (isForeign) foreign++
    if (isPrescription) prescription++
    if ((isForeign || isPrescription) && samples.length < 5) samples.push(note.slice(0, 160))
  }
  return { rows: rows.length, notes_foreign_sport: foreign, notes_prescription: prescription, samples }
}
