/**
 * Decide whether a day's exercise notes are a single day-wide coaching cue
 * (e.g. "Rest 60s between every set") that should be shown once in the day
 * header instead of repeated on every card.
 *
 * A note only qualifies when EVERY exercise in the day carries the same text.
 * If one exercise has a note and the rest have none, that note belongs to that
 * exercise alone — hoisting it into the header presents one exercise's
 * instructions as if they applied to the whole session.
 */
export function resolveSharedNote(notes: (string | null | undefined)[]): string | null {
  // A one-exercise day has nothing to de-duplicate; its note stays on the card.
  if (notes.length < 2) return null
  const first = notes[0]?.trim()
  if (!first) return null
  return notes.every((n) => n?.trim() === first) ? first : null
}
