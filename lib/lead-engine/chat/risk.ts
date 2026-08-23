// Layer 4 of the chat assistant's honesty design: injury and medical questions
// never reach the model.
//
// Spec: docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md §4.4
//
// This runs BEFORE the model call. On anything other than "none" the route
// short-circuits to a fixed refusal, persists verdict='short_circuit', and never
// calls the model at all. That is the whole point: this is deliberately not a
// prompt instruction and not an output filter, because a model that is never
// asked cannot answer. The output-side injury detector in validate.ts stays as a
// second line, because this classifier can miss.
//
// A pure module. It imports nothing — not a database client, not a settings
// read — which is why its tests need no mocks.
//
// TWO FAILURE DIRECTIONS, BOTH REAL:
//   1. Missing an injury question sends a medical query to a model. Forbidden.
//   2. Answering "injury" to everything makes the assistant useless, and only
//      the second test block would ever notice.
// The two-signal rule below is what holds direction 2: a body-part or condition
// term on its own is not enough unless the term is unambiguous, so "my son is
// 14, is he old enough?" — advice framing, no condition term — stays "none".
//
// WRITE FOR THE SENTENCE SOMEBODY ACTUALLY TYPES. A review of indirect
// phrasings found 23 of 27 classified "none", and the misses were all one of
// three things, each of which is now a named mechanism below:
//   * a body part the lists never held — plain "back" above all, the commonest
//     complaint in sport, present only as "lower back" / "upper back";
//   * a symptom named in the wrong tense — the lists held "popped" and
//     "tweaked", and `inflect` cannot walk a word backwards, so "popping" and
//     "tweak" both missed. The lists name LEMMAS now and the helper conjugates;
//   * a question about a child. Every advice framing was first person — "can i
//     still", "should i take" — and this audience is parents, who write "can he
//     still" and "should he be taking". `forEverySubject` expands them.

export type Risk = "injury" | "medical" | "none"

const VOWELS = new Set(["a", "e", "i", "o", "u"])

function escapeRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * The written forms of one lemma, so a list can name "pop" once and match
 * pops / popped / popping.
 *
 * THIS REPLACED A TRAILING `(?:s|es|ed|ing)?`, WHICH WAS THE BUG. That suffix
 * was appended to whatever the list held, so a list written in the past tense
 * — "popped", "tweaked", "twisted" — matched only the past tense and gained
 * "poppeds" and "tweakeding" for its trouble. English needs three rules to do
 * this properly and all three earn their place here: consonant doubling is the
 * only way "pop" can reach "popping", the silent e is the only way "niggle"
 * reaches "niggling", and y→ies is the only way "surgery" reaches "surgeries".
 *
 * Nothing here needs to be a real word. A form that English does not use
 * ("kneing") is a branch of an alternation that no message will ever contain;
 * a form that IS used and is missing is a question that reaches the model.
 */
function inflect(word: string): string[] {
  const forms = new Set<string>([word])

  // Already inflected, and left alone. "swelling", "bruised" and "swollen" are
  // only ever written one way, and conjugating them again is exactly the
  // mistake this helper exists to stop.
  if (/(?:ed|ing)$/.test(word)) {
    forms.add(`${word}s`)
    return [...forms]
  }

  const last = word.slice(-1)
  const prev = word.slice(-2, -1)
  const prev2 = word.slice(-3, -2)

  if (last === "e") {
    // niggle → niggles / niggled / niggling
    forms.add(`${word}s`)
    forms.add(`${word}d`)
    forms.add(`${word.slice(0, -1)}ing`)
  } else if (last === "y" && !VOWELS.has(prev)) {
    // surgery → surgeries, and "surgerying" is never typed but costs nothing
    forms.add(`${word.slice(0, -1)}ies`)
    forms.add(`${word.slice(0, -1)}ied`)
    forms.add(`${word}ing`)
  } else {
    forms.add(`${word}s`)
    forms.add(`${word}ed`)
    forms.add(`${word}ing`)
    if (/(?:s|x|z|ch|sh)$/.test(word)) forms.add(`${word}es`)
    // Consonant doubling — pop → popping, op → opped. A single vowel between
    // two consonants at the end of the word is the whole rule.
    if (!VOWELS.has(last) && VOWELS.has(prev) && !VOWELS.has(prev2) && !"wxy".includes(last)) {
      forms.add(`${word}${last}ed`)
      forms.add(`${word}${last}ing`)
    }
  }

  return [...forms]
}

/**
 * Words of a phrase may be separated by spaces or hyphens ("return-to-play"),
 * and only the LAST word is conjugated: "shin splint" must reach "shin
 * splints" without inventing "shins splint".
 */
function phrasePattern(term: string): string {
  const words = term.trim().split(/\s+/)
  const head = words.slice(0, -1).map(escapeRegex)
  const tail = `(?:${inflect(words[words.length - 1])
    .map(escapeRegex)
    .join("|")})`
  return [...head, tail].join("[\\s-]+")
}

/**
 * Word-boundary matching, always. Substring matching would classify "is there a
 * camp in September?" as medical (it contains "pt"), "do your coaches work with
 * kids?" as injury (it contains "aches"), and "training" as a strain. Every list
 * below is compiled through here for that reason.
 */
function matcher(terms: readonly string[]): RegExp {
  return new RegExp(`\\b(?:${terms.map(phrasePattern).join("|")})\\b`, "i")
}

/**
 * Whose question it is.
 *
 * The framings below were written entirely in the first person, and this
 * audience is parents: they ask about a child. "should he be taking creatine"
 * and "can he still train" were both "none" until this existed.
 */
const SUBJECTS = ["i", "we", "he", "she", "they", "my son", "my daughter", "my kid", "my child"] as const

function forEverySubject(...templates: readonly string[]): string[] {
  return templates.flatMap((template) => SUBJECTS.map((who) => template.replace("{who}", who)))
}

/**
 * Terms that mean an injury on their own — no second signal required, because
 * there is no innocent reading. "I tore my ACL" is an injury statement whether
 * or not the visitor remembered to ask a question about it.
 */
const INJURY_ALONE = matcher([
  // Named structures that only come up when something is wrong with them.
  "acl",
  "mcl",
  "pcl",
  "ucl",
  "meniscus",
  "labrum",
  "labral",
  "rotator cuff",
  "tommy john",
  "growth plate",
  "osgood schlatter",
  "achilles",
  // Named conditions and mechanisms.
  "concussion",
  "concussed",
  "sprain",
  "strain",
  "tear",
  "torn",
  "rupture",
  "fracture",
  "broken bone",
  "dislocated",
  "dislocation",
  "subluxation",
  "tendonitis",
  "tendinitis",
  "tendinopathy",
  "bursitis",
  "shin splint",
  "plantar fasciitis",
  "herniated",
  "herniation",
  "sciatica",
  "whiplash",
  "impingement",
  // Treatment and clinical-pathway language.
  "surgery",
  "surgical",
  "post op",
  "postop",
  // "op" and "operation" are how a parent says surgery — "after my op", "he had
  // an operation in March" — and both were missing, so both of those sentences
  // reached the model.
  "op",
  "operation",
  "physio",
  "physiotherapy",
  "physical therapy",
  // "PT" is the abbreviation a parent actually types. Word-boundary matching is
  // what keeps it out of "September" and "captain".
  "pt",
  "rehab",
  "rehabilitation",
  "return to sport",
  "return to play",
  "return to throwing",
  // Plain statements of being hurt.
  "injured",
  "injury",
  "injuries",
  "hurt my",
  "hurt myself",
  "in pain",
  "limp",
])

/**
 * A blow to the head, which gets its own pattern rather than a pairing.
 *
 * A suspected concussion is the one question here where a wrong answer is
 * measured in something other than money, and a parent describes it as a
 * mechanism, not a diagnosis: "he took a knock to the head", "she banged her
 * head". Any of these verbs within three words of "head" is enough.
 *
 * `\bhead\b` and not `head\w*`, deliberately: "heading the ball" and "heads up"
 * must not fire, and "hit the ball with his head" stays out because "his" is a
 * fourth word.
 */
const HEAD_IMPACT = /\b(?:knock|bang|bump|blow|hit|whack|clash|collide|collision)\w*(?:\W+\w+){0,3}\W+head\b/i

/**
 * Body parts and soft condition words. Real but ambiguous: "shoulder" appears in
 * "shoulder mobility work" as often as in "my shoulder is done for". These need
 * a symptom or an advice framing beside them.
 *
 * Deliberately NOT here: "muscle" and "joint". "How do I build muscle?" and
 * "how do I improve joint mobility?" are the two most ordinary training
 * questions a performance business is asked, and either would have been swept
 * up as an injury question. "head" is not here either — "the head coach" would
 * have become an injury question the moment anyone asked whether their son
 * could still meet him. `HEAD_IMPACT` above covers the case that matters.
 *
 * "back" is not here because it needs its own rule; see `BACK`.
 */
const CONDITION_TERM = matcher([
  "shoulder",
  "knee",
  "elbow",
  "ankle",
  "wrist",
  "hamstring",
  "quad",
  "quadricep",
  "calf",
  "groin",
  "hip",
  "shin",
  "heel",
  "neck",
  "spine",
  "oblique",
  "forearm",
  "bicep",
  "tricep",
  "hip flexor",
  "tendon",
  "ligament",
  "rib",
  "collarbone",
])

/**
 * "back" — the commonest complaint in sport, and the most overloaded word in
 * the language.
 *
 * Bare, it is "come back next week", "back to school", "back in September",
 * "I'll get back to you" and "my back squat". So it is a body part here only
 * when a possessive or a complaint adjective puts a body in front of it, and
 * never when a time, a place or an exercise follows it. It subsumes the "lower
 * back" / "upper back" entries the condition list used to carry, which between
 * them matched almost nobody: people write "my back".
 *
 * The possessive is a named relation and not `\w+'s`, because "'s" after a
 * pronoun is nearly always "is" — "he's back and can he still train?" is a
 * child returning from holiday.
 */
const BACK =
  /\b(?:my|his|her|their|our|your|bad|sore|stiff|tight|lower|upper|mid|(?:son|daughter|kid|child|boy|girl)'s)[\s-]+back\b(?!\s+(?:to|in|on|at|from|next|last|for|before|after|squat|extension|handspring|flip|lever|row))/i

/**
 * The second signal: a symptom, or a framing that asks permission or treatment.
 *
 * The advice phrases are deliberately narrow. A bare "how do I…" would have made
 * "how do I improve shoulder mobility?" an injury question; every phrase here
 * presupposes that something is already wrong.
 *
 * Two words that belong here and are NOT here, both for the same reason — the
 * innocent sense is a coaching term this business uses every day:
 *   * "catch". "he catches for his baseball team" beside "shoulder" would fire
 *     on every catcher's parent.
 *   * "roll", in the present tense. "ankle rolls" and "shoulder rolls" are
 *     warm-up drills. The past tense "rolled" is the injury, and is listed.
 */
const SYMPTOM_OR_ADVICE = matcher([
  // Symptoms, named as lemmas so every tense matches.
  "hurt",
  "pain",
  "painful",
  "sore",
  "soreness",
  "ache",
  "swell",
  "swollen",
  "puffy",
  "inflamed",
  "inflammation",
  "stiff",
  "stiffness",
  "throb",
  "bruise",
  "numb",
  "numbness",
  "tightness",
  "tender",
  "tenderness",
  "spasm",
  "cramp",
  "tweak",
  "pop",
  "twist",
  "click",
  "grind",
  "lock",
  "niggle",
  "rolled",
  "flare up",
  "acting up",
  "killing me",
  // Something that will not hold its own weight — the way a parent describes a
  // joint they should be seeing somebody about.
  "unstable",
  "instability",
  "gives way",
  "gave way",
  "giving way",
  "gives out",
  "gave out",
  "buckle",
  // It is still going on, which is the sentence a coach must not answer.
  "bothers",
  "bothering",
  // Permission and treatment framings, in every person — a parent writes "can
  // he still train", never "can I still train".
  ...forEverySubject(
    "can {who} still",
    "should {who} still",
    "when can {who}",
    "can {who} train",
    "can {who} play",
    "should {who} train",
    "should {who} play",
    "should {who} rest",
    "should {who} ice",
    "what should {who} do",
    "what do {who} do",
    "how do {who} fix",
    "how do {who} treat",
  ),
  "can i train with",
  "can i play with",
  "is it ok to",
  "is it okay to",
  "is it safe to",
  "safe to train",
  "safe to play",
  "how long until",
  "how long before",
  // "heal" covers heals/healed/healing, and word boundaries keep it out of
  // "healthy". "recovery" is deliberately NOT here — recovery days and recovery
  // between sets are ordinary training talk.
  "heal",
])

/**
 * Medical on its own: medication, diagnosis, clearance, and the named conditions
 * a coach must never advise on.
 */
const MEDICAL_ALONE = matcher([
  // Medication.
  "medication",
  "medicine",
  "meds",
  "ibuprofen",
  "advil",
  "tylenol",
  "paracetamol",
  "naproxen",
  "aleve",
  "painkiller",
  "pain killer",
  "nsaid",
  "prescription",
  "prescribed",
  "antibiotic",
  "cortisone",
  "steroid",
  "anabolic",
  "testosterone",
  "hgh",
  "peptide",
  // Diagnosis.
  "diagnose",
  "diagnosed",
  "diagnosis",
  "symptom",
  // Clearance — the question that most looks like an administrative one and is
  // not: only a clinician can answer it.
  "see a doctor",
  "medically cleared",
  "medical clearance",
  "cleared to play",
  "cleared to train",
  "cleared to return",
  // Conditions.
  "asthma",
  "diabetes",
  "diabetic",
  "epilepsy",
  "seizure",
  "heart condition",
  "heart murmur",
  "blood pressure",
  "eating disorder",
  "anorexia",
  "bulimia",
  "pregnant",
  "pregnancy",
  "allergic",
  "allergy",
  "anaphylaxis",
  "chest pain",
  "dizzy",
  "dizziness",
  "fainted",
  "fainting",
  "passed out",
  // "my kid gets headaches after heading the ball" is a concussion question
  // wearing everyday clothes, and it was reaching the model. "headache" is
  // whole-word, so "coaches" is untouched.
  "headache",
  "migraine",
  "nausea",
  "nauseous",
  "vomit",
  "blurred vision",
  "blacked out",
])

/** Clinicians and investigations — ambiguous alone, medical beside a symptom. */
const MEDICAL_TERM = matcher([
  "doctor",
  "physician",
  "orthopedic",
  "orthopaedic",
  "orthopedist",
  "chiropractor",
  "mri",
  "x ray",
  "xray",
  "ultrasound",
  "blood test",
])

/**
 * Supplements are medical only when the question is about taking them — dosing,
 * safety, side effects. "Do you cover nutrition?" is a sales question.
 */
const SUPPLEMENT_TERM = matcher([
  "supplement",
  "creatine",
  "protein powder",
  "bcaa",
  "pre workout",
  "preworkout",
  "caffeine",
  "melatonin",
  "collagen",
  "multivitamin",
  "vitamin",
  "fish oil",
  "whey",
])

/**
 * The other half of the supplement pair. It exists for exactly one question —
 * "should he be taking creatine at 13?" — which was returning "none" because
 * every framing in it was first person and none of them was the verb.
 */
const DOSING_FRAMING = matcher([
  "how much",
  "how many",
  "how often",
  "dosage",
  "dose",
  "mg",
  "milligram",
  "gram",
  "scoop",
  // The verb, in every tense and person. Harmless without a supplement term
  // beside it: "do you take walk-ins?" names no supplement.
  "take",
  "took",
  "give",
  "gave",
  "safe",
  "too much",
  "too young",
  "side effect",
])

/**
 * Phrases removed before matching, because each holds a risk word in a sense
 * that has nothing to do with anybody's body. Removing the phrase rather than
 * special-casing the match keeps every exception in one place: "I want injury
 * prevention for my sore shoulder" still classifies, on shoulder + sore.
 */
const INNOCENT_PHRASES: readonly RegExp[] = [
  // A service this business sells, not a question about someone's injury.
  /\binjury[\s-]+prevention\b/gi,
  // A dance style, not a joint. Without this, "my daughter does hip hop, can
  // she train with you?" is an injury question.
  /\bhip[\s-]?hop\b/gi,
  // A warm-up, not a rolled ankle.
  /\bfoam[\s-]+roll\w*\b/gi,
  // A hyphen is a word boundary, so "op" — a parent's word for surgery — finds
  // one in the middle of "co-op". "pre-op" is left alone deliberately: that one
  // really is surgery.
  /\bco[\s-]?op\b/gi,
]

function normalise(message: string): string {
  let text = message.toLowerCase().replace(/[‘’]/g, "'")
  for (const phrase of INNOCENT_PHRASES) text = text.replace(phrase, " ")
  return text.replace(/\s+/g, " ").trim()
}

/**
 * Classify a visitor's message before it reaches the model.
 *
 * `injury` and `medical` both short-circuit the turn; the distinction is kept
 * because the two are worth counting separately when reviewing transcripts.
 */
export function classifyRisk(message: string): Risk {
  const text = normalise(message)
  if (!text) return "none"

  const framed = SYMPTOM_OR_ADVICE.test(text)

  // Medical is checked first: "should I take ibuprofen for my sore knee?" is
  // both, and the medication half is the more dangerous question.
  if (MEDICAL_ALONE.test(text)) return "medical"
  if (MEDICAL_TERM.test(text) && framed) return "medical"
  if (SUPPLEMENT_TERM.test(text) && DOSING_FRAMING.test(text)) return "medical"

  if (INJURY_ALONE.test(text) || HEAD_IMPACT.test(text)) return "injury"
  if ((CONDITION_TERM.test(text) || BACK.test(text)) && framed) return "injury"

  return "none"
}

/**
 * Classify a turn, which is not the same thing as classifying a message.
 *
 * "I have a question about my knee." is not an injury question. "It hurts when
 * I squat." is not one either — it names no body part, only a pronoun. Sent one
 * after the other they are the injury question this whole layer exists to stop,
 * and the model gets the first one back as history when it answers the second.
 * Reading them as a pair is the only thing that catches it.
 *
 * ONLY the message immediately before, and only a visitor's own words. Pasting
 * the whole transcript in front of every message would short-circuit a
 * conversation permanently the moment anybody mentioned a knee, which is the
 * failure direction that makes the assistant useless. One turn of memory is the
 * smallest window that closes the split-question hole.
 *
 * It is not free, and the price is worth naming: the turn straight after an
 * injury question is read with that question still beside it, so "ok, how much
 * is coaching?" can be refused once more. That is the deliberate direction —
 * the alternative is a model that answers "so what should I do about it?" with
 * the injury sitting in its history — and it lasts exactly one turn.
 */
export function classifyTurn(message: string, precedingUserMessage?: string | null): Risk {
  const direct = classifyRisk(message)
  if (direct !== "none") return direct

  const preceding = precedingUserMessage?.trim()
  if (!preceding) return "none"

  return classifyRisk(`${preceding} ${message}`)
}
