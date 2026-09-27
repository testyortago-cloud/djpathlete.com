// @vitest-environment node
//
// G18 + G11 -- migration 00281:
//   1. a twelfth starter sequence, `chat_lead_follow_up` (trigger `ai_chat`),
//      seeded as a DRAFT on every business, by re-issuing the WHOLE
//      `seed_business_starter_set` from 00279 (its header's FUTURE COPY
//      MIGRATIONS paragraph says that is the only way a new business gets it);
//   2. `camp_clinic_deadline` goes from 14/7/3 to 14/7/3/1: a new "Three days
//      to go" email at the 3-day moment, and the owner-approved "Last one about
//      this" email moved to 1 day before, still LAST -- in the starter JSON and
//      in every existing copy of the recognised shape.
//
// THE STATIC HALF ALWAYS RUNS: it reads the migration file and needs no
// database. The live half (below it, gated on the dev clone) proves the
// database does what the file says, including what happens to people who are
// partway through the camp sequence when the conversion runs.
//
// The copy is the spec's (docs/superpowers/specs/2026-09-27-lead-engine-owner-
// answers-design.md, sections 1 and 2), character for character.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { validateStepList, type StepDraft } from "@/lib/lead-engine/step-list"
import type { StepKind, BranchCondition } from "@/lib/automation/sequence-tick"
import { unknownMergeFields } from "@/lib/lead-engine/merge-fields"
import { renderSequenceSms, SMS_OPT_OUT_SENTENCE, countSmsSegments } from "@/lib/lead-engine/sms"
import type { ContactEventSource } from "@/lib/db/contacts"

const MIGRATION = "supabase/migrations/00281_chat_follow_up_and_camp_countdown.sql"
const PRIOR = "supabase/migrations/00279_business_starter_set.sql"
const RAW = readFileSync(join(process.cwd(), MIGRATION), "utf8")
const PRIOR_RAW = readFileSync(join(process.cwd(), PRIOR), "utf8")

const stripComments = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
/** Comment lines dropped, for checks on SQL statements. JSON literals are read from the raw text. */
const SQL = stripComments(RAW)
const PRIOR_SQL = stripComments(PRIOR_RAW)
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()

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
type SequenceLiteral = {
  key: string
  name: string
  description: string
  trigger_source: string | null
  trigger_filter: Record<string, string>
  reenrol_cooldown_days: number
  steps: StepLiteral[]
}

/** A function's whole definition, from `create or replace` to its closing `$function$`. */
function functionBody(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"))
  if (start === -1) throw new Error(`no function ${name}`)
  const rest = sql.slice(start)
  const open = rest.indexOf("$function$")
  const close = rest.indexOf("$function$", open + 1)
  if (open === -1 || close === -1) throw new Error(`${name} is not quoted with $function$`)
  return rest.slice(0, close + "$function$".length)
}

function seqLiterals(text: string): SequenceLiteral[] {
  return [...text.matchAll(/\$seq\$([\s\S]*?)\$seq\$/g)].map((m) => JSON.parse(m[1]) as SequenceLiteral)
}

const FN_281 = functionBody(RAW, "seed_business_starter_set")
const FN_279 = functionBody(PRIOR_RAW, "seed_business_starter_set")
const SEQUENCES = seqLiterals(FN_281)
const PRIOR_SEQUENCES = seqLiterals(FN_279)

function literal(list: SequenceLiteral[], key: string): SequenceLiteral {
  const found = list.find((s) => s.key === key)
  if (!found) throw new Error(`no ${key} literal`)
  return found
}

// ---------------------------------------------------------------------------
// The spec's copy, verbatim.
// ---------------------------------------------------------------------------
const CHAT_DESCRIPTION =
  "Follows someone who leaves their details in the chat on your website. It tells you straight away so a person can reply, confirms to them that their question reached you, then checks in two days later."

const CHAT_STEPS: StepLiteral[] = [
  {
    kind: "alert",
    subject: "{{name}} left their details in your website chat",
    body: "{{name}} asked a question in the chat on your website and left their details so someone can get back to them.\n\nThey were told a person would be in touch. Open the chat assistant in your admin to read what they asked, then reply by email or text.\n\nThey also get a short automatic email saying their question reached you.",
  },
  {
    kind: "email",
    subject: "Your question reached us",
    body: "Hi {{first_name}}\n\nThanks for leaving your details in the chat. Your question has been passed on, and a real person will get back to you.\n\nIf there's anything you'd like to add in the meantime, such as the sport, the athlete's age, or what you're hoping to fix, just reply to this email. It helps us give you a proper answer rather than a general one.",
  },
  { kind: "wait", wait_minutes: 2880 },
  {
    kind: "email",
    subject: "Did you get what you needed?",
    body: "Hi {{first_name}}\n\nJust checking your question got answered. If it didn't, or if it raised new ones, reply here and it comes straight to us.\n\nIf you're weighing up whether training with us is the right fit, the easiest next step is a short call. Reply with a couple of times that suit you and we'll set it up.",
  },
  { kind: "wait", wait_minutes: 1440 },
  {
    kind: "sms",
    body: "Checking your question from the website chat got answered. Reply here if you still need anything.",
  },
  { kind: "stop" },
]

const THREE_DAYS_SUBJECT = "Three days to go"
const THREE_DAYS_BODY =
  "Hi {{first_name}}\n\nThe camp is three days away. If you're still deciding, the thing worth knowing is that registering interest doesn't hold a place — registering properly does.\n\nIf something's in the way, such as the date, the cost, or whether it's the right level, reply and tell me. I'd rather sort it out than have you miss it."

const NEW_EMAIL: StepLiteral = { kind: "email", subject: THREE_DAYS_SUBJECT, body: THREE_DAYS_BODY }
const ONE_DAY_WAIT: StepLiteral = { kind: "wait", config: { wait_until: { days_before_anchor: 1 } } }

/**
 * The camp's description is rendered on /admin/sequences, and 00270 exists
 * because it once contradicted the sequence. "The next three ... (14, 7 and 3
 * days before)" stops being true the moment a fourth reminder exists, so the
 * starter copy says four. Only this clause changes.
 */
const STARTER_CAMP_CLAUSE_FROM = "The next three count down to the camp's own start date (14, 7 and 3 days before)"
const STARTER_CAMP_CLAUSE_TO =
  "The next four count down to the camp's own start date (14, 7 and 3 days before, and the day before)"
/** The same clause in 00270's wording, which the platform's own row carries. */
const PLATFORM_CAMP_CLAUSE_FROM =
  "The three after it count down to the camp's own start date -- 14, 7 and 3 days before --"
const PLATFORM_CAMP_CLAUSE_TO =
  "The four after it count down to the camp's own start date -- 14, 7 and 3 days before, and the day before --"

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

/** The pre-00281 camp literal with this migration's two edits applied: what 00281's must equal. */
function expectedCamp(): SequenceLiteral {
  const prior = literal(PRIOR_SEQUENCES, "camp_clinic_deadline")
  const n = prior.steps.length
  // The splice point is DERIVED and then checked, not assumed: the old tail
  // must be wait{3 days before} / email / stop.
  expect(prior.steps[n - 3]).toEqual({ kind: "wait", config: { wait_until: { days_before_anchor: 3 } } })
  expect(prior.steps[n - 2].kind).toBe("email")
  expect(prior.steps[n - 1]).toEqual({ kind: "stop" })
  expect(prior.description.split(STARTER_CAMP_CLAUSE_FROM)).toHaveLength(2)
  return {
    ...prior,
    description: prior.description.replace(STARTER_CAMP_CLAUSE_FROM, STARTER_CAMP_CLAUSE_TO),
    steps: [...prior.steps.slice(0, n - 2), NEW_EMAIL, ONE_DAY_WAIT, ...prior.steps.slice(n - 2)],
  }
}

// Mirrors 00279's test: no brand, product, vendor or link anywhere a coach or lead reads.
const FORBIDDEN = [/DJP\s*Athlete/i, /\bDarren\b/i, /darrenjpaul\.com/i]
const ALSO_FORBIDDEN = [
  /\bDJP\b/i,
  /darrenjpaul/i,
  /athlete quiz/i,
  /\bRPI\b/,
  /\bGHL\b/,
  /gohighlevel/i,
  /\bStripe\b/i,
  /https?:/i,
]

describe("00281 -- seed_business_starter_set is re-issued WHOLE (static)", () => {
  it("re-issues the function under its own signature", () => {
    expect(norm(SQL)).toContain(
      "create or replace function public.seed_business_starter_set(p_business_id uuid) returns void",
    )
  })

  it("holds every key 00279's version holds, plus chat_lead_follow_up, and nothing else", () => {
    const prior = PRIOR_SEQUENCES.map((s) => s.key)
    // Derived from 00279's own file, so this cannot drift from what it seeded.
    expect(prior.length).toBeGreaterThan(0)
    expect(SEQUENCES.map((s) => s.key)).toEqual([...prior, "chat_lead_follow_up"])
  })

  it("changes nothing else in the function: same statements, same boards, same other ten sequences", () => {
    // The skeleton is the function with every sequence literal blanked out. It
    // must be 00279's plus exactly one more seed_starter_sequence call, placed
    // last -- so no board, timestamp or statement moved.
    const skeleton = (fn: string) => norm(stripComments(fn).replace(/\$seq\$[\s\S]*?\$seq\$/g, "$seq$ LIT $seq$"))
    const chatCall = norm("perform public.seed_starter_sequence( p_business_id, $seq$ LIT $seq$::jsonb );")
    const prior = skeleton(FN_279)
    expect(prior.endsWith(" end; $function$")).toBe(true)
    const want = prior.slice(0, -" end; $function$".length) + " " + chatCall + " end; $function$"
    expect(skeleton(FN_281)).toBe(want)

    for (const s of PRIOR_SEQUENCES.filter((x) => x.key !== "camp_clinic_deadline")) {
      expect(literal(SEQUENCES, s.key), s.key).toEqual(s)
    }
  })

  it("carries no status anywhere: seed_starter_sequence writes 'draft' itself, and 00281 does not redefine it", () => {
    for (const s of SEQUENCES) expect(Object.keys(s), s.key).not.toContain("status")
    expect(SQL).not.toMatch(/create or replace function public\.seed_starter_sequence\(/i)
    expect(norm(functionBody(PRIOR_SQL, "seed_starter_sequence"))).toContain("'draft'")
  })

  it("never switches anything on: 'active' appears only in the predicate that finds in-flight runs", () => {
    // 00229's rule: the gate on a sequence reaching the public is a human
    // reading it. The chat follow-up seeds as a draft on every business,
    // the platform's included.
    const statements = SQL.split(";").filter((s) => /'active'/i.test(s))
    expect(statements.length).toBeGreaterThan(0)
    for (const s of statements) expect(norm(s), s).toMatch(/^update public\.sequence_runs /)
    expect(SQL).not.toMatch(/update\s+public\.sequences\s+set[^;]*\bstatus\b/i)
  })
})

describe("00281 -- the chat lead follow-up (static)", () => {
  const chat = () => literal(SEQUENCES, "chat_lead_follow_up")

  it("is triggered by a chat capture, with the spec's name, description, filter and cooldown", () => {
    const { steps: _steps, ...head } = chat()
    const source: ContactEventSource = "ai_chat" // tsc refuses a source no capture path emits
    expect(head).toEqual({
      key: "chat_lead_follow_up",
      name: "Chat Lead Follow-Up",
      description: CHAT_DESCRIPTION,
      trigger_source: source,
      trigger_filter: {},
      reenrol_cooldown_days: 30,
    })
  })

  it("is exactly the spec's seven steps: alert, email, wait 2 days, email, wait 1 day, text, stop", () => {
    expect(chat().steps.map((s) => s.kind)).toEqual(["alert", "email", "wait", "email", "wait", "sms", "stop"])
    expect(chat().steps).toEqual(CHAT_STEPS)
  })

  it("tells the coach FIRST -- the only thing that makes 'someone has your details now' true", () => {
    expect(chat().steps[0].kind).toBe("alert")
  })

  it("keeps its text plain ASCII, free of merge fields and STOP, and one segment with the opt-out appended", () => {
    const texts = chat().steps.filter((s) => s.kind === "sms")
    expect(texts).toHaveLength(1)
    const body = texts[0].body!
    expect(/^[\x20-\x7E]*$/.test(body), JSON.stringify(body)).toBe(true)
    expect(body).not.toContain("{{")
    expect(body).not.toMatch(/stop/i)
    expect(body).not.toContain(SMS_OPT_OUT_SENTENCE)
    const { text } = renderSequenceSms({ body, contactName: null })
    // The append is asserted, not assumed: the body alone fits one segment too.
    expect(text).toContain(SMS_OPT_OUT_SENTENCE)
    const counted = countSmsSegments(text)
    expect(counted.encoding).toBe("GSM-7")
    expect(counted.segments, `renders to ${counted.characters} chars`).toBe(1)
  })

  it("puts its text behind a wait, so the daily cap cannot push it to the next morning (00272)", () => {
    const steps = chat().steps
    steps.forEach((s, i) => {
      if (s.kind === "sms") expect(steps[i - 1]?.kind, `text at ${i}`).toBe("wait")
    })
  })

  it("greets the lead by first name in both emails", () => {
    for (const s of chat().steps.filter((x) => x.kind === "email"))
      expect(s.body!.startsWith("Hi {{first_name}}\n")).toBe(true)
  })
})

describe("00281 -- the camp countdown in the starter set (static)", () => {
  const camp = () => literal(SEQUENCES, "camp_clinic_deadline")

  it("is 00279's camp with the new email and the 1-day wait spliced in before the approved last email", () => {
    expect(camp()).toEqual(expectedCamp())
  })

  it("ends wait 3 days before, 'Three days to go', wait 1 day before, the approved last email, stop", () => {
    const priorLast = literal(PRIOR_SEQUENCES, "camp_clinic_deadline").steps.at(-2)!
    expect(priorLast.subject).toBe("Last one about this")
    expect(camp().steps.slice(-5)).toEqual([
      { kind: "wait", config: { wait_until: { days_before_anchor: 3 } } },
      { kind: "email", subject: THREE_DAYS_SUBJECT, body: THREE_DAYS_BODY },
      { kind: "wait", config: { wait_until: { days_before_anchor: 1 } } },
      priorLast,
      { kind: "stop" },
    ])
    expect(camp().steps).toHaveLength(12)
  })

  it("gives the anchored wait no minutes: it says WHEN, not how long (00268)", () => {
    const wait = camp().steps.at(-3)!
    expect(wait.wait_minutes).toBeUndefined()
  })

  it("tells the coach the truth about it: four reminders, not three", () => {
    expect(camp().description).toContain(STARTER_CAMP_CLAUSE_TO)
    expect(camp().description).not.toContain(STARTER_CAMP_CLAUSE_FROM)
  })
})

describe("00281 -- every starter literal still passes the product's own rules (static)", () => {
  it("passes the step editor's own validation", () => {
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

  it("names no brand, product, vendor or link", () => {
    for (const s of [literal(SEQUENCES, "chat_lead_follow_up"), literal(SEQUENCES, "camp_clinic_deadline")]) {
      const texts = [s.name, s.description, ...s.steps.flatMap((st) => [st.subject ?? "", st.body ?? ""])]
      for (const text of texts) {
        for (const re of [...FORBIDDEN, ...ALSO_FORBIDDEN]) expect(text, `${s.key}: ${re}`).not.toMatch(re)
      }
    }
    for (const re of FORBIDDEN) expect(RAW, `the migration file: ${re}`).not.toMatch(re)
  })
})

// ---------------------------------------------------------------------------
// The conversion of EXISTING camp sequences.
// ---------------------------------------------------------------------------

/** The DO block that converts existing camp sequences, quoted with its own tag so it can be found exactly. */
function conversionBlock(): string {
  const m = RAW.match(/DO \$convert\$[\s\S]*?\$convert\$;/)
  if (!m) throw new Error("no DO $convert$ ... $convert$; block")
  return m[0]
}

/** A `name CONSTANT text := E'...'` or `'...'` literal from the conversion block, un-escaped the way Postgres reads it. */
function constant(name: string): string {
  const m = conversionBlock().match(
    new RegExp(`\\b${name}\\s+CONSTANT\\s+text\\s*:=\\s*(E?)'((?:[^'\\\\]|''|\\\\.)*)'`),
  )
  if (!m) throw new Error(`no constant ${name}`)
  const [, e, body] = m
  const unq = body.replaceAll("''", "'")
  return e ? unq.replace(/\\n/g, "\n").replace(/\\(.)/g, "$1") : unq
}

describe("00281 -- converting the camp sequences that already exist (static)", () => {
  const block = () => stripComments(conversionBlock())

  it("inserts the SAME new email the starter set gives a new business", () => {
    expect(constant("three_days_subject")).toBe(THREE_DAYS_SUBJECT)
    expect(constant("three_days_body")).toBe(THREE_DAYS_BODY)
  })

  it("rewrites only the two known description clauses, to the same new wording", () => {
    expect(constant("starter_clause_from")).toBe(STARTER_CAMP_CLAUSE_FROM)
    expect(constant("starter_clause_to")).toBe(STARTER_CAMP_CLAUSE_TO)
    expect(constant("platform_clause_from")).toBe(PLATFORM_CAMP_CLAUSE_FROM)
    expect(constant("platform_clause_to")).toBe(PLATFORM_CAMP_CLAUSE_TO)
  })

  it("keys on the sequence KEY, never an id read off one database, and never names the platform", () => {
    expect(block()).toMatch(/WHERE s\.key = 'camp_clinic_deadline'/)
    expect(RAW).not.toMatch(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i)
  })

  it("recognises the shape by structure: the 3-day wait / email / stop tail, and no 1-day wait yet", () => {
    const b = block()
    expect(b).toContain("'days_before_anchor' = '3'")
    expect(b).toContain("'days_before_anchor' = '1'")
    expect(b).toMatch(/kind = 'stop'/)
    // Anything else is skipped with a NOTICE, never an exception: one tenant's
    // edited copy must not block the conversion for everybody else.
    expect((b.match(/RAISE NOTICE/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect((b.match(/\bCONTINUE;/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it("moves the existing rows through the +1000 park, and deletes nothing", () => {
    expect(block()).toMatch(/SET position = position \+ 1000/)
    expect(block()).not.toMatch(/\bDELETE\b/i)
  })

  it("moves in-flight runs that are past the 3-day email two slots later, and only active ones", () => {
    const runMoves = block()
      .split(";")
      .filter((s) => /UPDATE public\.sequence_runs/i.test(s))
      .map(norm)
    expect(runMoves).toEqual([
      "update public.sequence_runs set current_position = current_position + 2, updated_at = now() where sequence_id = seq.id and status = 'active' and current_position >= p + 2",
    ])
  })

  it("names business_id in every insert", () => {
    const inserts = [...SQL.matchAll(/insert into public\.(\w+)\s*\(([^)]*)\)/gi)]
    expect(inserts.length).toBe(2)
    for (const m of inserts) {
      expect(m[1]).toBe("sequence_steps")
      expect(m[2]).toMatch(/\bbusiness_id\b/)
    }
  })

  it("verifies only what it converted, and does not fail a re-run that converts nothing", () => {
    const b = block()
    expect(b).toMatch(/= ANY \(converted_ids\)/)
    expect(b).toMatch(/RAISE EXCEPTION/)
    // A re-run finds every copy already converted. That must be a no-op, not an
    // error -- unlike 00272, whose "converted nothing" exception made it
    // unrepeatable.
    expect(b).not.toMatch(/cardinality\(converted_ids\)\s*=\s*0\s*THEN\s*RAISE EXCEPTION/i)
  })
})

describe("00281 -- grants and backfill (static)", () => {
  it("restates seed_business_starter_set's grants exactly as 00279 section 5 does", () => {
    const sql = norm(SQL)
    expect(sql).toContain("revoke all on function public.seed_business_starter_set(uuid) from public;")
    expect(sql).toContain("revoke execute on function public.seed_business_starter_set(uuid) from anon, authenticated;")
    expect(sql).not.toMatch(/grant [^;]* to [^;]*\b(anon|authenticated|public)\b/)
  })

  it("defines no other function, so there is no other grant to restate", () => {
    expect([...SQL.matchAll(/create or replace function public\.(\w+)/gi)].map((m) => m[1])).toEqual([
      "seed_business_starter_set",
    ])
  })

  it("backfills every business, keyed on absence inside the helper, never on a list of ids", () => {
    expect(norm(SQL)).toMatch(
      /for b in select id from public\.businesses loop perform public\.seed_business_starter_set\(b\.id\); end loop;/,
    )
  })
})

// ---------------------------------------------------------------------------
// THE LIVE HALF, on the dev clone only. Each block creates its own throwaway
// business through create_business (no creator, as a system-created business
// would be) and deletes it afterwards; every table involved cascades from
// businesses. Nothing here writes to any other business.
// ---------------------------------------------------------------------------
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const token = process.env.SUPABASE_ACCESS_TOKEN
const DEV_REF = "anjvztjiokcgiyhobknq"
const describeIf = url && key ? describe : describe.skip
// The conversion is re-run through the Management API, the same path the
// migration itself reaches the clone by, so it also needs the access token.
const describeConvertIf = url && key && token ? describe : describe.skip

async function throwawayBusiness(db: SupabaseClient, name: string, slug: string): Promise<string> {
  const { data, error } = await db.rpc("create_business", {
    // Sorts LAST in allBusinesses() (lib/tenancy/resolve.ts orders by name),
    // so it never becomes a cookie-less dev session's default tenant.
    p_name: name,
    p_slug: `${slug}-${Date.now()}`,
    p_timezone: "UTC",
    p_host_display_name: "Test Coach",
    p_host_email: "",
    p_created_by: null,
  })
  if (error) throw new Error(`create_business: ${error.message}`)
  return (Array.isArray(data) ? data[0] : data).id
}

type LiveStep = {
  id: string
  business_id: string
  position: number
  kind: string
  wait_minutes: number | null
  subject: string | null
  body: string | null
  config: Record<string, unknown>
}

async function stepsOf(db: SupabaseClient, sequenceId: string): Promise<LiveStep[]> {
  const { data, error } = await db
    .from("sequence_steps")
    .select("id, business_id, position, kind, wait_minutes, subject, body, config")
    .eq("sequence_id", sequenceId)
    .order("position", { ascending: true })
  if (error) throw new Error(error.message)
  return data as LiveStep[]
}

/** What a stored step says, in the literal's own shape, so it compares with `toEqual`. */
function asLiteral(s: LiveStep): StepLiteral {
  const out: StepLiteral = { kind: s.kind }
  if (s.wait_minutes !== null) out.wait_minutes = s.wait_minutes
  if (s.subject !== null) out.subject = s.subject
  if (s.body !== null) out.body = s.body
  if (Object.keys(s.config ?? {}).length > 0) out.config = s.config
  return out
}

describeIf("00281 on the dev clone -- a new business starts with the chat follow-up and the 14/7/3/1 camp", () => {
  let db: SupabaseClient
  let businessId: string

  beforeAll(async () => {
    expect(url, "refusing to run against anything but the dev clone").toContain(DEV_REF)
    db = createClient(url!, key!)
    businessId = await throwawayBusiness(db, "zz G18 chat follow-up test (throwaway)", "g18-chat")
  })

  afterAll(async () => {
    if (!businessId) return
    const { error } = await db.from("businesses").delete().eq("id", businessId)
    if (error) console.error(`[00281 live] could not delete the throwaway business ${businessId}: ${error.message}`)
  })

  it("gives it the twelve starter sequences, chat_lead_follow_up among them, every one a draft", async () => {
    const { data, error } = await db.from("sequences").select("key, status").eq("business_id", businessId)
    if (error) throw new Error(error.message)
    expect(data!.map((s) => s.key).sort()).toEqual(SEQUENCES.map((s) => s.key).sort())
    expect(data!).toHaveLength(12)
    expect(new Set(data!.map((s) => s.status))).toEqual(new Set(["draft"]))
  })

  it("seeds the chat follow-up's seven steps exactly as the file says, filed under the new business", async () => {
    const { data: seq, error } = await db
      .from("sequences")
      .select("id, name, description, trigger_source, trigger_filter, reenrol_cooldown_days")
      .eq("business_id", businessId)
      .eq("key", "chat_lead_follow_up")
      .single()
    if (error) throw new Error(error.message)
    expect(seq).toMatchObject({
      name: "Chat Lead Follow-Up",
      description: CHAT_DESCRIPTION,
      trigger_source: "ai_chat",
      trigger_filter: {},
      reenrol_cooldown_days: 30,
    })
    const steps = await stepsOf(db, seq!.id)
    expect(steps.map(asLiteral)).toEqual(CHAT_STEPS)
    expect(steps.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(new Set(steps.map((s) => s.business_id))).toEqual(new Set([businessId]))
  })

  it("seeds the camp sequence in the new shape: twelve steps, the approved email last, one day before", async () => {
    const { data: seq, error } = await db
      .from("sequences")
      .select("id, description")
      .eq("business_id", businessId)
      .eq("key", "camp_clinic_deadline")
      .single()
    if (error) throw new Error(error.message)
    expect(seq!.description).toBe(expectedCamp().description)
    const steps = await stepsOf(db, seq!.id)
    expect(steps.map(asLiteral)).toEqual(expectedCamp().steps)
    expect(steps.map((s) => s.position)).toEqual([...Array(12).keys()])
  })

  it("the backfill gave EVERY business on the clone one chat follow-up", async () => {
    const { data: businesses, error: bErr } = await db.from("businesses").select("id")
    if (bErr) throw new Error(bErr.message)
    const { data: chats, error } = await db.from("sequences").select("business_id").eq("key", "chat_lead_follow_up")
    if (error) throw new Error(error.message)
    expect(chats!.map((c) => c.business_id).sort()).toEqual(businesses!.map((b) => b.id).sort())
  })
})

describeConvertIf(
  "00281's conversion on the dev clone -- people partway through, shapes it does not know, a second run",
  () => {
    let db: SupabaseClient
    let businessId: string
    let campId: string
    const contacts: string[] = []
    const OLD = literal(PRIOR_SEQUENCES, "camp_clinic_deadline")
    const p = OLD.steps.length - 3 // the 3-day wait, 7 in the seeded shape

    /** Replace the throwaway camp's steps (and runs) with `steps`, and its description with 00279's. */
    async function setCamp(steps: StepLiteral[]) {
      const del = await db.from("sequence_runs").delete().eq("sequence_id", campId).eq("business_id", businessId)
      if (del.error) throw new Error(del.error.message)
      const delSteps = await db.from("sequence_steps").delete().eq("sequence_id", campId).eq("business_id", businessId)
      if (delSteps.error) throw new Error(delSteps.error.message)
      const { error } = await db.from("sequence_steps").insert(
        steps.map((s, i) => ({
          business_id: businessId,
          sequence_id: campId,
          position: i,
          kind: s.kind,
          wait_minutes: s.wait_minutes ?? null,
          subject: s.subject ?? null,
          body: s.body ?? null,
          config: s.config ?? {},
        })),
      )
      if (error) throw new Error(error.message)
      const upd = await db
        .from("sequences")
        .update({ description: OLD.description })
        .eq("id", campId)
        .eq("business_id", businessId)
      if (upd.error) throw new Error(upd.error.message)
    }

    async function addRun(
      contactIndex: number,
      position: number,
      status: "active" | "completed" = "active",
    ): Promise<string> {
      const { data, error } = await db
        .from("sequence_runs")
        .insert({
          business_id: businessId,
          sequence_id: campId,
          contact_id: contacts[contactIndex],
          current_position: position,
          status,
          ...(status === "completed" ? { completed_at: new Date().toISOString() } : {}),
        })
        .select("id")
        .single()
      if (error) throw new Error(error.message)
      return data!.id
    }

    async function runPositions(): Promise<Record<string, number>> {
      const { data, error } = await db.from("sequence_runs").select("id, current_position").eq("sequence_id", campId)
      if (error) throw new Error(error.message)
      return Object.fromEntries(data!.map((r) => [r.id, r.current_position]))
    }

    async function description(): Promise<string> {
      const { data, error } = await db.from("sequences").select("description").eq("id", campId).single()
      if (error) throw new Error(error.message)
      return data!.description
    }

    /**
     * The migration's own DO block, read from the FILE (so a mutant in it is what
     * runs), narrowed to the throwaway business so it can never touch another
     * tenant's rows -- not even when a mutant has removed a guard.
     */
    async function runConversion() {
      const loopPredicate = "WHERE s.key = 'camp_clinic_deadline'"
      const block = conversionBlock()
      expect(block.split(loopPredicate), "the loop predicate to narrow").toHaveLength(2)
      const scoped = block.replace(loopPredicate, `${loopPredicate} AND s.business_id = '${businessId}'`)
      const res = await fetch(`https://api.supabase.com/v1/projects/${DEV_REF}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: scoped }),
      })
      if (!res.ok) throw new Error(`the conversion block failed: HTTP ${res.status}: ${await res.text()}`)
    }

    beforeAll(async () => {
      expect(url, "refusing to run against anything but the dev clone").toContain(DEV_REF)
      db = createClient(url!, key!)
      businessId = await throwawayBusiness(db, "zz G11 camp conversion test (throwaway)", "g11-camp")
      const { data: seq, error } = await db
        .from("sequences")
        .select("id")
        .eq("business_id", businessId)
        .eq("key", "camp_clinic_deadline")
        .single()
      if (error) throw new Error(error.message)
      campId = seq!.id
      const stamp = Date.now()
      for (const tag of ["at-p", "at-p1", "at-p2", "finished"]) {
        const { data, error: cErr } = await db
          .from("contacts")
          .insert({ business_id: businessId, email: `zz-00281-${tag}-${stamp}@example.invalid` })
          .select("id")
          .single()
        if (cErr) throw new Error(cErr.message)
        contacts.push(data!.id)
      }
    })

    afterAll(async () => {
      if (!businessId) return
      const { error } = await db.from("businesses").delete().eq("id", businessId)
      if (error) console.error(`[00281 live] could not delete the throwaway business ${businessId}: ${error.message}`)
    })

    let converted: LiveStep[] = []
    let convertedRuns: Record<string, number> = {}

    it("converts the old shape, keeps the moved rows' ids, and moves only the run that already had the last email", async () => {
      await setCamp(OLD.steps)
      const before = await stepsOf(db, campId)
      expect(before.map(asLiteral)).toEqual(OLD.steps)
      const atP = await addRun(0, p) // waiting for the 3-day moment
      const atP1 = await addRun(1, p + 1) // due "Last one about this" at the 3-day moment
      const atP2 = await addRun(2, p + 2) // has HAD "Last one about this", about to stop
      const finished = await addRun(3, p + 2, "completed") // a finished run's position is history

      await runConversion()

      converted = await stepsOf(db, campId)
      expect(converted.map(asLiteral)).toEqual(expectedCamp().steps)
      expect(converted.map((s) => s.position)).toEqual([...Array(12).keys()])
      expect(new Set(converted.map((s) => s.business_id))).toEqual(new Set([businessId]))
      // Existing rows keep their ids: 0..p where they were, the email and the
      // stop two slots later. Only the two rows in between are new.
      const idAt = (list: LiveStep[], pos: number) => list.find((s) => s.position === pos)!.id
      for (let i = 0; i <= p; i++) expect(idAt(converted, i), `position ${i}`).toBe(idAt(before, i))
      expect(idAt(converted, p + 3)).toBe(idAt(before, p + 1))
      expect(idAt(converted, p + 4)).toBe(idAt(before, p + 2))
      const beforeIds = new Set(before.map((s) => s.id))
      expect(beforeIds.has(idAt(converted, p + 1))).toBe(false)
      expect(beforeIds.has(idAt(converted, p + 2))).toBe(false)

      convertedRuns = await runPositions()
      expect(convertedRuns).toEqual({
        [atP]: p, // untouched
        [atP1]: p + 1, // now the NEW "Three days to go"
        [atP2]: p + 4, // the stop again -- never "Last one about this" twice
        [finished]: p + 2, // not active, not moved
      })
      expect(converted[p + 1].subject).toBe(THREE_DAYS_SUBJECT)
      expect(converted[p + 3].subject).toBe("Last one about this")

      expect(await description()).toBe(expectedCamp().description)
    })

    it("changes nothing when it runs again", async () => {
      await runConversion()
      expect(await stepsOf(db, campId)).toEqual(converted)
      expect(await runPositions()).toEqual(convertedRuns)
      expect(await description()).toBe(expectedCamp().description)
    })

    it("skips a copy whose last reminder a coach moved to another day, and leaves its runs alone", async () => {
      const edited = OLD.steps.map((s, i) =>
        i === p ? { kind: "wait", config: { wait_until: { days_before_anchor: 2 } } } : s,
      )
      await setCamp(edited)
      const before = await stepsOf(db, campId)
      const run = await addRun(2, p + 2)

      await runConversion()

      expect(await stepsOf(db, campId)).toEqual(before)
      expect(await runPositions()).toEqual({ [run]: p + 2 })
      expect(await description()).toBe(OLD.description)
    })

    it("skips a copy that already carries a 1-day reminder of its own", async () => {
      const edited = OLD.steps.map((s, i) =>
        i === 3 ? { kind: "wait", config: { wait_until: { days_before_anchor: 1 } } } : s,
      )
      await setCamp(edited)
      const before = await stepsOf(db, campId)

      await runConversion()

      expect(await stepsOf(db, campId)).toEqual(before)
      expect(await description()).toBe(OLD.description)
    })

    it("skips a copy with a step after the stop, rather than reading the wrong three as its tail", async () => {
      await setCamp([
        ...OLD.steps,
        { kind: "email", subject: "Added by the coach", body: "Hi {{first_name}}\n\nOne more." },
      ])
      const before = await stepsOf(db, campId)

      await runConversion()

      expect(await stepsOf(db, campId)).toEqual(before)
    })
  },
)
