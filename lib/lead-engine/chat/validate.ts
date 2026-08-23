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

/**
 * Every unit a price can wear. WIDER THAN IT LOOKS ON PURPOSE — `dollars?|
 * bucks?|usd` alone let "two grand for the season", "£5 a session", "5 quid"
 * and "€5" through as prose, and a fabricated price that reaches the visitor
 * is the failure this whole layer exists to make impossible.
 *
 * `pounds` and `k` are the two knowingly over-broad entries: "8 pounds" is
 * probably a medicine ball and "5k" is probably a run. Both are still numbers
 * the assistant would be asserting without a source, so blocking them costs a
 * turn and protects a price — the direction this validator is required to err
 * in. `quid`, `grand` and `euros` are never anything but money.
 */
const CURRENCY_UNIT = "dollars?|bucks?|usd|quid|euros?|pounds?|grand|k"

/** Units that mean "times a thousand", so `1.2k` is compared as 1200, not 1.2. */
const THOUSAND_UNIT_RE = /^(?:k|grand)$/i

/** `$79`, `£79.00`, `€1,200`, `$1.2k` */
const CURRENCY_SYMBOL_RE = /[$£€]\s?(\d[\d,]*(?:\.\d{1,2})?)(?:\s*(k|grand)\b)?/gi

/** `79 dollars`, `1,200 USD`, `5 quid`, `1.2k` */
const CURRENCY_SUFFIX_RE = new RegExp(`(\\d[\\d,]*(?:\\.\\d{1,2})?)\\s*(${CURRENCY_UNIT})\\b`, "gi")

/** `two hundred dollars`, `seventy-nine dollars`, `two grand` */
const CURRENCY_WORDS_RE = new RegExp(
  `\\b((?:${WORD_ALTERNATION})(?:[\\s-]+(?:and[\\s-]+)?(?:${WORD_ALTERNATION}))*)[\\s-]+(${CURRENCY_UNIT})\\b`,
  "gi",
)

/**
 * The frame that makes a bare amount a price with no unit at all: "seventy-nine
 * A MONTH", "two hundred A MONTH", "150 PER SESSION". This is where a
 * fabricated figure hides once the units above are covered — a model quoting a
 * rate almost never repeats the currency.
 */
const PRICE_PERIOD =
  "(?:a|an|per|each|every)\\s+(?:month|week|session|class|day|year|hour|visit|athlete|kid|child|student|person|block|term|semester)"

/** `150 a month` */
const CURRENCY_PERIOD_NUM_RE = new RegExp(`(\\d[\\d,]*(?:\\.\\d{1,2})?)\\s+${PRICE_PERIOD}\\b`, "gi")

/** `seventy-nine a month`, `two hundred a month` */
const CURRENCY_PERIOD_WORDS_RE = new RegExp(
  `\\b((?:${WORD_ALTERNATION})(?:[\\s-]+(?:and[\\s-]+)?(?:${WORD_ALTERNATION}))*)\\s+${PRICE_PERIOD}\\b`,
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

/**
 * Month names that are ONLY month names. `may`, `march` and `mar` are held
 * back — "You may 3 or 4 sessions" and "Those 3 may be full" are not dates,
 * and reporting them as `ungrounded_date` discards a correct turn.
 *
 * Longest first, so `september` wins over `sep` and `march` over `mar`.
 */
const UNAMBIGUOUS_MONTHS = [
  "september",
  "february",
  "december",
  "november",
  "january",
  "october",
  "august",
  "april",
  "june",
  "july",
  "sept",
  "jan",
  "feb",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
].join("|")

/** The three that double as ordinary English words. */
const AMBIGUOUS_MONTHS = "march|may|mar"

/**
 * A REAL DAY, 1-31. `\d{1,2}` accepted "24/7" and "September 45"; a date
 * regex that matches things which cannot be dates spends its blocks on honest
 * turns and tells the operator nothing.
 */
const DAY = "(?:0?[1-9]|[12]\\d|3[01])"
const MONTH_NUM = "(?:0?[1-9]|1[0-2])"
const YEAR_TAIL = "(?:,?\\s+\\d{4})?"

/**
 * Words that announce a date is coming. They are what makes the year optional
 * for the shapes below: "starts 9/1" is a date, "6/7 days a week" is not, and
 * nothing but the surrounding words can tell them apart.
 *
 * `run` is deliberately absent — "Sessions run 6/7 days a week" is the exact
 * honest sentence this list must not swallow.
 */
const DATE_PREPOSITION = "on|starts?|starting|begins?|beginning|from|until|through"

const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g
const MONTH_FIRST_DATE_RE = new RegExp(
  `\\b(?:${UNAMBIGUOUS_MONTHS})\\.?\\s+${DAY}(?:st|nd|rd|th)?${YEAR_TAIL}\\b`,
  "gi",
)
const DAY_FIRST_DATE_RE = new RegExp(`\\b${DAY}(?:st|nd|rd|th)?\\s+(?:${UNAMBIGUOUS_MONTHS})\\.?${YEAR_TAIL}\\b`, "gi")

/** `May 3rd`, `May 3, 2026` — an ambiguous month carrying its own proof. */
const AMBIGUOUS_MONTH_SIGNAL_RE = new RegExp(
  `\\b(?:${AMBIGUOUS_MONTHS})\\.?\\s+${DAY}(?:(?:st|nd|rd|th)\\b|,?\\s+\\d{4}\\b)`,
  "gi",
)

/** `3rd May`, `3 May 2026` — the same, day first. */
const AMBIGUOUS_DAY_FIRST_SIGNAL_RE = new RegExp(
  `\\b${DAY}(?:(?:st|nd|rd|th)\\s+(?:${AMBIGUOUS_MONTHS})\\b|\\s+(?:${AMBIGUOUS_MONTHS})\\.?,?\\s+\\d{4}\\b)`,
  "gi",
)

/** `starts May 3`, `on May 3` — proof from the sentence instead. Group 1 is the date. */
const AMBIGUOUS_MONTH_PREP_RE = new RegExp(
  `\\b(?:${DATE_PREPOSITION})\\s+(?:the\\s+)?((?:${AMBIGUOUS_MONTHS})\\.?\\s+${DAY}(?:st|nd|rd|th)?${YEAR_TAIL})\\b`,
  "gi",
)

/**
 * `12/25/2026`. THE YEAR IS REQUIRED. Without it this pattern reported
 * "24/7", "6/7 days a week" and "1/8" as ungrounded dates — three correct
 * sentences thrown away, and three blocked turns in a count the spec calls a
 * real operational signal.
 */
const NUMERIC_DATE_RE = new RegExp(`\\b${MONTH_NUM}\\/${DAY}\\/(?:\\d{4}|\\d{2})\\b`, "g")

/** `starts 9/1`, `on 12/25` — a year-less numeric date the sentence vouches for. Group 1 is the date. */
const NUMERIC_DATE_PREP_RE = new RegExp(
  `\\b(?:${DATE_PREPOSITION})\\s+(?:the\\s+)?(${MONTH_NUM}\\/${DAY})\\b(?!\\/|\\s*(?:days?|hours?|weeks?|months?|years?)\\b)`,
  "gi",
)

/**
 * Fixed idioms that contain digits and assert nothing. "24/7" means "always";
 * it is not a claim about a number, and blocking "We are open 24/7" costs an
 * honest answer for no honesty gained. Stripped before any rule runs.
 */
const NON_CLAIM_IDIOM_RE = /\b24\s?[/-]\s?7\b/g

/** Ordinal suffixes and the abbreviation dot are spelling, not value. */
function normaliseDate(raw: string): string {
  return normalise(raw.replace(/(\d)(?:st|nd|rd|th)\b/gi, "$1").replace(/\./g, ""))
}

// ---------------------------------------------------------------------------
// Numerals
// ---------------------------------------------------------------------------

const BARE_NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g

/**
 * The tail that turns a number into a percentage. THE SIGN IS ONLY ONE OF ITS
 * SPELLINGS: the spec's amendment is written as a property of percentages, and
 * matching `%` alone implemented it as a property of one character — "5
 * percent", "5 per cent" and "five percent" all walked past it into the
 * SMALL_NUMBER_CEILING waiver the amendment exists to close.
 */
const PERCENT_TAIL = "(?:%|percent(?:age)?\\b|per\\s?cent\\b|pct\\b)"

/**
 * A numeral carrying a percentage. Extracted before bare numerals so it is
 * never waived by SMALL_NUMBER_CEILING — see the reasoning at step 3 of
 * validateReply().
 */
const PERCENT_RE = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*${PERCENT_TAIL}`, "gi")

/** `five percent` — the same claim, spelled out. */
const PERCENT_WORDS_RE = new RegExp(
  `\\b((?:${WORD_ALTERNATION})(?:[\\s-]+(?:and[\\s-]+)?(?:${WORD_ALTERNATION}))*)\\s*${PERCENT_TAIL}`,
  "gi",
)

// ---------------------------------------------------------------------------
// Prose rules
// ---------------------------------------------------------------------------

/**
 * Who the claim is about. A PROMISED OUTCOME DOES NOT NEED THE WORD "you":
 * "Our athletes typically add 4 inches to their vertical" is the same
 * unevidenced promise as "you will add 4 inches", and the second-person-only
 * patterns waved every third-person spelling of it straight through.
 */
const OUTCOME_SUBJECT =
  "(?:(?:our|most|many|all|every|these|some|the|other)\\s+)*(?:athletes?|players?|clients?|students?|kids?|children|teams?|guys|girls)"

/**
 * Up to four words between the subject and the verb, so "athletes WHO FINISH
 * HAVE added" and "our athletes TYPICALLY add" are reached. Letters only —
 * the gap must not step over the number the claim is about.
 */
const OUTCOME_GAP = "(?:\\s+[a-z'’-]+){0,4}"

/**
 * Verbs that can only be describing a result. `get`, `see` and `make` are NOT
 * here, for the reason the second-person list already records: they carry
 * ordinary operational sentences ("you will get an email confirmation"). They
 * are handled below, where the OBJECT is what makes the sentence a claim.
 *
 * `drop`, `hit`, `build` and `reach` are also left out of the third-person
 * list: "kids drop off at the front door" and "athletes build a routine" are
 * ordinary prose, and third person has no "you will" to disambiguate them.
 */
const OUTCOME_VERBS =
  "add(?:s|ed)?|gain(?:s|ed)?|improv(?:e|es|ed)|increas(?:e|es|ed)|develop(?:s|ed)?|achiev(?:e|es|ed)|master(?:s|ed)?|shav(?:e|es|ed)|jump(?:s|ed)?|los(?:e|es)|lost"

/** Nouns that make an otherwise ordinary verb a claim about results. */
const GAINS_NOUN = "gains?|results?|improvements?|progress|increases?|breakthroughs?|personal\\s+bests?|prs?"

/** Verbs that are claims only in front of a gains noun. */
const SOFT_OUTCOME_VERBS =
  "see|sees|saw|get|gets|got|make|makes|made|experience|experiences|notice|notices|noticed|report|reports|reported"

/**
 * Superlatives about the business itself. `only` is deliberately absent — "we
 * are the only approved provider" is a checkable fact, not a boast.
 */
const SUPERLATIVE =
  "best|cheapest|fastest|strongest|greatest|top|leading|premier|number\\s+one|#\\s?1|most\\s+(?:effective|affordable|advanced|trusted|experienced|qualified)|unmatched|unrivall?ed"

const PROMISED_OUTCOME_PATTERNS: RegExp[] = [
  /\bguarantee(?:s|d|ing)?\b/i,
  /\b(?:i|we)\s+promise\b/i,
  /\bpromise\s+you\b/i,
  // Outcome verbs only. Deliberately NOT "you will get" / "you will see" —
  // those carry ordinary operational sentences ("you will get an email"), and
  // a validator that blocks those blocks the whole turn for nothing.
  /\byou(?:'ll|\s+will|\s+are\s+going\s+to)\s+(?:gain|add|improve|increase|develop|become|achieve|reach|hit|master|build|lose|drop)\b/i,
  /\byou(?:'ll|\s+will)\s+make\s+the\s+(?:team|roster|squad|varsity|lineup)\b/i,
  // Third person, plain outcome verb.
  new RegExp(`\\b${OUTCOME_SUBJECT}\\b${OUTCOME_GAP}\\s+(?:${OUTCOME_VERBS})\\b`, "i"),
  // Third person, ordinary verb but a gains noun for an object. This is what
  // catches "most athletes see big gains" without costing "athletes often
  // enjoy the programme" or "you will get an email confirmation".
  new RegExp(
    `\\b${OUTCOME_SUBJECT}\\b${OUTCOME_GAP}\\s+(?:${SOFT_OUTCOME_VERBS})\\s+(?:[a-z'’-]+\\s+){0,2}(?:${GAINS_NOUN})\\b`,
    "i",
  ),
  // Second person, same shape: "you will get RESULTS" is a promise, "you will
  // get an email confirmation" is a sentence.
  new RegExp(
    `\\byou(?:'ll|’ll|\\s+will|\\s+are\\s+going\\s+to|\\s+can\\s+expect\\s+to)?\\s+(?:see|get|make|experience|notice)\\s+(?:[a-z'’-]+\\s+){0,2}(?:${GAINS_NOUN})\\b`,
    "i",
  ),
  // "We're the best gym in the region" — a superlative about the business is a
  // claim nothing in the database can support.
  new RegExp(`\\b(?:we(?:'re|’re)?|our\\s+[a-z]+)\\s*(?:are|is|have|has)?\\s+(?:the\\s+)?(?:${SUPERLATIVE})\\b`, "i"),
  // "We're cheaper than every other academy." Scoped to a first-person subject
  // so an honest comparison between the business's OWN two options — "online
  // coaching is cheaper than in-person" — is still sayable.
  /\b(?:we|our)\b[^.!?]{0,40}?\b(?:cheaper|better|faster|stronger|safer|more\s+(?:effective|affordable|advanced)|less\s+expensive)\s+than\b/i,
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
 * `1.2k` and `two grand` are 1200 and 2000. Compared unscaled they would be
 * checked against 1.2 and 2 — numbers small enough to be waived, which is how
 * "two grand for the season" read as ordinary prose.
 */
function applyThousands(cleaned: string, unit: string | undefined): string {
  if (!unit || !THOUSAND_UNIT_RE.test(unit.trim())) return cleaned
  const value = Number(cleaned)
  return Number.isFinite(value) ? String(value * 1000) : cleaned
}

/**
 * Reports every claim in `text` that `grounded` does not support.
 *
 * @param text     the complete assistant turn, exactly as it would be shown
 * @param grounded every value the retrieval tools returned this conversation,
 *                 in every form a model might write it (see facts.ts)
 * @param visitorNumbers numerals the VISITOR typed in this conversation, from
 *                 `visitorNumerals()` in facts.ts. They satisfy the bare-numeral
 *                 rule ONLY — echoing back "my son is 14" is not a fabrication,
 *                 but a visitor cannot supply a price or a date.
 * @returns `[]` for a clean reply. Any non-empty result blocks the turn.
 */
export function validateReply(text: string, grounded: string[], visitorNumbers: string[] = []): Violation[] {
  const groundedSet = new Set(grounded.map(normalise))
  // THE VISITOR'S OWN NUMERALS REACH STEP 5 AND NOTHING ELSE. They are never
  // added to `groundedSet`, because a value in that set grounds prices, dates
  // and percentages alike — and a visitor who types "I heard it's $500" must
  // not thereby make $500 a grounded answer to "so how much is it?". A visitor
  // can supply their child's age; they cannot supply your prices.
  const visitorSet = new Set(visitorNumbers.map(normalise))
  const violations: Violation[] = []

  // 0. Fixed idioms that carry digits but assert nothing.
  let remaining = text.replace(NON_CLAIM_IDIOM_RE, " ")

  // 1. Currency FIRST, and each match is removed from the text. A price is a
  //    price whatever its magnitude — SMALL_NUMBER_CEILING never sees it.
  const onAmount = (cleaned: string) => {
    if (!moneyForms(cleaned).some((form) => groundedSet.has(normalise(form)))) {
      violations.push({ rule: "ungrounded_price", found: cleaned })
    }
  }
  const onWordAmount = (m: RegExpMatchArray) => {
    const value = parseWordNumber(m[1])
    if (value !== null) onAmount(applyThousands(String(value), m[2]))
  }
  remaining = stripMatches(remaining, CURRENCY_SYMBOL_RE, (m) => onAmount(applyThousands(normalise(m[1]), m[2])))
  remaining = stripMatches(remaining, CURRENCY_SUFFIX_RE, (m) => onAmount(applyThousands(normalise(m[1]), m[2])))
  remaining = stripMatches(remaining, CURRENCY_WORDS_RE, onWordAmount)
  // The unit-less shapes last, so "$79 a month" is one price and not two.
  remaining = stripMatches(remaining, CURRENCY_PERIOD_NUM_RE, (m) => onAmount(normalise(m[1])))
  remaining = stripMatches(remaining, CURRENCY_PERIOD_WORDS_RE, onWordAmount)

  // 2. Dates next, also removed, so "September 1" does not leave a stray "1".
  //    Group 1 where the pattern needed surrounding words as proof, so the
  //    reported value is the date and not the preposition in front of it.
  const onDate = (raw: string) => {
    const cleaned = normaliseDate(raw)
    if (!groundedSet.has(cleaned)) {
      violations.push({ rule: "ungrounded_date", found: cleaned })
    }
  }
  const DATE_PATTERNS: RegExp[] = [
    ISO_DATE_RE,
    MONTH_FIRST_DATE_RE,
    DAY_FIRST_DATE_RE,
    AMBIGUOUS_MONTH_SIGNAL_RE,
    AMBIGUOUS_DAY_FIRST_SIGNAL_RE,
    AMBIGUOUS_MONTH_PREP_RE,
    NUMERIC_DATE_RE,
    NUMERIC_DATE_PREP_RE,
  ]
  for (const re of DATE_PATTERNS) {
    remaining = stripMatches(remaining, re, (m) => onDate(m[1] ?? m[0]))
  }

  // 3. Percentages, removed like currency and for the same reason: the
  //    SMALL_NUMBER_CEILING below exists so ordinary prose counts ("2 things
  //    worth knowing") are possible, and a percentage is NEVER that. Nobody
  //    writes "there are 3% things to know" — a percentage is always a claim,
  //    so it is checked at every magnitude. Without this, "athletes get 5%
  //    faster" is waived by the ceiling and slips past the promised-outcome
  //    patterns too, because "get" is deliberately not one of their verbs.
  //
  //    The word forms are checked here too. The spec's amendment is a property
  //    of PERCENTAGES; matching only the `%` character made it a property of
  //    one character, and "5 percent" walked past it.
  const onPercent = (cleaned: string) => {
    if (!groundedSet.has(cleaned)) {
      violations.push({ rule: "ungrounded_number", found: cleaned })
    }
  }
  remaining = stripMatches(remaining, PERCENT_RE, (m) => onPercent(normalise(m[1])))
  remaining = stripMatches(remaining, PERCENT_WORDS_RE, (m) => {
    const value = parseWordNumber(m[1])
    if (value !== null) onPercent(String(value))
  })

  // 4. Whatever numerals are left are ordinary numbers — the ONE rule the
  //    visitor's own numerals are allowed to satisfy.
  for (const match of remaining.matchAll(BARE_NUMBER_RE)) {
    const cleaned = normalise(match[0])
    if (groundedSet.has(cleaned) || visitorSet.has(cleaned)) continue
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
