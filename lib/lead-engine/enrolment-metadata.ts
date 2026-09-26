// lib/lead-engine/enrolment-metadata.ts — what a sequence run is allowed to
// remember about the event that enrolled it (G10).
//
// WHY THIS EXISTS. `source_is` reads the run's own sequence trigger, which is
// identical for everyone in that sequence, so nothing in the engine could
// tell a camp enquiry from a coaching enquiry, or a parent filling a form in
// from the athlete. This module is the narrow door through which a fact about
// the enrolling event reaches `sequence_runs.enrolment_metadata`, where
// `evaluateBranch`'s `enrolled_metadata_is` predicate can read it.
//
// PURE. No IO, no imports beyond types — `lib/automation/sequence-tick.ts`
// takes its `EnrolmentMetadataKey` from here and may import nothing that
// touches the database, the same rule lib/lead-engine/step-config.ts keeps.
//
// ---------------------------------------------------------------------------
// AN ALLOW-LIST OF KEYS IS THE FIRST GUARD, NOT THE ONLY ONE.
// ---------------------------------------------------------------------------
// The metadata bag `enrollIfTriggered` receives is, for a funnel submission,
// the visitor's ENTIRE typed payload: lib/funnels/capture-contact.ts passes
// `payload` straight through as `metadata`. Funnel field names are chosen by
// the owner and validated only as `^[a-z][a-z0-9_]{0,39}$` — so an owner CAN
// name a field `service` or `camp_name`, and a visitor can then type anything
// at all into it. Copying "only the allow-listed keys" would, on that path, copy
// whatever a stranger typed.
//
// So the value is guarded too: scalars only, trimmed, length-capped, and
// never something shaped like an email address or a phone number. When this
// was written nothing on production reached that path (0 funnel submissions,
// and no funnel field named after an allow-listed key) — the guard was in
// place before the path, which is the only order that works for a column that
// persists. G16 made it likelier: `sport` is also a funnel field ROLE
// (lib/funnels/islands.ts), so an owner may well name a field `sport`, and
// its answer then reaches runs, `{{sport}}` and branches through these guards.
//
// A dropped value is ABSENT, never truncated or redacted-in-place. An absent
// key makes `enrolled_metadata_is` false, which is a visible, correct "this
// person does not match"; half a value would match nothing either, while
// still carrying half of whatever it was.

/**
 * The keys a run may remember. Every one has a producer today:
 *
 *   service     — `app/api/inquiry/route.ts` (`in_person` | `online` |
 *                 `assessment` | `clinic` | `camp`, from the application form)
 *   role        — `app/api/funnels/submit/route.ts` (`parent` | `athlete`,
 *                 from the form's own declared field roles) and
 *                 `app/api/quiz/submit/route.ts` (from the quiz's router
 *                 question, and ONLY from a quiz that asks one — see
 *                 lib/quizzes/submitter-role.ts)
 *   event_kind  — the two event routes (`camp` | `clinic`, from `events.type`)
 *   camp_name   — the two event routes (`events.title`)
 *   quiz_key    — `app/api/quiz/submit/route.ts`
 *   branch      — `app/api/quiz/submit/route.ts` (the quiz's own parent /
 *                 athlete split rides here: `parent_coach` is a branch key)
 *   tier        — `app/api/quiz/submit/route.ts`
 *   sport       — `app/api/inquiry/route.ts` (G16, 2026-09-27): the
 *                 application form's optional "Sport / Activity" box. FREE
 *                 TEXT a stranger types ("Soccer", "CrossFit"), at most 100
 *                 characters by `inquiryFormSchema`. It takes the strict
 *                 digit rule below, and `enrolled_metadata_is` compares
 *                 ignoring case and spaces, so "Soccer" matches a coach's
 *                 "soccer". It is also the `{{sport}}` merge field. A
 *                 funnel form with a field named `sport` is a second
 *                 producer (lib/funnels/capture-contact.ts passes the whole
 *                 payload); the event routes collect a sport and do not
 *                 pass it.
 *
 * Adding a key here widens what a coach can branch on — see
 * `branchConditionSchema` (lib/validators/sequence-admin.ts), which takes its
 * enum from this same array, and the editor, which builds its dropdown from
 * `ENROLMENT_METADATA_KEY_LABEL`. Do not add one without a producer; a key
 * nothing writes is a branch that is false forever.
 */
export const ENROLMENT_METADATA_KEYS = [
  "service",
  "role",
  "event_kind",
  "branch",
  "tier",
  "quiz_key",
  "camp_name",
  // Last, so every run that already carries metadata serialises as before.
  "sport",
] as const

export type EnrolmentMetadataKey = (typeof ENROLMENT_METADATA_KEYS)[number]

/** What is actually stored on the run. Always strings — see `pickEnrolmentMetadata`. */
export type EnrolmentMetadata = Partial<Record<EnrolmentMetadataKey, string>>

/**
 * Long enough for a camp title, short enough that nothing resembling prose
 * (or a pasted note) can land in a column a branch compares with `=`.
 */
export const ENROLMENT_METADATA_MAX_VALUE_LENGTH = 120

const ALLOWED = new Set<string>(ENROLMENT_METADATA_KEYS)

/**
 * Anything with an `@` that has a dot after it. Deliberately loose: this is a
 * refusal test, not an address validator, and a false positive costs one
 * branch not matching while a false negative writes a stranger's email into a
 * table nothing redacts.
 */
const EMAIL_SHAPED = /\S@\S+\.\S/

/**
 * The punctuation people type into a phone number, removed before either
 * phone rule below runs, so `+61 412 345 678` and `(202) 555-0123` reduce to
 * the same digits.
 */
const PHONE_PUNCTUATION = /[\s()+.\-]/g

/** A long run of digits ANYWHERE — the strict rule. */
const CONTAINS_PHONE = /\d{7,}/

/** Nothing BUT digits — the loose rule, for the one key that is a free title. */
const IS_ONLY_A_PHONE = /^\d{7,}$/

/**
 * THE PHONE RULE IS PER KEY, because the keys are not the same kind of thing.
 *
 * Seven of the eight — `service`, `role`, `event_kind`, `branch`, `tier`,
 * `quiz_key` (machine-written enum-ish tokens: `camp`, `parent`, `in_person`,
 * `aspiring_pro`) and `sport` (a sport's name, typed by the applicant) — have
 * no legitimate value with seven consecutive digits in it, so those take the
 * STRICT rule: a long digit run anywhere is refused. That matters because an owner may name a funnel field `service`,
 * and a visitor may then type `camp - best on 0412 345 678 after 6pm` into
 * it. Under an all-digits rule that whole string, phone included, is stored.
 *
 * `camp_name` is the exception: it is a free-text title the owner wrote, and
 * "Summer Camp 2026-2027" reduces to a run of eight digits. It keeps the
 * LOOSE rule — refused only when it is nothing but a phone number. The
 * trade-off is deliberate and confined to the one key where a digit run is
 * ordinary.
 */
function looksLikeAnIdentifier(key: EnrolmentMetadataKey, value: string): boolean {
  if (EMAIL_SHAPED.test(value)) return true
  const digits = value.replace(PHONE_PUNCTUATION, "")
  return key === "camp_name" ? IS_ONLY_A_PHONE.test(digits) : CONTAINS_PHONE.test(digits)
}

/**
 * The allow-listed, value-checked subset of a contact event's metadata, as
 * strings.
 *
 * Numbers and booleans are stored as their string form so that
 * `enrolled_metadata_is` is ONE comparison rule rather than one per JSON type
 * — a coach types words into a text box, and `3` and `"3"` must not be
 * different answers to the same question.
 *
 * Keys come out in `ENROLMENT_METADATA_KEYS` order, not the caller's, so two
 * identical enrolments serialise identically.
 */
export function pickEnrolmentMetadata(metadata: Record<string, unknown> | null | undefined): EnrolmentMetadata {
  const picked: EnrolmentMetadata = {}
  if (!metadata) return picked

  for (const key of ENROLMENT_METADATA_KEYS) {
    // `Object.prototype.hasOwnProperty.call`, not `key in metadata`: a bag
    // parsed from JSON can carry a `__proto__` payload, and an inherited
    // match is not something the caller said.
    if (!Object.prototype.hasOwnProperty.call(metadata, key)) continue

    const raw = (metadata as Record<string, unknown>)[key]

    let asString: string
    if (typeof raw === "string") asString = raw
    else if (typeof raw === "number") {
      if (!Number.isFinite(raw)) continue
      asString = String(raw)
    } else if (typeof raw === "boolean") asString = String(raw)
    else continue // objects, arrays, null, undefined, functions, symbols

    const value = asString.trim()
    if (value.length === 0) continue
    if (value.length > ENROLMENT_METADATA_MAX_VALUE_LENGTH) continue
    if (looksLikeAnIdentifier(key, value)) continue

    picked[key] = value
  }

  return picked
}

/** Whether `key` is one a run may remember. Used by the step-list validator. */
export function isEnrolmentMetadataKey(key: unknown): key is EnrolmentMetadataKey {
  return typeof key === "string" && ALLOWED.has(key)
}
