/**
 * The last check before an exercise note reaches the athlete (2026-10-04).
 * Notes are cues only: prescription numbers live in their own fields, and a
 * note that restates them can only ever agree or contradict ("6 each side" on
 * reps "6" shipped). A sport the athlete does not play is a hallucination the
 * prompt's examples invited ("golf" cues for a tennis player, "tennis" in
 * programs with no client — both found in live rows).
 */

/** Split on sentence boundaries, keeping the terminator with its sentence. */
export function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text]
}

const PRESCRIPTION_RES: RegExp[] = [
  /\b\d+\s*(?:sets?|reps?|repetitions?)\b/i,
  /\b\d+\s*[x×]\s*\d+/i,
  /\brest\b[^.!?]*\d/i,
  /\d\s*%/,
  /\bRPE\s*\d/i,
  /\b\d+\s*(?:each|per)\s*(?:side|leg|arm)\b/i,
]

const SPORT_RE =
  /\b(tennis|pickleball|padel|golf|soccer|football|basketball|lacrosse|baseball|softball|cricket|volleyball|hockey|rugby|swimming)\b/gi

function namesForeignSport(sentence: string, athleteSport: string | null): boolean {
  const withoutEquipment = sentence.replace(/tennis balls?/gi, "")
  for (const m of withoutEquipment.matchAll(SPORT_RE)) {
    if (m[1].toLowerCase() !== athleteSport) return true
  }
  return false
}

export function cleanNote(
  note: string,
  opts: { athleteSport: string | null },
): { text: string | null; stripped: string[] } {
  const kept: string[] = []
  const stripped: string[] = []
  for (const sentence of splitSentences(note)) {
    const drop = PRESCRIPTION_RES.some((re) => re.test(sentence)) || namesForeignSport(sentence, opts.athleteSport)
    if (drop) stripped.push(sentence.trim())
    else kept.push(sentence)
  }
  if (stripped.length === 0) return { text: note, stripped }
  const text = kept
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim()
  return { text: text.length > 0 ? text : null, stripped }
}
