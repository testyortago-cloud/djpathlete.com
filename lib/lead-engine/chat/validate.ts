// lib/lead-engine/chat/validate.ts — Layer 3 of the honesty stack.
// Spec: docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md §4.3
//
// A PURE function: no imports, no I/O, no model, no clock. It takes the
// complete assistant turn and the list of values the retrieval tools actually
// returned during this conversation, and reports every claim the reply makes
// that the database did not supply.
//
// The caller discards the WHOLE turn on any non-empty result and replaces it
// with the fixed refusal. It does not retry: a retry that happens to succeed
// hides that the model attempted to fabricate, and the count of blocked turns
// is a real operational signal.
//
// No brand names anywhere in this directory, comments included — it is swept
// by __tests__/lib/lead-engine/no-brand-literals.test.ts.

export type Violation =
  | { rule: "ungrounded_price"; found: string }
  | { rule: "ungrounded_date"; found: string }
  | { rule: "ungrounded_number"; found: string }
  | { rule: "promised_outcome"; found: string }
  | { rule: "injury_advice"; found: string }

/**
 * Bare numerals at or below this are allowed even when nothing in the fact set
 * grounds them, because ordinary prose needs small counts ("a couple of
 * options", "3 things worth knowing") and the assistant would otherwise be
 * unable to form a sentence.
 *
 * This CANNOT leak a price. A price claim is currency-shaped — "$5", "5
 * dollars", "five dollars" — and currency is extracted first, by its own rule,
 * which has no magnitude allowlist at all. By the time this ceiling is
 * consulted every currency span has already been checked and removed from the
 * text. So "$5" is checked; a bare "5" is waived.
 */
export const SMALL_NUMBER_CEILING = 10

/**
 * The twin of the facts layer's normalise(). Deliberately duplicated rather
 * than imported: this module is pure by construction and importing the facts
 * layer would drag a Supabase client into a function that must never do I/O.
 * Both sides of every comparison run through it, so the validator compares
 * like with like.
 */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[$,]/g, "").replace(/\s+/g, " ").trim()
}

// ---------------------------------------------------------------------------
// Word numbers — CURRENCY ONLY, 0-9999
// ---------------------------------------------------------------------------
// "two hundred dollars" is where fabrication actually shows up, so currency
// gets a word form. This is NOT a general word-to-number parser and must not
// grow into one: bare word counts ("a couple", "three sessions") are prose,
// not claims, and nobody needs them parsed.

const WORD_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
}

// Longest first, so "seventy" wins over "seven" inside "seventy-nine".
const WORD_ALTERNATION = Object.keys(WORD_NUMBERS)
  .sort((a, b) => b.length - a.length)
  .join("|")

const CURRENCY_UNIT = "dollars?|bucks?|usd"

/** `$79`, `$79.00`, `$1,200` */
const CURRENCY_SYMBOL_RE = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g

/** `79 dollars`, `1,200 USD` */
const CURRENCY_SUFFIX_RE = new RegExp(`(\\d[\\d,]*(?:\\.\\d{1,2})?)\\s*(?:${CURRENCY_UNIT})\\b`, "gi")

/** `two hundred dollars`, `seventy-nine dollars` */
const CURRENCY_WORDS_RE = new RegExp(
  `\\b((?:${WORD_ALTERNATION})(?:[\\s-]+(?:and[\\s-]+)?(?:${WORD_ALTERNATION}))*)[\\s-]+(?:${CURRENCY_UNIT})\\b`,
  "gi",
)

/** Returns null when the run is not a number this parser covers. */
function parseWordNumber(run: string): number | null {
  const tokens = normalise(run)
    .split(/[\s-]+/)
    .filter(Boolean)
  if (tokens.length === 0) return null
  let total = 0
  let current = 0
  for (const token of tokens) {
    if (token === "and") continue
    const value = WORD_NUMBERS[token]
    if (value === undefined) return null
    if (token === "hundred") current = (current || 1) * 100
    else if (token === "thousand") {
      total += (current || 1) * 1000
      current = 0
    } else current += value
  }
  return total + current
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "august",
  "september",
  "october",
  "november",
  "december",
  "june",
  "july",
  "sept",
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
].join("|")

const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g
const MONTH_FIRST_DATE_RE = new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi")
const DAY_FIRST_DATE_RE = new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?(?:,?\\s+\\d{4})?\\b`, "gi")
const NUMERIC_DATE_RE = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g

/** Ordinal suffixes and the abbreviation dot are spelling, not value. */
function normaliseDate(raw: string): string {
  return normalise(raw.replace(/(\d)(?:st|nd|rd|th)\b/gi, "$1").replace(/\./g, ""))
}

// ---------------------------------------------------------------------------
// Numerals
// ---------------------------------------------------------------------------

const BARE_NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g

// ---------------------------------------------------------------------------
// Prose rules
// ---------------------------------------------------------------------------

const PROMISED_OUTCOME_PATTERNS: RegExp[] = [
  /\bguarantee(?:s|d|ing)?\b/i,
  /\b(?:i|we)\s+promise\b/i,
  /\bpromise\s+you\b/i,
  // Outcome verbs only. Deliberately NOT "you will get" / "you will see" —
  // those carry ordinary operational sentences ("you will get an email"), and
  // a validator that blocks those blocks the whole turn for nothing.
  /\byou(?:'ll|\s+will|\s+are\s+going\s+to)\s+(?:gain|add|improve|increase|develop|become|achieve|reach|hit|master|build|lose|drop)\b/i,
  /\byou(?:'ll|\s+will)\s+make\s+the\s+(?:team|roster|squad|varsity|lineup)\b/i,
]

/**
 * Residual injury detector, defence in depth behind the input classifier
 * (§4.4). The classifier stops these questions before the model is called at
 * all; this is the second line for the ones it misses.
 */
const INJURY_TERMS_RE =
  /\b(?:injur(?:y|ies|ed)|strain(?:ed|s)?|sprain(?:ed|s)?|tear|torn|tendonitis|tendinitis|tendinopathy|acl|ucl|mcl|rotator\s+cuff|labrum|fracture|concussion|inflammation|swelling|sore(?:ness)?|pain(?:ful)?|ach(?:e|es|ing)|rehab(?:ilitation)?|physio(?:therapy)?|surgery|impingement)\b/i

/** Treatment instruction — a violation only alongside an injury term. */
const TREATMENT_ADVICE_PATTERNS: RegExp[] = [
  /\b(?:ice|icing|heat|compress|elevate|foam[-\s]roll|massage|tape|brace|stretch|strengthen)\s+(?:it|them|that|those|your|the)\b/i,
  /\b(?:rest|lay\s+off|stay\s+off)\s+(?:it|them|that|for|until|your|the)\b/i,
  /\byou\s+(?:should|need\s+to|ought\s+to|have\s+to|could)\s+(?:ice|heat|rest|stretch|strengthen|treat|rehab|mobilise|mobilize)\b/i,
]

/** Diagnosis or medication — a violation on its own, no injury term needed. */
const MEDICAL_CLAIM_PATTERNS: RegExp[] = [
  /\b(?:take|use|try)\s+(?:ibuprofen|advil|tylenol|painkillers?|anti[-\s]inflammator(?:y|ies)|nsaids?)\b/i,
  /\b(?:sounds\s+like|you(?:'ve|\s+have)(?:\s+probably|\s+likely)?|that(?:'s|\s+is)(?:\s+probably|\s+likely)?)\s+(?:a\s+|an\s+)?(?:strain|sprain|torn|tear|tendonitis|tendinitis|fracture|acl|concussion)\b/i,
  /\brice\s+protocol\b/i,
  /\b(?:diagnos(?:e|es|is|ing)|prescrib(?:e|es|ing))\b/i,
]

// ---------------------------------------------------------------------------

/**
 * Runs `re` over `text`, hands every match to `onMatch`, and returns the text
 * with those spans replaced by a space. Removing the span is what stops one
 * claim being reported twice — a currency match must not survive to be
 * re-extracted as a bare numeral.
 */
function stripMatches(text: string, re: RegExp, onMatch: (match: RegExpMatchArray) => void): string {
  let out = ""
  let cursor = 0
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0
    onMatch(match)
    out += text.slice(cursor, start) + " "
    cursor = start + match[0].length
  }
  return out + text.slice(cursor)
}

/** Every written form of an amount that means the same money. */
function moneyForms(cleaned: string): string[] {
  const forms = [cleaned]
  const value = Number(cleaned)
  if (Number.isFinite(value)) {
    forms.push(String(value), value.toFixed(2))
  }
  return forms
}

/**
 * Reports every claim in `text` that `grounded` does not support.
 *
 * @param text     the complete assistant turn, exactly as it would be shown
 * @param grounded every value the retrieval tools returned this conversation,
 *                 in every form a model might write it (see facts.ts)
 * @returns `[]` for a clean reply. Any non-empty result blocks the turn.
 */
export function validateReply(text: string, grounded: string[]): Violation[] {
  const groundedSet = new Set(grounded.map(normalise))
  const violations: Violation[] = []
  let remaining = text

  // 1. Currency FIRST, and each match is removed from the text. A price is a
  //    price whatever its magnitude — SMALL_NUMBER_CEILING never sees it.
  const onAmount = (cleaned: string) => {
    if (!moneyForms(cleaned).some((form) => groundedSet.has(normalise(form)))) {
      violations.push({ rule: "ungrounded_price", found: cleaned })
    }
  }
  remaining = stripMatches(remaining, CURRENCY_SYMBOL_RE, (m) => onAmount(normalise(m[1])))
  remaining = stripMatches(remaining, CURRENCY_SUFFIX_RE, (m) => onAmount(normalise(m[1])))
  remaining = stripMatches(remaining, CURRENCY_WORDS_RE, (m) => {
    const value = parseWordNumber(m[1])
    if (value !== null) onAmount(String(value))
  })

  // 2. Dates next, also removed, so "September 1" does not leave a stray "1".
  const onDate = (raw: string) => {
    const cleaned = normaliseDate(raw)
    if (!groundedSet.has(cleaned)) {
      violations.push({ rule: "ungrounded_date", found: cleaned })
    }
  }
  for (const re of [ISO_DATE_RE, MONTH_FIRST_DATE_RE, DAY_FIRST_DATE_RE, NUMERIC_DATE_RE]) {
    remaining = stripMatches(remaining, re, (m) => onDate(m[0]))
  }

  // 3. Whatever numerals are left are ordinary numbers.
  for (const match of remaining.matchAll(BARE_NUMBER_RE)) {
    const cleaned = normalise(match[0])
    if (groundedSet.has(cleaned)) continue
    const value = Number(cleaned)
    if (Number.isFinite(value) && value <= SMALL_NUMBER_CEILING) continue
    violations.push({ rule: "ungrounded_number", found: cleaned })
  }

  // 4. Prose rules read the ORIGINAL text — stripping spans above was only
  //    ever about not double-counting a numeric claim.
  for (const re of PROMISED_OUTCOME_PATTERNS) {
    const match = text.match(re)
    if (match) violations.push({ rule: "promised_outcome", found: match[0].trim() })
  }

  const mentionsInjury = INJURY_TERMS_RE.test(text)
  for (const re of TREATMENT_ADVICE_PATTERNS) {
    if (!mentionsInjury) break
    const match = text.match(re)
    if (match) violations.push({ rule: "injury_advice", found: match[0].trim() })
  }
  for (const re of MEDICAL_CLAIM_PATTERNS) {
    const match = text.match(re)
    if (match) violations.push({ rule: "injury_advice", found: match[0].trim() })
  }

  const seen = new Set<string>()
  return violations.filter((v) => {
    const key = `${v.rule}::${v.found}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
