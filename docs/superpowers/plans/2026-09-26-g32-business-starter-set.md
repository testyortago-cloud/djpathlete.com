# G32 — Business Starter Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every business, new or existing, has the three pipeline boards and eleven draft starter sequences, provisioned inside `create_business()` by one SQL helper and backfilled by the same migration.

**Architecture:** Migration `00279` adds three plpgsql functions: `seed_starter_board`, `seed_starter_sequence`, and `seed_business_starter_set`, which calls the other two once per board or sequence. Each board and sequence is one dollar-quoted JSON literal. `create_business()` is replaced with the same signature and calls the helper, and a backfill loop runs it for every business. Each insert is keyed on absence. Tests parse the migration and hold it to the app's own step, merge-field, text and brand rules. A live block then proves it on the dev clone.

**Tech Stack:** Postgres plpgsql (Supabase), Vitest, TypeScript, @supabase/supabase-js.

**Spec:** `docs/superpowers/specs/2026-09-26-g32-business-starter-set-design.md` (read it first).

## Global Constraints

- Worktree: `/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/worktrees/g32-business-starter-set`, branch `worktree-g32-business-starter-set`. Run everything from there. ONE plain command per Bash call (the worktree guard rejects heredocs, `&&` chains with `cd`, and inline `python -c`); put throwaway scripts in the session scratchpad `/private/tmp/claude-501/-Users-aeangabrielletayawa-Desktop-Darren-Paul-Projects-djpathlete/c1232610-26b7-4eff-ae58-674f6aabead1/scratchpad/g32/`.
- Node 24: prefix every node/npx/npm command with `PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH"`.
- NEVER `git stash` in any form (the stash is shared with other sessions). To prove a test red, write the test before the code; to prove a mutant red, plant it with an edit, run, and restore it with an edit, then `git diff` to confirm the restore.
- Stage exact files only (`git add <path>`), never `-A` / `.`. Commit messages: conventional prefix, a "why" body, and NO `Co-Authored-By`, no "Claude", no "Generated with" anywhere.
- Database: the dev clone `anjvztjiokcgiyhobknq` only. NEVER production (`epzuvzkokzqtzomeyoha`, the `supabase-prod` tools). Do not apply the migration yourself; the controller applies it.
- The migration file must contain no brand words at all, comments included: no "Darren", "DJP", "djpathlete", "Athlete Quiz", "RPI", "Step-Up", "GHL", "Stripe", and no `00000000-0000-0000-0000-000000000001` (the platform id). Write every SQL comment on its own line (no trailing `--` after code), and quote every function body with `$function$` (the test slices bodies on that tag).
- Type-check gate: `npx tsc --noEmit -p tsconfig.json` must stay at 238 errors in 54 files, per-file identical to `/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/baselines/tsc-ce6f2aba-perfile.txt`. Never run tsc while `next build` is running (it reads a half-written `.next/types`).
- Run only the test files named in your task, plus any suite that imports a module you changed (find them with `git grep -l`). Never a whole folder.

## Review Focus

1. **A business that already has part of the set.** Examples: a draft the coach edited, a sequence someone deleted, or Coaching alone. The helper adds only what is missing and never touches an existing row. Task 2's "run again" test covers it.
2. **A system-created business with no creator (`p_created_by = null`)** is provisioned the same as any other. Task 2 creates its business that way.
3. **The platform business is untouched** by both the backfill and a new create. Task 2 compares its row counts before and after.
4. **A duplicate slug still reads "slug taken", and nothing else does.** A duplicate from any other insert in the longer function must not be reported to the operator as a taken slug. Task 3 covers it.
5. **Board order for a brand-new business.** Coaching comes first in the app's own order, not last because of a shared `now()`. Task 2 queries it, and Task 1 pins `listPipelines`' ORDER BY.

---

### Task 1: Migration 00279 and its static test

**Files:**
- Create: `__tests__/migrations/fixtures/00279-platform-sequences.json` (copy, byte for byte, of `scratchpad/g32/platform-sequences.json`: the platform's twelve sequences and 93 steps, dumped read-only from the dev clone, which matches the migrations' end state)
- Create: `__tests__/migrations/00279_business_starter_set.test.ts`
- Create: `supabase/migrations/00279_business_starter_set.sql`

**Inputs already generated (do not retype them):**
- `scratchpad/g32/starter-calls.sql`: the body of `seed_business_starter_set`, meaning three `perform public.seed_starter_board(...)` and eleven `perform public.seed_starter_sequence(...)` calls, each with its JSON literal. Paste it in verbatim.
- `scratchpad/g32/changes.md`: every approved wording change (the test below encodes the same list).

**Interfaces:**
- Produces SQL functions: `public.seed_starter_board(p_business_id uuid, p_board jsonb, p_created_at timestamptz) returns void`, `public.seed_starter_sequence(p_business_id uuid, p_sequence jsonb) returns void`, `public.seed_business_starter_set(p_business_id uuid) returns void`, and `public.create_business(p_name text, p_slug text, p_timezone text, p_host_display_name text, p_host_email text, p_created_by uuid) returns public.businesses` (unchanged signature).
- Produces TS exports in the test file for Task 2: `MIGRATION` (path) and `sequenceLiterals()` (the parsed `$seq$` literals).

- [ ] **Step 1: Re-check the migration number is free**

Run: `git log --all --name-only --format= -- supabase/migrations | grep -c "00279"` (expected `0`) and `ls supabase/migrations | tail -2` (expected highest `00278_funnel_tenancy.sql`). Also run `ls "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/worktrees"`, and for each other worktree run `ls <it>/supabase/migrations | tail -1`. If 00279 is taken, STOP and report.

- [ ] **Step 2: Copy the fixture**

Run: `cp /private/tmp/claude-501/-Users-aeangabrielletayawa-Desktop-Darren-Paul-Projects-djpathlete/c1232610-26b7-4eff-ae58-674f6aabead1/scratchpad/g32/platform-sequences.json __tests__/migrations/fixtures/00279-platform-sequences.json`
Check: `grep -c '"key"' __tests__/migrations/fixtures/00279-platform-sequences.json` shows 12 or more. Stage keys are nested, so the count may exceed 12, but it must not be fewer.

- [ ] **Step 3: Write the static test**

Create `__tests__/migrations/00279_business_starter_set.test.ts`:

```ts
// @vitest-environment node
//
// G32 -- migration 00279: every business gets the three pipeline boards and a
// starter set of eleven DRAFT sequences, provisioned by one SQL helper that
// create_business() calls and the migration's own backfill runs.
//
// THE STATIC HALF ALWAYS RUNS. It reads the migration file and needs no
// database, so it can never be quietly skipped. The live half (below it, gated
// on the dev clone's URL) proves the database does what the file says.
//
// The starter copy is a LIGHT EDIT of the platform's approved copy (owner's
// ruling, 2026-09-26). The fixture is the platform's copy as of this
// migration; APPROVED_EDITS below is the complete list of what may differ.
// A wording change that is not in that list fails this file, so the list IS
// the reviewed diff.
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { validateStepList, type StepDraft } from "@/lib/lead-engine/step-list"
import type { StepKind, BranchCondition } from "@/lib/automation/sequence-tick"
import { unknownMergeFields } from "@/lib/lead-engine/merge-fields"
import { renderSequenceSms, SMS_OPT_OUT_SENTENCE, countSmsSegments } from "@/lib/lead-engine/sms"
import { RPI_ATHLETE_QUIZ } from "@/lib/quizzes/seed/rpi-athlete-quiz"
import type { ContactEventSource } from "@/lib/db/contacts"
import platformFixture from "./fixtures/00279-platform-sequences.json"

export const MIGRATION = "supabase/migrations/00279_business_starter_set.sql"
const RAW = readFileSync(join(process.cwd(), MIGRATION), "utf8")
/** Comment lines dropped, for checks on SQL statements. The JSON literals are always read from RAW. */
const SQL = RAW.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase()

type StepLiteral = {
  kind: string
  wait_minutes?: number
  subject?: string
  body?: string
  branch_condition?: Record<string, unknown>
  on_true_position?: number
  on_false_position?: number
  config?: Record<string, unknown>
}
export type SequenceLiteral = {
  key: string
  name: string
  description: string
  trigger_source: string | null
  trigger_filter: Record<string, string>
  reenrol_cooldown_days: number
  steps: StepLiteral[]
}
type StageLiteral = {
  key: string
  name: string
  position: number
  kind: string
  amber_after_days: number | null
  red_after_days: number | null
}
type BoardLiteral = { key: string; name: string; stages: StageLiteral[] }
type PlatformStep = {
  position: number
  kind: string
  wait_minutes: number | null
  subject: string | null
  body: string | null
  branch_condition: Record<string, unknown> | null
  on_true_position: number | null
  on_false_position: number | null
  config: Record<string, unknown>
}
type PlatformSequence = {
  key: string
  name: string
  description: string
  trigger_source: string | null
  trigger_filter: Record<string, unknown>
  reenrol_cooldown_days: number
  steps: PlatformStep[]
}

function literalsTagged<T>(tag: "seq" | "board"): T[] {
  const re = new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`, "g")
  return [...RAW.matchAll(re)].map((m) => JSON.parse(m[1]) as T)
}
export const sequenceLiterals = () => literalsTagged<SequenceLiteral>("seq")
const SEQUENCES = sequenceLiterals()
const BOARDS = literalsTagged<BoardLiteral>("board")
const PLATFORM = platformFixture as unknown as PlatformSequence[]

function platformOf(key: string): PlatformSequence {
  const found = PLATFORM.find((s) => s.key === key)
  if (!found) throw new Error(`the fixture has no ${key}`)
  return found
}

/** A function's whole definition, from `create or replace` to its closing `$function$;`. */
function functionBody(name: string): string {
  const start = SQL.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"))
  if (start === -1) throw new Error(`the migration defines no function ${name}`)
  const rest = SQL.slice(start)
  const open = rest.indexOf("$function$")
  const close = rest.indexOf("$function$", open + 1)
  if (open === -1 || close === -1) throw new Error(`${name} is not quoted with $function$`)
  return rest.slice(0, close + "$function$".length)
}

const STARTER_KEYS = [
  "new_lead_nurture",
  "lead_magnet_delivery",
  "newsletter_welcome",
  "cold_lead_re_engagement",
  "abandoned_checkout",
  "service_application_received",
  "camp_clinic_deadline",
  "quiz_ceiling_breaker",
  "quiz_rebuilder",
  "quiz_aspiring_pro",
  "quiz_parent_coach",
] as const
type StarterKey = (typeof STARTER_KEYS)[number]

// Typed, so tsc refuses a trigger the capture paths can never emit.
const TRIGGERS: Record<StarterKey, { source: ContactEventSource | null; filter: Record<string, string> }> = {
  new_lead_nurture: { source: "funnel_form", filter: {} },
  lead_magnet_delivery: { source: "lead_magnet", filter: {} },
  newsletter_welcome: { source: "newsletter", filter: {} },
  cold_lead_re_engagement: { source: null, filter: {} },
  abandoned_checkout: { source: "checkout_abandoned", filter: {} },
  service_application_received: { source: "inquiry", filter: {} },
  camp_clinic_deadline: { source: "event_signup", filter: { signup_type: "interest" } },
  quiz_ceiling_breaker: { source: "quiz", filter: { branch: "ceiling_breaker" } },
  quiz_rebuilder: { source: "quiz", filter: { branch: "rebuilder" } },
  quiz_aspiring_pro: { source: "quiz", filter: { branch: "aspiring_pro" } },
  quiz_parent_coach: { source: "quiz", filter: { branch: "parent_coach" } },
}

const QUIZ_NOTE = " It only runs for a quiz copied from the built-in quiz, whose results carry these names."
const DESCRIPTIONS: Record<StarterKey, string> = {
  new_lead_nurture:
    "Follows up with someone who fills in a form on one of your funnel pages. It is the only automatic message they get from you, so the first email goes out straight away.",
  lead_magnet_delivery:
    "Follows someone who downloads one of your free guides. The guide itself is emailed the moment they ask for it, so this starts with a two-day wait instead of a second email.",
  newsletter_welcome:
    "Welcomes a new newsletter subscriber. Nothing else emails them when they sign up, so the first message goes out straight away.",
  cold_lead_re_engagement:
    "For leads who have gone quiet. Nobody is added automatically: you choose who to add, from their contact page.",
  abandoned_checkout:
    "Follows someone who started paying for coaching or a program and did not finish. The payment provider only reports this when the checkout expires, about a day later, so the first message is a day behind. Shop orders, event tickets and saved-card setups are not included.",
  service_application_received:
    "Follows someone who sends the enquiry form on one of your service pages. Two days in, you get a reminder to check that someone has replied to them.",
  camp_clinic_deadline:
    "Chases someone who registered interest in a camp or clinic and has not paid. The first email goes out straight away. The next three count down to the camp's own start date (14, 7 and 3 days before), so everyone gets them at the same moment, whenever they signed up. Someone who signs up late skips the reminders whose moment has passed. Someone added by hand has no camp date, so their follow-up stops after the first email. The copy never names a particular camp.",
  quiz_ceiling_breaker:
    "Follows an athlete whose quiz result was Ceiling Breaker: already performing, looking for the next level. Their result is on screen before this arrives, so the first step sends immediately." +
    QUIZ_NOTE,
  quiz_rebuilder:
    "Follows an athlete whose quiz result was Rebuilder: coming back from injury or recurring breakdown. Tone matters most here: this sequence must never read as a sales push at someone who is hurt." +
    QUIZ_NOTE,
  quiz_aspiring_pro:
    "Follows a young athlete building toward something serious. The reader may be the athlete or a parent, so the copy should work read aloud at a kitchen table." +
    QUIZ_NOTE,
  quiz_parent_coach:
    "Follows a parent or coach enquiring on an athlete's behalf. The quiz asks its questions in the third person for this result, and the follow-up does too: the reader is not the athlete." +
    QUIZ_NOTE,
}

/** Every wording change from the platform's copy, beyond the greeting rule. Each `from` must occur exactly once. */
const APPROVED_EDITS: Array<{ key: StarterKey; position: number; field: "subject" | "body"; from: string; to: string }> = [
  { key: "lead_magnet_delivery", position: 5, field: "body", from: "Hi {{name}} — did the download land?", to: "Did the download land?" },
  {
    key: "newsletter_welcome",
    position: 4,
    field: "body",
    from: "Hi {{name}} — thanks for joining the newsletter. Expect one useful training idea a week, no filler.",
    to: "Thanks for joining the newsletter. Expect useful training ideas, no filler.",
  },
  { key: "cold_lead_re_engagement", position: 4, field: "body", from: "Hi {{name}} — no pressure.", to: "No pressure." },
  { key: "abandoned_checkout", position: 4, field: "body", from: "Hi {{name}} — you started", to: "You started" },
  {
    key: "service_application_received",
    position: 1,
    field: "body",
    from: 'They have already had the automatic "we have your application" email, and the follow-up emails are still going out on schedule.',
    to: "The follow-up emails are still going out on schedule.",
  },
  { key: "camp_clinic_deadline", position: 0, field: "body", from: "It's a small group, coached in person, working on", to: "It's a small group, working on" },
  { key: "camp_clinic_deadline", position: 2, field: "body", from: "Parents are welcome to watch. Athletes usually", to: "Athletes usually" },
  { key: "quiz_ceiling_breaker", position: 0, field: "subject", from: "Your Athlete Quiz result", to: "Your quiz result" },
  { key: "quiz_rebuilder", position: 0, field: "subject", from: "Your Athlete Quiz result", to: "Your quiz result" },
  { key: "quiz_aspiring_pro", position: 0, field: "subject", from: "Your Athlete Quiz result", to: "Your quiz result" },
  {
    key: "quiz_ceiling_breaker",
    position: 8,
    field: "body",
    from: "You're already training with us, so there is nothing to sign up for here.",
    to: "You already have an account with us, so there is nothing to sign up for here.",
  },
  {
    key: "quiz_rebuilder",
    position: 8,
    field: "body",
    from: "You're already training with us, so this isn't about booking anything.",
    to: "You already have an account with us, so this isn't about booking anything.",
  },
  {
    key: "quiz_aspiring_pro",
    position: 8,
    field: "body",
    from: "You're already training with us, so there's nothing to sign up for here.",
    to: "You already have an account with us, so there's nothing to sign up for here.",
  },
  {
    key: "quiz_parent_coach",
    position: 8,
    field: "body",
    from: "The athlete is already training with us, so there's nothing here to sign up for.",
    to: "The athlete already has an account with us, so there's nothing here to sign up for.",
  },
]

const GREETING_FROM = "Hi {{name}}\n"
const GREETING_TO = "Hi {{first_name}}\n"

/** The platform's copy with the approved changes applied: what every literal must equal. */
function expectedCopy(key: StarterKey): Array<{ subject: string | null; body: string | null }> {
  const steps = platformOf(key).steps.map((s) => ({ kind: s.kind, subject: s.subject, body: s.body }))
  for (const s of steps) {
    if (s.kind === "email" && s.body?.startsWith(GREETING_FROM)) s.body = GREETING_TO + s.body.slice(GREETING_FROM.length)
  }
  for (const edit of APPROVED_EDITS.filter((e) => e.key === key)) {
    const current = steps[edit.position][edit.field]
    if (current == null || current.split(edit.from).length !== 2) {
      throw new Error(`approved edit no longer matches exactly once: ${key}[${edit.position}].${edit.field}`)
    }
    steps[edit.position][edit.field] = current.replace(edit.from, edit.to)
  }
  return steps.map(({ subject, body }) => ({ subject, body }))
}

function structure(step: StepLiteral | PlatformStep) {
  return {
    kind: step.kind,
    wait_minutes: step.wait_minutes ?? null,
    branch_condition: step.branch_condition ?? null,
    on_true_position: step.on_true_position ?? null,
    on_false_position: step.on_false_position ?? null,
    config: step.config ?? {},
  }
}

function toDrafts(steps: StepLiteral[]): StepDraft[] {
  return steps.map((s) => ({
    id: null,
    kind: s.kind as StepKind,
    wait_minutes: s.wait_minutes ?? null,
    subject: s.subject ?? null,
    body: s.body ?? null,
    branch_condition: (s.branch_condition ?? null) as BranchCondition | null,
    on_true_position: s.on_true_position ?? null,
    on_false_position: s.on_false_position ?? null,
    config: s.config ?? {},
  }))
}

// Mirrors no-brand-literals.test.ts, plus what discovery found that list misses.
const FORBIDDEN = [/DJP\s*Athlete/i, /\bDarren\b/i, /darrenjpaul\.com/i]
const ALSO_FORBIDDEN = [
  /\bDJP\b/i,
  /darrenjpaul/i,
  /athlete quiz/i,
  /\bRPI\b/,
  /step-up/i,
  /\bGHL\b/,
  /gohighlevel/i,
  /sales inbox/i,
  /\bStripe\b/i,
  /https?:/i,
]

describe("00279 -- the starter sequences (static)", () => {
  it("holds exactly the eleven, and not sms_repermission", () => {
    expect(SEQUENCES.map((s) => s.key).sort()).toEqual([...STARTER_KEYS].sort())
    expect(SEQUENCES).toHaveLength(11)
  })

  it("carries no status: the function writes 'draft' itself, and nothing else", () => {
    for (const s of SEQUENCES) expect(Object.keys(s)).not.toContain("status")
    const body = norm(functionBody("seed_starter_sequence"))
    expect(body).toContain("'draft'")
    expect(body).not.toMatch(/'(active|paused|archived)'/)
  })

  it("sets the re-enrolment cooldown: 0 for the quiz four, 30 for the rest", () => {
    for (const s of SEQUENCES) expect(s.reenrol_cooldown_days, s.key).toBe(s.key.startsWith("quiz_") ? 0 : 30)
  })

  it("keeps the platform's trigger and filter for every sequence", () => {
    for (const s of SEQUENCES) {
      const want = TRIGGERS[s.key as StarterKey]
      expect({ source: s.trigger_source, filter: s.trigger_filter }, s.key).toEqual(want)
      expect(s.trigger_source, s.key).toBe(platformOf(s.key).trigger_source)
      expect(s.trigger_filter, s.key).toEqual(platformOf(s.key).trigger_filter)
    }
  })

  it("filters the quiz four on result keys the built-in quiz really has", () => {
    const branchKeys = RPI_ATHLETE_QUIZ.branches.map((b) => b.key)
    for (const s of SEQUENCES.filter((x) => x.key.startsWith("quiz_"))) {
      expect(branchKeys, s.key).toContain(s.trigger_filter.branch)
    }
  })

  it("passes the step editor's own validation, branch arms included", () => {
    for (const s of SEQUENCES) expect(validateStepList(toDrafts(s.steps)), s.key).toEqual([])
  })

  it("uses no merge field the renderers do not know", () => {
    for (const s of SEQUENCES) {
      s.steps.forEach((step, i) => {
        expect(unknownMergeFields(step.subject), `${s.key}[${i}] subject`).toEqual([])
        expect(unknownMergeFields(step.body), `${s.key}[${i}] body`).toEqual([])
      })
    }
  })

  it("keeps every text plain ASCII, free of merge fields, and one segment with the opt-out appended", () => {
    const texts = SEQUENCES.flatMap((s) => s.steps.filter((st) => st.kind === "sms").map((st) => ({ key: s.key, body: st.body! })))
    expect(texts.length).toBeGreaterThan(0)
    for (const { key, body } of texts) {
      expect(/^[\x20-\x7E\n]*$/.test(body), `${key}: non-ASCII in ${JSON.stringify(body)}`).toBe(true)
      expect(body, key).not.toContain("{{")
      expect(body, key).not.toContain(SMS_OPT_OUT_SENTENCE)
      const counted = countSmsSegments(renderSequenceSms({ body, contactName: null }).text)
      expect(counted.segments, `${key} renders to ${counted.characters} chars`).toBe(1)
    }
  })

  it("greets by first name in every email", () => {
    const emails = SEQUENCES.flatMap((s) => s.steps.filter((st) => st.kind === "email").map((st) => st.body!))
    expect(emails).toHaveLength(33)
    for (const body of emails) expect(body.startsWith(GREETING_TO)).toBe(true)
  })

  it("has exactly the platform's structure: kinds, waits, branches and configs", () => {
    for (const s of SEQUENCES) {
      expect(s.steps.map(structure), s.key).toEqual(platformOf(s.key).steps.map(structure))
    }
  })

  it("differs from the platform's wording only by the approved edits", () => {
    for (const s of SEQUENCES) {
      const key = s.key as StarterKey
      expect(s.name, key).toBe(platformOf(key).name)
      expect(s.description, key).toBe(DESCRIPTIONS[key])
      expect(
        s.steps.map((st) => ({ subject: st.subject ?? null, body: st.body ?? null })),
        key,
      ).toEqual(expectedCopy(key))
    }
  })

  it("names no brand, product, vendor or link anywhere a coach or lead reads", () => {
    for (const s of SEQUENCES) {
      const texts = [s.name, s.description, ...s.steps.flatMap((st) => [st.subject ?? "", st.body ?? ""])]
      for (const text of texts) {
        for (const re of [...FORBIDDEN, ...ALSO_FORBIDDEN]) expect(text, `${s.key}: ${re}`).not.toMatch(re)
      }
    }
    for (const re of FORBIDDEN) expect(RAW, `the migration file: ${re}`).not.toMatch(re)
  })
})

const EXPECTED_BOARDS: BoardLiteral[] = [
  {
    key: "coaching",
    name: "Coaching",
    stages: [
      { key: "consult_booked", name: "Consult Booked", position: 1, kind: "open", amber_after_days: 3, red_after_days: 7 },
      { key: "consulted", name: "Consulted", position: 2, kind: "open", amber_after_days: 5, red_after_days: 14 },
      { key: "won", name: "Won", position: 3, kind: "won", amber_after_days: null, red_after_days: null },
      { key: "lost", name: "Lost", position: 4, kind: "lost", amber_after_days: null, red_after_days: null },
    ],
  },
  {
    key: "assessment",
    name: "Assessment",
    stages: [
      { key: "assessment_booked", name: "Assessment Booked", position: 1, kind: "open", amber_after_days: 3, red_after_days: 7 },
      { key: "assessment_completed", name: "Assessment Completed", position: 2, kind: "open", amber_after_days: 5, red_after_days: 14 },
      { key: "won", name: "Won", position: 3, kind: "won", amber_after_days: null, red_after_days: null },
      { key: "lost", name: "Lost", position: 4, kind: "lost", amber_after_days: null, red_after_days: null },
    ],
  },
  {
    key: "camps_clinics",
    name: "Camps & Clinics",
    stages: [
      { key: "interested", name: "Interested", position: 1, kind: "open", amber_after_days: 3, red_after_days: 7 },
      { key: "registered", name: "Registered", position: 2, kind: "open", amber_after_days: 5, red_after_days: 14 },
      { key: "won", name: "Won", position: 3, kind: "won", amber_after_days: null, red_after_days: null },
      { key: "lost", name: "Lost", position: 4, kind: "lost", amber_after_days: null, red_after_days: null },
    ],
  },
]

describe("00279 -- the boards (static)", () => {
  it("seeds exactly the platform's three boards and their stages", () => {
    expect(BOARDS).toEqual(EXPECTED_BOARDS)
  })

  it("stamps the two extra boards just after Coaching, so every business lists Coaching first", () => {
    const stamps = [...RAW.matchAll(/\$board\$::jsonb,\s*(now\(\)(?:\s*\+\s*interval\s*'1 millisecond')?)\s*\)/g)].map((m) =>
      norm(m[1]),
    )
    expect(stamps).toEqual(["now()", "now() + interval '1 millisecond'", "now() + interval '1 millisecond'"])
  })

  it("relies on listPipelines still ordering by created_at, then key", () => {
    const dal = readFileSync(join(process.cwd(), "lib/db/pipeline.ts"), "utf8")
    const start = dal.indexOf("export async function listPipelines(")
    const fn = dal.slice(start, dal.indexOf("\n}\n", start))
    expect(fn).toMatch(/\.order\("created_at"[^)]*\)\s*\.order\("key"/)
  })
})

describe("00279 -- the SQL (static)", () => {
  it("names business_id in every insert into a table whose business_id defaults to the platform", () => {
    const inserts = [...SQL.matchAll(/insert into public\.(sequences|sequence_steps|pipelines|pipeline_stages)\s*\(([^)]*)\)/gi)]
    expect(inserts.map((m) => m[1].toLowerCase()).sort()).toEqual(["pipeline_stages", "pipelines", "sequence_steps", "sequences"])
    for (const m of inserts) expect(m[2], m[1]).toMatch(/\bbusiness_id\b/)
  })

  it("never names the platform business", () => {
    expect(RAW).not.toContain("00000000-0000-0000-0000-000000000001")
  })

  it("adds a board or a sequence only when the business has none with that key", () => {
    expect(norm(functionBody("seed_starter_board"))).toContain(
      "if exists (select 1 from public.pipelines where business_id = p_business_id and key = p_board->>'key') then return;",
    )
    expect(norm(functionBody("seed_starter_sequence"))).toContain(
      "if exists (select 1 from public.sequences where business_id = p_business_id and key = p_sequence->>'key') then return;",
    )
  })

  it("keeps create_business' signature, runs it as definer, and provisions through the helper", () => {
    const body = norm(functionBody("create_business"))
    expect(body).toMatch(
      /create or replace function public\.create_business\( ?p_name text, p_slug text, p_timezone text, p_host_display_name text, p_host_email text, p_created_by uuid ?\) returns public\.businesses/,
    )
    expect(body).toContain("security definer")
    expect(body).toContain("set search_path = public")
    expect(body).toContain("perform public.seed_business_starter_set(v_business.id);")
    expect(body).not.toContain("insert into public.pipelines")
  })

  it("restates the grants for every function it defines", () => {
    const sql = norm(SQL)
    const signatures = [
      "public.create_business(text, text, text, text, text, uuid)",
      "public.seed_business_starter_set(uuid)",
      "public.seed_starter_board(uuid, jsonb, timestamptz)",
      "public.seed_starter_sequence(uuid, jsonb)",
    ]
    for (const sig of signatures) {
      expect(sql, sig).toContain(`revoke all on function ${sig} from public;`)
      expect(sql, sig).toContain(`revoke execute on function ${sig} from anon, authenticated;`)
    }
    expect(sql).toContain("grant execute on function public.create_business(text, text, text, text, text, uuid) to service_role;")
    expect(sql).not.toMatch(/grant [^;]* to [^;]*\b(anon|authenticated|public)\b/)
  })

  it("backfills every business, keyed on absence inside the helper, never on a list of ids", () => {
    const sql = norm(SQL)
    expect(sql).toMatch(/for b in select id from public\.businesses loop perform public\.seed_business_starter_set\(b\.id\); end loop;/)
  })
})
```

- [ ] **Step 4: Run it and see it fail for the right reason**

Run: `PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/migrations/00279_business_starter_set.test.ts`
Expected: the file fails to load with `ENOENT ... 00279_business_starter_set.sql`.

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/00279_business_starter_set.sql` in this order. Put every comment on its own line, and use no brand words in comments (see Global Constraints):

1. A header comment explaining the change:
   - What G32 is.
   - That the starter set is the platform's approved copy, lightly edited, eleven sequences all draft, with `sms_repermission` left out because it was a one-off.
   - That every insert names `business_id`, and why.
   - That a future copy migration that rewrites sequences by key now reaches every business's drafts, so it must say which businesses it touches and update this helper in the same migration if new businesses should get the change.
   - Where the boards come from (00249, 00257).
   - That a new business still cannot use these sequences on its own (spec §5).
2. `create or replace function public.seed_starter_board(p_business_id uuid, p_board jsonb, p_created_at timestamptz) returns void language plpgsql set search_path = public as $function$ ... $function$;`, with this body:
```sql
declare
  v_pipeline uuid;
begin
  if exists (select 1 from public.pipelines where business_id = p_business_id and key = p_board->>'key') then return; end if;

  insert into public.pipelines (business_id, key, name, status, created_at)
  values (p_business_id, p_board->>'key', p_board->>'name', 'active', p_created_at)
  returning id into v_pipeline;

  insert into public.pipeline_stages (business_id, pipeline_id, key, name, position, kind, amber_after_days, red_after_days)
  select p_business_id, v_pipeline, s->>'key', s->>'name', (s->>'position')::int, s->>'kind',
         (s->>'amber_after_days')::int, (s->>'red_after_days')::int
    from jsonb_array_elements(p_board->'stages') as s;
end;
```
3. `create or replace function public.seed_starter_sequence(p_business_id uuid, p_sequence jsonb) returns void language plpgsql set search_path = public as $function$ ... $function$;`, with this body:
```sql
declare
  v_sequence uuid;
begin
  if exists (select 1 from public.sequences where business_id = p_business_id and key = p_sequence->>'key') then return; end if;

  insert into public.sequences (business_id, key, name, description, status, trigger_source, trigger_filter, reenrol_cooldown_days)
  values (p_business_id, p_sequence->>'key', p_sequence->>'name', p_sequence->>'description', 'draft',
          p_sequence->>'trigger_source', coalesce(p_sequence->'trigger_filter', '{}'::jsonb),
          (p_sequence->>'reenrol_cooldown_days')::smallint)
  returning id into v_sequence;

  insert into public.sequence_steps
    (business_id, sequence_id, position, kind, wait_minutes, subject, body,
     branch_condition, on_true_position, on_false_position, config)
  select p_business_id, v_sequence, (e.ord - 1)::int, e.value->>'kind',
         (e.value->>'wait_minutes')::int, e.value->>'subject', e.value->>'body',
         case when e.value->'branch_condition' is null or e.value->'branch_condition' = 'null'::jsonb
              then null else e.value->'branch_condition' end,
         (e.value->>'on_true_position')::int, (e.value->>'on_false_position')::int,
         coalesce(e.value->'config', '{}'::jsonb)
    from jsonb_array_elements(p_sequence->'steps') with ordinality as e(value, ord);
end;
```
4. `create or replace function public.seed_business_starter_set(p_business_id uuid) returns void language plpgsql set search_path = public as $function$ begin <paste scratchpad/g32/starter-calls.sql here> end; $function$;`. Paste the calls file verbatim. It already contains the three board calls (coaching `now()`, then assessment and camps_clinics at `now() + interval '1 millisecond'`) and the eleven sequence calls.
5. The new `create_business`. Copy 00249's body, including its useful comments, with three changes: quote it with `$function$`, replace the coaching `insert into public.pipelines ...` and `insert into public.pipeline_stages ...` block with `perform public.seed_business_starter_set(v_business.id);`, and drop the now-unused `v_pipeline` variable. Keep the signature byte for byte: `(p_name text, p_slug text, p_timezone text, p_host_display_name text, p_host_email text, p_created_by uuid) returns public.businesses language plpgsql security definer set search_path = public`.
6. The grants. Keep 00249's comment about why they are not redundant. For each of the four signatures, `revoke all on function <sig> from public;` and `revoke execute on function <sig> from anon, authenticated;`. Then `grant execute on function public.create_business(text, text, text, text, text, uuid) to service_role;`.
7. The backfill:
```sql
do $$
declare
  b record;
begin
  for b in select id from public.businesses loop
    perform public.seed_business_starter_set(b.id);
  end loop;
end $$;
```

- [ ] **Step 6: Run the test and see it pass**

Run: `PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/migrations/00279_business_starter_set.test.ts`
Expected: PASS, every test. If "one segment" fails for a text, STOP and report the text and its count. Do not reword copy yourself: the wording is the owner's approved list.

- [ ] **Step 7: Mutation-check the test (each must turn a test red, then be restored with an edit)**

Plant one at a time in the migration, run the file, confirm the named test fails, restore, and confirm with `git diff --stat` that the migration is back to the committed-to-be version:
1. In `seed_starter_sequence`, change `'draft'` to `'active'`. Expected red: "carries no status".
2. Remove `business_id, ` from the `insert into public.sequence_steps` column list. Expected red: "names business_id".
3. In the `abandoned_checkout` literal's step 4 body, replace "You started" with "You—started". Expected red: the ASCII text test, and the wording test.
4. In `quiz_rebuilder`, change step 7's `"kind": "stop"` to `"kind": "email"` with no subject. Expected red: validation, structure, and the email count.
5. Delete the `revoke execute ... seed_starter_board ... from anon, authenticated;` line. Expected red: "restates the grants".
6. Change camps_clinics' timestamp to `now()`. Expected red: "stamps the two extra boards".

Record each result (name, tests that went red) for the report.

- [ ] **Step 8: Brand sweep test, and the type check on the new files**

Add `"supabase/migrations/00279_business_starter_set.sql"` to `ROOTS` in `__tests__/lib/lead-engine/no-brand-literals.test.ts`, following that array's existing style. Then run: `PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/lead-engine/no-brand-literals.test.ts __tests__/migrations/00279_business_starter_set.test.ts`. Expected: PASS.
Then run `PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx tsc --noEmit -p tsconfig.json > /private/tmp/claude-501/-Users-aeangabrielletayawa-Desktop-Darren-Paul-Projects-djpathlete/c1232610-26b7-4eff-ae58-674f6aabead1/scratchpad/g32/tsc-t1.log 2>&1` and confirm `grep -c "error TS"` on that log is 238, with no line naming `00279`.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/00279_business_starter_set.sql __tests__/migrations/00279_business_starter_set.test.ts __tests__/migrations/fixtures/00279-platform-sequences.json __tests__/lib/lead-engine/no-brand-literals.test.ts
git commit -m "feat(lead-engine): every business starts with the three boards and eleven draft sequences (G32)" -m "<why: create_business seeded Coaching only; the helper, the backfill, the light-edited copy; the test holds it to the editor's own rules and the approved change list>"
```

---

### Task 2: The live proof on the dev clone

**Precondition:** the controller has applied 00279 to the dev clone. Check with `mcp__supabase__execute_sql` on project `anjvztjiokcgiyhobknq`: `select count(*) from pg_proc where proname = 'seed_business_starter_set'` must be 1. If it is not, STOP.

**Files:**
- Modify: `__tests__/migrations/00279_business_starter_set.test.ts` (append the live block)

**Interfaces:**
- Consumes: `sequenceLiterals()` and `MIGRATION` from the same file (Task 1).

- [ ] **Step 1: Append the live block**

Add these imports at the top of the file, beside the others: `import { afterAll, beforeAll } from "vitest"` (merge into the existing vitest import) and `import { createClient, type SupabaseClient } from "@supabase/supabase-js"`. Then append:

```ts
// ---------------------------------------------------------------------------
// THE LIVE HALF, on the dev clone only. It creates a throwaway business through
// create_business (with no creator, as a system-created business would be),
// checks what it was given, and deletes it; every table involved cascades from
// businesses. It never writes to any other business.
// ---------------------------------------------------------------------------
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const describeIf = url && key ? describe : describe.skip
const DEV_REF = "anjvztjiokcgiyhobknq"
const PLATFORM_ID = "00000000-0000-0000-0000-000000000001"

describeIf("00279 on the dev clone -- create_business provisions a whole business", () => {
  let db: SupabaseClient
  let businessId: string
  let platformBefore: Record<string, number>
  const literals = sequenceLiterals()

  async function counts(id: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    for (const table of ["sequences", "sequence_steps", "pipelines", "pipeline_stages"]) {
      const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("business_id", id)
      if (error) throw new Error(`${table}: ${error.message}`)
      out[table] = count ?? -1
    }
    return out
  }

  beforeAll(async () => {
    expect(url, "refusing to run against anything but the dev clone").toContain(DEV_REF)
    db = createClient(url!, key!)
    platformBefore = await counts(PLATFORM_ID)
    const { data, error } = await db.rpc("create_business", {
      p_name: "G32 Starter Set Test",
      p_slug: `g32-starter-${Date.now()}`,
      p_timezone: "UTC",
      p_host_display_name: "Test Coach",
      p_host_email: "",
      p_created_by: null,
    })
    if (error) throw new Error(`create_business: ${error.message}`)
    businessId = (Array.isArray(data) ? data[0] : data).id
  })

  afterAll(async () => {
    if (!businessId) return
    const { error } = await db.from("businesses").delete().eq("id", businessId)
    if (error) console.error(`[00279 live] could not delete the throwaway business ${businessId}: ${error.message}`)
  })

  it("gives it all three boards, Coaching first in listPipelines' own order", async () => {
    const { data, error } = await db
      .from("pipelines")
      .select("id, key")
      .eq("business_id", businessId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .order("key", { ascending: true })
    if (error) throw new Error(error.message)
    // The same query listPipelines (lib/db/pipeline.ts) makes; the static half pins that it still does.
    expect(data!.map((p) => p.key)).toEqual(["coaching", "assessment", "camps_clinics"])
    for (const board of data!) {
      const { count } = await db.from("pipeline_stages").select("id", { count: "exact", head: true }).eq("pipeline_id", board.id).eq("business_id", businessId)
      expect(count, board.key).toBe(4)
    }
  })

  it("gives it the eleven sequences, every one a draft", async () => {
    const { data, error } = await db.from("sequences").select("key, status").eq("business_id", businessId)
    if (error) throw new Error(error.message)
    expect(data!.map((s) => s.key).sort()).toEqual(literals.map((s) => s.key).sort())
    expect(new Set(data!.map((s) => s.status))).toEqual(new Set(["draft"]))
  })

  it("files every step under the new business, with each sequence's full step count", async () => {
    const { data: seqs } = await db.from("sequences").select("id, key").eq("business_id", businessId)
    for (const s of seqs!) {
      const { data: steps, error } = await db.from("sequence_steps").select("business_id, position").eq("sequence_id", s.id)
      if (error) throw new Error(error.message)
      const want = literals.find((l) => l.key === s.key)!.steps.length
      expect(steps!.length, s.key).toBe(want)
      expect(new Set(steps!.map((st) => st.business_id)), s.key).toEqual(new Set([businessId]))
      expect(steps!.map((st) => st.position).sort((a, b) => a - b), s.key).toEqual([...Array(want).keys()])
    }
  })

  it("leaves the platform business exactly as it was", async () => {
    expect(await counts(PLATFORM_ID)).toEqual(platformBefore)
  })

  it("adds back only what is missing when run again, and never touches an edited draft", async () => {
    const { data: seqs } = await db.from("sequences").select("id, key").eq("business_id", businessId)
    const edited = seqs!.find((s) => s.key === "new_lead_nurture")!
    const removed = seqs!.find((s) => s.key === "newsletter_welcome")!
    await db.from("sequences").update({ name: "Edited by the coach" }).eq("id", edited.id)
    await db.from("sequences").delete().eq("id", removed.id)
    const before = await counts(businessId)

    const { error } = await db.rpc("seed_business_starter_set", { p_business_id: businessId })
    if (error) throw new Error(`seed_business_starter_set: ${error.message}`)

    const after = await counts(businessId)
    const back = literals.find((l) => l.key === "newsletter_welcome")!
    expect(after.sequences).toBe(before.sequences + 1)
    expect(after.sequence_steps).toBe(before.sequence_steps + back.steps.length)
    expect(after.pipelines).toBe(before.pipelines)
    const { data: stillEdited } = await db.from("sequences").select("id, name").eq("id", edited.id).single()
    expect(stillEdited!.name).toBe("Edited by the coach")
  })
})
```

- [ ] **Step 2: Run it**

Run: `PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/migrations/00279_business_starter_set.test.ts`
Expected: every test PASSES and none is skipped. Check the summary: a skipped count above 0 means the env did not load, so STOP. If `seed_business_starter_set` answers a permission error, report it. Do NOT add a grant yourself.

- [ ] **Step 3: Prove the live half can fail**

Plant, run, restore (one at a time):
1. Change the expected board order to `["assessment", "camps_clinics", "coaching"]`. The board test must go red.
2. In the "run again" test, change the edited name expectation to `"New Lead Nurture"`. That test must go red.

Confirm with `SELECT count(*) FROM businesses WHERE slug LIKE 'g32-starter-%'` on the dev clone that every throwaway business was deleted (0).

- [ ] **Step 4: Commit**

```bash
git add __tests__/migrations/00279_business_starter_set.test.ts
git commit -m "test(lead-engine): prove on the dev clone that create_business provisions a whole business (G32)" -m "<why>"
```

---

### Task 3: A duplicate is only "slug taken" when it is the slug

**Files:**
- Modify: `lib/db/businesses.ts` (the `createBusiness` doc comment and its 23505 mapping)
- Test: `__tests__/db/businesses.test.ts`

**Interfaces:**
- Produces: `createBusiness` throws `SlugTakenError` only for a unique violation that names `businesses_slug_key`. Any other `23505` becomes `Error("create_business failed (23505): <message>")`.

- [ ] **Step 1: Read the existing 23505 test**

`sed -n 60,110p __tests__/db/businesses.test.ts`. Note how `rpc` is mocked and what error object the existing 23505 case passes.

- [ ] **Step 2: Write the failing tests**

Give the existing "slug taken" case a realistic error: `{ code: "23505", message: 'duplicate key value violates unique constraint "businesses_slug_key"', details: "Key (slug)=(taken) already exists." }`. Keep its `SlugTakenError` expectation. Then add:

```ts
it("does not call an unrelated duplicate a taken slug (control)", async () => {
  // Any other unique violation inside create_business: the function now
  // inserts boards, stages, sequences and steps too.
  rpc.mockResolvedValueOnce({
    data: null,
    error: {
      code: "23505",
      message: 'duplicate key value violates unique constraint "sequences_business_key_uniq"',
      details: "Key (business_id, key)=(x, new_lead_nurture) already exists.",
    },
  })
  const attempt = createBusiness({ name: "A", slug: "fresh", timezone: "UTC", hostDisplayName: "A", hostEmail: "", createdBy: null })
  await expect(attempt).rejects.not.toBeInstanceOf(SlugTakenError)
  await expect(
    createBusiness({ name: "A", slug: "fresh", timezone: "UTC", hostDisplayName: "A", hostEmail: "", createdBy: null }),
  ).rejects.toThrow(/sequences_business_key_uniq/)
})
```

Adapt the mock variable name (`rpc` or whatever the file uses) and the input shape to the file's existing helpers. The second call needs its own `mockResolvedValueOnce`.

- [ ] **Step 3: Run it. The control must fail.**

Run: `PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/db/businesses.test.ts`
Expected: the new control FAILS, because today every 23505 maps to SlugTakenError.

- [ ] **Step 4: Implement**

In `lib/db/businesses.ts`:
- Add above `createBusiness`: `/** The unique constraint on businesses.slug (the dev clone's pg_constraint). Only a violation naming it means the slug is taken. */ const SLUG_UNIQUE_CONSTRAINT = "businesses_slug_key"`.
- Change the mapping to `if (error.code === "23505" && (error.message ?? "").includes(SLUG_UNIQUE_CONSTRAINT)) throw new SlugTakenError(input.slug)`.
- Rewrite the doc comment. It should say that the function creates the whole tenant (the business, its settings, booking host and owner membership, then, through `seed_business_starter_set` (00279), the three boards and eleven draft sequences) in one transaction. Keep the paragraph about taking no default businessId. Also say why the mapping checks the constraint name: the function inserts many rows, so a bare 23505 no longer means the slug.

- [ ] **Step 5: Run it green, plus every suite that imports the module**

Run: `git grep -l "@/lib/db/businesses" -- __tests__`, then run `npx vitest run` on `__tests__/db/businesses.test.ts` and every file listed. Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/businesses.ts __tests__/db/businesses.test.ts
git commit -m "fix(businesses): only a clash on the slug reads as 'slug taken' (G32)" -m "<why>"
```

---

### Task 4: The text this makes false

**Files (read each spot before editing; line numbers are approximate):**
- Modify: `lib/db/pipeline.ts`: the comment around 998-1005 (the board fallback) and `listPipelines`' doc comment around 1878-1880.
- Modify: `app/(admin)/admin/pipeline/page.tsx` around 50-53 and around 130.
- Modify: `app/(admin)/admin/pipeline/settings/page.tsx` around 44.
- Modify: test comments in `__tests__/components/admin/pipeline-board.test.tsx` (around 204, 258), `__tests__/db/pipeline.test.ts` (around 2848) and `__tests__/components/admin/pipeline-page-tenancy.test.tsx` (around 149). Find the exact paths with `git ls-files | grep <name>`.
- Modify: `scripts/capture-sequence-reporting-screenshots.mjs` (around 163-167) and `scripts/capture-sequence-content-screenshots.mjs` (around 18 and 175).

- [ ] **Step 1: Find every claim**

Run: `git grep -n -i -e "only the coaching" -e "coaching only" -e "seeds only" -e "seeds Coaching" -e "00249" -e "has no sequences" -e "create_business" -- lib app components scripts __tests__`. Read each hit in context. A claim is false now if it says a new business gets only the Coaching board, or that other boards exist only on the platform, or that a test business has no sequences.

- [ ] **Step 2: Correct each comment**

For each comment:
- State what is true after 00279: `create_business()` seeds all three boards and eleven draft sequences, and the migration backfilled existing businesses.
- Keep any reason the code still exists. The fallback in `resolvePipelineWithFallback` stays, because a business can archive a board by hand; say so in place.
- `listPipelines`' doc: say every business lists Coaching first, because 00279 stamps the extra boards a millisecond later.

- [ ] **Step 3: Fix the two capture scripts' wrong-tenant control**

Read each script's check. Replace "Northcrest 10E has no sequences" with a check that holds after the backfill: the sequences the page shows for 10E are 10E's own (their ids belong to rows with `business_id` = 10E) and are all `draft`, while the platform's are not shown. Keep the scripts' existing structure and logging. Do NOT run them: they need a dev server and a signed-in browser.

- [ ] **Step 4: Run the suites whose files you touched, plus the type check**

Run `npx vitest run` on exactly the test files edited in this task, and `npx tsc --noEmit -p tsconfig.json`, which must stay 238 / 54 identical. Syntax-check the scripts with `node --check scripts/capture-sequence-reporting-screenshots.mjs` and `node --check scripts/capture-sequence-content-screenshots.mjs`.

- [ ] **Step 5: Commit**

```bash
git add <each file you changed, by path>
git commit -m "docs(pipeline): the comments now say every business has all three boards (G32)" -m "<why>"
```

---

### Task 5: Screenshots from the real app

**Precondition:** the migration is applied to the dev clone, so the 7 test businesses are backfilled.

**Files:**
- Create: `scripts/capture-g32-starter-set-screenshots.mjs`
- Create: `screenshots/g32-business-starter-set/` (annotated PNGs + `README.html`)

- [ ] **Step 1: Learn the house capture pattern**

Read `scripts/capture-g33-sms-sender-phone-screenshots.mjs` and `scripts/capture-g35-untenanted-screenshots.mjs` end to end. They show how to:
- start or reuse `next dev`
- sign in with the dev-login bypass
- choose the admin tenant with the `djp_business` cookie
- park the pointer before a screenshot
- hide the Next.js dev badge (`nextjs-portal { display:none }`)
- burn numbered markers and captions INTO the PNG at the capture's own pixel width

Use a port no other session is using (check `lsof -i :<port>` first; try 3079).

- [ ] **Step 2: Write and run the capture script**

Target the dev test business "Trailhead Strength & Conditioning" (look up its full id on the dev clone with `select id, name from businesses where name like 'Trailhead%'`). Capture, light theme only (the admin UI is light-only):
1. `/admin/sequences` for Trailhead: eleven sequences, each marked "Never turned on". Annotate the count and one draft badge. The caption, for a non-programmer: "A new business now starts with eleven follow-up sequences, all switched off until the coach turns them on."
2. `/admin/pipeline` for Trailhead: the board pills Coaching, Assessment, Camps & Clinics, with Coaching selected. Annotate the pills. Caption: "It also starts with all three boards, Coaching first."

The script must throw if the page shows the platform's sequences (for example, any sequence whose status is not "Never turned on") or if fewer than eleven rows render. It must write nothing to the database.

- [ ] **Step 3: Look at every PNG** (Read it) before calling it done. Check the annotations are legible and inside the frame, and that no dev-only chrome shows. Then write `README.html` beside the PNGs: one line per shot, with the images as sibling files (not base64).

- [ ] **Step 4: Commit**

```bash
git add scripts/capture-g32-starter-set-screenshots.mjs screenshots/g32-business-starter-set
git commit -m "docs(screenshots): a backfilled business's sequences and boards, in the real app (G32)" -m "<why>"
```

---

## Controller steps between tasks (not for implementers)

- After Task 1 is reviewed: apply 00279 to the dev clone with `mcp__supabase__apply_migration` (name `00279_business_starter_set`). Read back:
  - `pg_get_functiondef` of `create_business`: it must mention `seed_business_starter_set`.
  - The grants: `has_function_privilege('anon', ...)` is false for all four functions.
  - Per business: 3 boards, 11 or more sequences (Primary keeps its 12), and all new rows draft.
- After all tasks: update the ledger (the G32 row; new rows G46-G49 from spec §6; the scoreboard), the journal and memory. Then run the whole-branch review and the gates: targeted suites, tsc 238/54, `npm run test:integration:selects`, `npm run build`, and `SINGLETON_BUSINESS_ID` still 5.
