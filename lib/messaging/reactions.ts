/**
 * Any single emoji is allowed as a reaction, but only an emoji — the picker is
 * open-ended, so the server is what stops arbitrary text being stored as one.
 */
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component})+$/u

export const MAX_REACTIONS_PER_USER = 6

export function isValidEmoji(value: string): boolean {
  if (!value || value.length > 16) return false
  // Digits, # and * carry Emoji_Component (they are the base of keycap
  // sequences) but on their own they read as text, not a reaction.
  if (/^[0-9#*]+$/.test(value)) return false
  return EMOJI_ONLY.test(value)
}
