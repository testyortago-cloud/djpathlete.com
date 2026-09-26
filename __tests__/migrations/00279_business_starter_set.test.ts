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
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
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
