// lib/lead-engine/sms-segments.ts — how Twilio counts a message.
//
// Split out of lib/lead-engine/sms.ts, and the reason is a module boundary,
// not tidiness: the compose box (components/admin/sms/SmsComposer.tsx) counts
// segments on every keystroke, so it needs this function in the BROWSER
// bundle. `sms.ts` imports `lib/db/contact-consents` and `lib/db/sms-messages`,
// which reach `lib/supabase` and therefore `next/headers` — importing that
// chain from a "use client" component is a hard Next.js build error, and no
// amount of tree-shaking is guaranteed to save it.
//
// Pure, like lib/lead-engine/guardrails.ts: no database client, no project
// code, no environment. `sms.ts` re-exports `countSmsSegments` so every
// existing caller and its tests are unchanged.

/**
 * The GSM-7 default alphabet. A message composed only of these characters
 * is sent as 7-bit septets; anything else forces the whole message to
 * UCS-2. Kept as an explicit set rather than a regex range because the
 * alphabet is not contiguous in Unicode.
 */
const GSM7_BASE =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"

/**
 * Characters reachable in GSM-7 only via the escape sequence — each costs
 * TWO septets, not one. A message of 81 euro signs is two segments even
 * though it is 81 characters.
 */
const GSM7_EXTENDED = "^{}\\[~]|€"

const GSM7_BASE_SET = new Set(GSM7_BASE)
const GSM7_EXTENDED_SET = new Set(GSM7_EXTENDED)

/**
 * Counts a message the way Twilio bills it.
 *
 * Single-segment limits are 160 (GSM-7) and 70 (UCS-2). The moment a message
 * needs more than one segment, each part gives up room to a UDH concatenation
 * header: 153 septets, or 67 UTF-16 code units. `characters` is reported in
 * the unit the compose box should show — UTF-16 code units — so an emoji
 * counts as the two units it occupies on the wire.
 */
export function countSmsSegments(text: string): {
  characters: number
  segments: number
  encoding: "GSM-7" | "UCS-2"
  perSegment: number
} {
  const characters = text.length

  let isGsm7 = true
  let septets = 0
  for (const char of text) {
    if (GSM7_BASE_SET.has(char)) {
      septets += 1
    } else if (GSM7_EXTENDED_SET.has(char)) {
      septets += 2
    } else {
      isGsm7 = false
      break
    }
  }

  if (characters === 0) {
    return { characters: 0, segments: 0, encoding: "GSM-7", perSegment: 160 }
  }

  if (isGsm7) {
    if (septets <= 160) return { characters, segments: 1, encoding: "GSM-7", perSegment: 160 }
    return {
      characters,
      segments: Math.ceil(septets / 153),
      encoding: "GSM-7",
      perSegment: 153,
    }
  }

  // UCS-2 counts UTF-16 code units, which is what `text.length` already is.
  if (characters <= 70) return { characters, segments: 1, encoding: "UCS-2", perSegment: 70 }
  return {
    characters,
    segments: Math.ceil(characters / 67),
    encoding: "UCS-2",
    perSegment: 67,
  }
}
