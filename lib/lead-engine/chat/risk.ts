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

export type Risk = "injury" | "medical" | "none"

/**
 * Trailing inflections we accept on the last word of a term, so the lists can
 * name the lemma once: sprain/sprains/sprained/spraining.
 */
const INFLECTION = "(?:s|es|ed|ing)?"

function escapeRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Words of a phrase may be separated by spaces or hyphens ("return-to-play"). */
function phrasePattern(term: string): string {
  return term.trim().split(/\s+/).map(escapeRegex).join("[\\s-]+")
}

/**
 * Word-boundary matching, always. Substring matching would classify "is there a
 * camp in September?" as medical (it contains "pt"), "do your coaches work with
 * kids?" as injury (it contains "aches"), and "training" as a strain. Every list
 * below is compiled through here for that reason.
 */
function matcher(terms: readonly string[]): RegExp {
  return new RegExp(`\\b(?:${terms.map((t) => phrasePattern(t) + INFLECTION).join("|")})\\b`, "i")
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
  "surgeries",
  "surgical",
  "post op",
  "postop",
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
  "limping",
])

/**
 * Body parts and soft condition words. Real but ambiguous: "shoulder" appears in
 * "shoulder mobility work" as often as in "my shoulder is done for". These need
 * a symptom or an advice framing beside them.
 *
 * Deliberately NOT here: "muscle" and "joint". "How do I build muscle?" and
 * "how do I improve joint mobility?" are the two most ordinary training
 * questions a performance business is asked, and either would have been swept
 * up as an injury question.
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
  "lower back",
  "upper back",
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
 * The second signal: a symptom, or a framing that asks permission or treatment.
 *
 * The advice phrases are deliberately narrow. A bare "how do I…" would have made
 * "how do I improve shoulder mobility?" an injury question; every phrase here
 * presupposes that something is already wrong.
 */
const SYMPTOM_OR_ADVICE = matcher([
  // Symptoms.
  "hurt",
  "hurts",
  "pain",
  "painful",
  "sore",
  "soreness",
  "ache",
  "aching",
  "swollen",
  "swelling",
  "stiffness",
  "throbbing",
  "bruised",
  "bruising",
  "numb",
  "numbness",
  "tightness",
  "tweaked",
  "popped",
  "twisted",
  "flare up",
  // Permission and treatment framings.
  "what should i do",
  "what do i do",
  "is it ok to",
  "is it okay to",
  "is it safe to",
  "can i still",
  "should i still",
  "when can i",
  "when can he",
  "when can she",
  "when can they",
  "how long until",
  "how long before",
  "can i train with",
  "can i play with",
  "how do i fix",
  "how do i treat",
  "should i rest",
  "should i ice",
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
  "should i take",
  "safe to take",
  "can i take",
  "is it safe",
  "side effect",
])

/**
 * "Injury prevention" is a service a performance business sells, not a question
 * about someone's injury, so the bare word "injury" is not allowed to fire on
 * it. Removing the phrase (rather than special-casing the match) keeps the
 * exception to one place: "I want injury prevention for my sore shoulder" still
 * classifies, on shoulder + sore.
 */
const SERVICE_PHRASES = /\binjury[\s-]+prevention\b/gi

function normalise(message: string): string {
  return message.toLowerCase().replace(/[‘’]/g, "'").replace(SERVICE_PHRASES, " ").replace(/\s+/g, " ").trim()
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

  if (INJURY_ALONE.test(text)) return "injury"
  if (CONDITION_TERM.test(text) && framed) return "injury"

  return "none"
}
