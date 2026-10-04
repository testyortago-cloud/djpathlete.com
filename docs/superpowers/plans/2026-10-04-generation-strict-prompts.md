# Strict, Non-Hallucinating Program Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate Week / Generate Day invent nothing — no sport, number, exercise name or muscle the inputs don't support — and every prompt rule has its data, has no contradiction, and is checked by code.

**Architecture:** Phase 1 only (phase 2 gets its own plan after Task 11's numbers). New small pure modules (`athlete-context.ts`, `note-guard.ts`, `slot-normalize.ts`, `slot-fit.ts`) are unit-tested, then wired into `week-orchestrator.ts` (main path) and `orchestrator.ts` (shared pieces only). Prompt text is edited last, so the replay comparison isolates code fixes from wording fixes where possible.

**Tech Stack:** TypeScript, Firebase Functions (`functions/`, Vitest), Next.js admin UI (root, Vitest + Testing Library), Zod 4, OpenRouter (GPT-6.1 Sol architect/selector).

**Spec:** `docs/superpowers/specs/2026-10-04-generation-strict-prompts-design.md` (source review: `docs/superpowers/reports/2026-10-04-program-generation-prompt-review.md`).

## Global Constraints

- Work in a worktree: `.claude/worktrees/generation-strict-prompts`, created with `EnterWorktree name: generation-strict-prompts` BEFORE any task (memory: worktrees live there; entering mid-run breaks agents). Copy `.env.local` and run `npm ci` in root and `functions/` inside it.
- Node 24 for every tool: `NODE=/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin/node`. The shell default is Node 20 and Vitest refuses it.
- Functions tests: `cd functions && $NODE node_modules/vitest/vitest.mjs run <files>`. Root tests: `$NODE node_modules/vitest/vitest.mjs run <files>`.
- Run tests BY FILE: the files you wrote/edited plus existing suites that import a changed module (find with `git grep -l "<module>" -- functions/src/**/__tests__ __tests__`). Never a whole test directory, never the full suite.
- `functions/` cannot import from `lib/` (rootDir `src`). All new modules live in `functions/src/ai/`.
- No commit carries `Co-Authored-By: Claude` or any AI attribution (owner rule, overrides the harness).
- Never stage `JOURNAL.md`. Never push or deploy; the owner gives the go-ahead.
- Formatting: root prettier only (`npx prettier --write <file>`); `npx --prefix functions prettier` uses a different width and reflows untouched lines. Check `git diff --stat` after formatting.
- Rotation of main lifts stays weekly (owner decision). Poor fits are filled and flagged, never rebuilt. Notes are cues only.
- `ignore_profile` / no-profile difficulty default: profile level, else `"advanced"` under ignore_profile, else `"intermediate"` — in both orchestrators.

## Review Focus

1. A note that is entirely prescription ("3 sets of 8. Rest 90 seconds.") must save as `null`, not `""` — Task 3 pins it.
2. A pickleball athlete's note mentioning "tennis" is stripped, but "squeeze a tennis ball" survives — Task 3 pins both.
3. A slot whose every target muscle is unknown keeps a non-empty `target_muscles` (schema `min(1)`; the selector's overlap match needs something) — Task 4 pins it.
4. `per_side: true` on reps that already say "each leg" must not become "8 each leg each side" — Task 5 pins it.
5. A poor-fit list on a run with NO coach instructions still renders (the instruction panel hides itself then) — Task 7 pins it.

---

### Task 0: Worktree, replay scorer, targets and baseline

Measures today's behaviour before anything changes. Product code is untouched in this task.

**Files:**
- Create: `scripts/lib/score-generation.ts`
- Create: `__tests__/scripts/score-generation.test.ts` (root Vitest only includes `__tests__/**/*.test.{ts,tsx}`)
- Create: `scripts/list-replay-candidates.ts`
- Modify: `scripts/replay-week-generation.ts` (score rows before cleanup; record `slot_fit` when present)

**Interfaces:**
- Produces: `scoreRows(rows: Array<{ notes: string | null }>, athleteSport: string | null): { rows: number; notes_foreign_sport: number; notes_prescription: number; samples: string[] }`

- [ ] **Step 1: Enter the worktree and install**

```bash
# via the EnterWorktree tool: name "generation-strict-prompts"
cp "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.env.local" .env.local
PATH=/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH npm ci && (cd functions && PATH=/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH npm ci)
mkdir -p docs/superpowers/specs docs/superpowers/plans docs/superpowers/reports
cp "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/docs/superpowers/specs/2026-10-04-generation-strict-prompts-design.md" docs/superpowers/specs/
cp "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/docs/superpowers/plans/2026-10-04-generation-strict-prompts.md" docs/superpowers/plans/
cp "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/docs/superpowers/reports/2026-10-04-program-generation-prompt-review.md" docs/superpowers/reports/
git add docs/superpowers && git commit -m "docs: strict generation prompts — review, spec and plan"
```

- [ ] **Step 2: Write the failing scorer test**

```ts
import { describe, it, expect } from "vitest"
import { scoreRows } from "../../scripts/lib/score-generation"

describe("scoreRows", () => {
  it("counts notes naming a sport the athlete does not play", () => {
    const s = scoreRows(
      [{ notes: "Land soft like a tennis player." }, { notes: "Brace before each rep." }, { notes: null }],
      "pickleball",
    )
    expect(s.notes_foreign_sport).toBe(1)
    expect(s.rows).toBe(3)
  })
  it("does not count the athlete's own sport, or a tennis ball", () => {
    const s = scoreRows([{ notes: "Think of your tennis serve." }, { notes: "Squeeze a tennis ball." }], "tennis")
    expect(s.notes_foreign_sport).toBe(0)
    expect(scoreRows([{ notes: "Squeeze a tennis ball." }], null).notes_foreign_sport).toBe(0)
  })
  it("counts notes that state sets, reps, rest, RPE, % or per-side counts", () => {
    const s = scoreRows(
      [
        { notes: "2 sets of 4; rest 90 seconds." },
        { notes: "6 each side." },
        { notes: "Work at 80%." },
        { notes: "Stay at RPE 7." },
        { notes: "Lower over 3 seconds." },
      ],
      null,
    )
    expect(s.notes_prescription).toBe(4)
  })
})
```

- [ ] **Step 3: Run it — expect FAIL (module not found)**

Run: `$NODE node_modules/vitest/vitest.mjs run __tests__/scripts/score-generation.test.ts`

- [ ] **Step 4: Implement `scripts/lib/score-generation.ts`**

```ts
/**
 * Scores the rows a generation saved, for before/after replay comparison
 * (2026-10-04 strict-prompts work). Deliberately its own regexes, not
 * functions/src/ai/note-guard.ts: a scorer that shares the fixer's patterns
 * cannot see the fixer's misses.
 */
const SPORT_RE =
  /\b(tennis|pickleball|padel|golf|soccer|football|basketball|lacrosse|baseball|softball|cricket|volleyball|hockey|rugby|swimming)\b/gi
const PRESCRIPTION_RE =
  /\b\d+\s*(?:sets?|reps?|repetitions?)\b|\b\d+\s*[x×]\s*\d+|\d\s*%|\bRPE\s*\d|\b\d+\s*(?:each|per)\s*(?:side|leg|arm)\b|\brest\b[^.!?]*\d/i

export interface GenerationScore {
  rows: number
  notes_foreign_sport: number
  notes_prescription: number
  samples: string[]
}

export function scoreRows(rows: Array<{ notes: string | null }>, athleteSport: string | null): GenerationScore {
  let foreign = 0
  let prescription = 0
  const samples: string[] = []
  for (const r of rows) {
    const note = r.notes ?? ""
    if (!note) continue
    const sports = [...note.replace(/tennis balls?/gi, "").matchAll(SPORT_RE)].map((m) => m[1].toLowerCase())
    const isForeign = sports.some((s) => s !== athleteSport)
    const isPrescription = PRESCRIPTION_RE.test(note)
    if (isForeign) foreign++
    if (isPrescription) prescription++
    if ((isForeign || isPrescription) && samples.length < 5) samples.push(note.slice(0, 160))
  }
  return { rows: rows.length, notes_foreign_sport: foreign, notes_prescription: prescription, samples }
}
```

- [ ] **Step 5: Run the test — expect PASS.** Then break `isForeign` to `false`, rerun, expect a FAIL, restore (mutant check).

- [ ] **Step 6: Wire the scorer into the replay**

In `scripts/replay-week-generation.ts`, before `// Clean up exactly what this run wrote.`, add:

```ts
  const { scoreRows } = await import("./lib/score-generation")
  const { data: savedRows } = await supabase
    .from("program_exercises")
    .select("notes")
    .eq("program_id", programId)
    .eq("week_number", week)
    .match(day !== undefined ? { day_of_week: day } : {})
  const { data: clientRow } = await supabase.from("client_profiles").select("sport").eq("user_id", clientId).maybeSingle()
  const athleteSport =
    typeof clientRow?.sport === "string" && clientRow.sport.trim() ? clientRow.sport.trim().toLowerCase() : null
  const score = scoreRows((savedRows ?? []) as Array<{ notes: string | null }>, athleteSport)
```

Add to `summary`: `score, slot_fit: (result as { slot_fit?: unknown[] } | null)?.slot_fit?.length ?? null,` and print one line:

```ts
  console.log(
    `  notes: ${score.notes_foreign_sport} foreign-sport, ${score.notes_prescription} prescription (of ${score.rows}); poor fits: ${summary.slot_fit ?? "n/a"}`,
  )
  for (const s of score.samples) console.log(`    · ${s}`)
```

(The sample lines are generated notes on the clone, not prod data.)

- [ ] **Step 7: Write `scripts/list-replay-candidates.ts`** — prints metadata only (memory: replay logs holding prod instruction text are denied as production reads).

```ts
/**
 * Lists recent PROD week/day generation jobs and where each could be replayed
 * on the dev clone. Prints ids, dates, scope and instruction LENGTH only —
 * never the instruction text (that is a production read).
 *   npx tsx scripts/list-replay-candidates.ts [--limit 15]
 */
import { config } from "dotenv"
import path from "node:path"
config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true })
process.env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
if (!process.env.SUPABASE_URL.includes("anjvztjiokcgiyhobknq")) throw new Error("Refusing: not the dev clone")

async function main() {
  const limit = Number(process.argv[process.argv.indexOf("--limit") + 1]) || 15
  const { initializeApp, cert } = await import("firebase-admin/app")
  const { getFirestore } = await import("firebase-admin/firestore")
  const app = initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? "{}")) }, "candidates")
  const snap = await getFirestore(app)
    .collection("ai_jobs")
    .where("type", "==", "week_generation")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get()
  const { getSupabase } = await import("../functions/src/lib/supabase.js")
  const supabase = getSupabase()
  for (const doc of snap.docs) {
    const req = (doc.data().input?.request ?? {}) as Record<string, unknown>
    const programId = String(req.program_id ?? "")
    const { data: rows } = await supabase.from("program_exercises").select("week_number").eq("program_id", programId)
    const { data: asg } = await supabase
      .from("program_assignments")
      .select("id, user_id")
      .eq("program_id", programId)
      .limit(1)
      .maybeSingle()
    const maxWeek = Math.max(0, ...(rows ?? []).map((r: { week_number: number }) => r.week_number))
    console.log(
      [
        doc.id,
        doc.data().createdAt?.toDate?.().toISOString?.() ?? "?",
        req.target_day_of_week ? `day ${req.target_day_of_week}` : "week",
        `instr ${String(req.admin_instructions ?? "").length} chars`,
        `pool ${Array.isArray(req.pool_exercise_ids) ? req.pool_exercise_ids.length : 0}`,
        rows ? `clone program ✓ (max week ${maxWeek}, replay week ${maxWeek + 1})` : "clone program ✗",
        asg ? `client ${asg.user_id} assignment ${asg.id}` : "no clone assignment",
      ].join(" | "),
    )
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
```

If the `ai_jobs` field names differ (`createdAt` / `type`), read one doc's KEYS (not values) with `Object.keys(doc.data())` and adjust.

- [ ] **Step 8: Pick five targets** with instructions > 0 chars and a clone program + assignment, mixing at least 2 day jobs and 2 week jobs. Write them to `tmp/replay-targets.json` (gitignored):

```json
[{ "job": "<id>", "program": "<clone program id>", "client": "<clone user id>", "assignment": "<clone assignment id>", "week": 9, "day": 2, "label": "t1" }]
```

- [ ] **Step 9: Run the baseline sequentially** (product code is still `main`). Open the live view first (owner rule): `pgrep -f live-view.py || python3 ~/.claude/bin/live-view.py --watch &` then `open ~/.claude/live/index.html`.

```bash
$NODE -e '
const t=require("./tmp/replay-targets.json");const {execFileSync}=require("child_process");
for(const x of t){const a=["tsx","scripts/replay-week-generation.ts","--job",x.job,"--program",x.program,"--client",x.client,"--assignment",x.assignment,"--week",String(x.week),"--label","base-"+x.label,"--out","tmp/replays-base.jsonl"];if(x.day)a.push("--day",String(x.day));execFileSync("npx",a,{stdio:"inherit"})}'
```

Expected: five `=== REPLAY base-tN` blocks, each ending `cleaned N rows`. Record the totals (unmet, foreign-sport, prescription, cost, seconds) in the task report.

- [ ] **Step 10: Commit**

```bash
git add scripts/lib/score-generation.ts scripts/list-replay-candidates.ts scripts/replay-week-generation.ts __tests__/scripts/score-generation.test.ts
git commit -m "test(generation): score replay notes for sport and prescription leaks"
```

---

### Task 1: Athlete context module

**Files:**
- Create: `functions/src/ai/athlete-context.ts`
- Test: `functions/src/ai/__tests__/athlete-context.test.ts`

**Interfaces:**
- Produces:
  - `normalizeSport(raw: unknown): string | null`
  - `interface AthleteContext { sport: string | null; experience_level: string | null; movement_confidence: string | null; injury_details: unknown[]; exercise_dislikes: string | null }`
  - `buildAthleteContext(profile: ClientProfileRow | null | undefined): AthleteContext`
  - `resolveClientDifficulty(profile: ClientProfileRow | null | undefined, ignoreProfile: boolean | undefined): string`
  - `buildProfileContext(profile: ClientProfileRow | null | undefined, now?: Date): string | null`
  - `type ClientProfileRow = Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import {
  normalizeSport,
  buildAthleteContext,
  resolveClientDifficulty,
  buildProfileContext,
} from "../athlete-context.js"

describe("normalizeSport", () => {
  it("trims, lowercases and maps the spellings live profiles use", () => {
    expect(normalizeSport("Tennis ")).toBe("tennis")
    expect(normalizeSport("Tenis")).toBe("tennis")
    expect(normalizeSport("Pickle")).toBe("pickleball")
    expect(normalizeSport("  Soccer")).toBe("soccer")
  })
  it("answers null for empty or non-string input", () => {
    expect(normalizeSport("   ")).toBeNull()
    expect(normalizeSport(null)).toBeNull()
    expect(normalizeSport(42)).toBeNull()
  })
})

describe("buildAthleteContext", () => {
  it("carries exactly the fields the selector's rules read", () => {
    expect(
      buildAthleteContext({
        sport: "Tennis ",
        experience_level: "intermediate",
        movement_confidence: "comfortable",
        injury_details: [{ area: "left knee" }],
        exercise_dislikes: "burpees",
        weight_kg: 80,
      }),
    ).toEqual({
      sport: "tennis",
      experience_level: "intermediate",
      movement_confidence: "comfortable",
      injury_details: [{ area: "left knee" }],
      exercise_dislikes: "burpees",
    })
  })
  it("says null / empty instead of guessing when there is no profile", () => {
    expect(buildAthleteContext(null)).toEqual({
      sport: null,
      experience_level: null,
      movement_confidence: null,
      injury_details: [],
      exercise_dislikes: null,
    })
  })
  it("treats a non-array injury_details as no injuries", () => {
    expect(buildAthleteContext({ injury_details: "knee" }).injury_details).toEqual([])
  })
})

describe("resolveClientDifficulty", () => {
  it("uses the profile's level when set", () => {
    expect(resolveClientDifficulty({ experience_level: "beginner" }, true)).toBe("beginner")
  })
  it("is advanced under ignore_profile and intermediate with no profile", () => {
    expect(resolveClientDifficulty(null, true)).toBe("advanced")
    expect(resolveClientDifficulty(null, false)).toBe("intermediate")
    expect(resolveClientDifficulty({ experience_level: "" }, undefined)).toBe("intermediate")
  })
})

describe("buildProfileContext", () => {
  it("is null without a profile", () => {
    expect(buildProfileContext(null)).toBeNull()
  })
  it("includes the fields week/day used to miss, with sport normalised and age computed", () => {
    const json = JSON.parse(
      buildProfileContext(
        { sport: "Pickle", date_of_birth: "2000-06-01", movement_confidence: "learning", exercise_dislikes: "lunges" },
        new Date("2026-10-04T00:00:00Z"),
      )!,
    )
    expect(json.sport).toBe("pickleball")
    expect(json.age).toBe(26)
    expect(json.movement_confidence).toBe("learning")
    expect(json.exercise_dislikes).toBe("lunges")
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`cd functions && $NODE node_modules/vitest/vitest.mjs run src/ai/__tests__/athlete-context.test.ts`)

- [ ] **Step 3: Implement `functions/src/ai/athlete-context.ts`**

```ts
/**
 * What the generation agents are told about the athlete — one builder for the
 * full-program and week/day paths. Before 2026-10-04 week/day sent a thinner
 * profile (no sport, age, movement_confidence, dislikes) and the selector got
 * none of it, while its prompt had rules about every one of those fields: the
 * model either skipped the rule or guessed. Live data showed the guess — "golf"
 * cues for a tennis player, "tennis" cues in programs with no client.
 */

/** A `client_profiles` row as `select("*")` returns it. */
export type ClientProfileRow = Record<string, unknown>

/** Spellings found in live profiles (2026-10-04): "Tennis ", "Tenis", "Pickle". */
const SPORT_ALIASES: Record<string, string> = { tenis: "tennis", pickle: "pickleball" }

export function normalizeSport(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ")
  if (!s) return null
  return SPORT_ALIASES[s] ?? s
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null)

export interface AthleteContext {
  sport: string | null
  experience_level: string | null
  movement_confidence: string | null
  injury_details: unknown[]
  exercise_dislikes: string | null
}

/** The selector's `Constraints.athlete`. null / [] mean "not known" — the prompt says never to assume. */
export function buildAthleteContext(profile: ClientProfileRow | null | undefined): AthleteContext {
  return {
    sport: normalizeSport(profile?.sport),
    experience_level: str(profile?.experience_level),
    movement_confidence: str(profile?.movement_confidence),
    injury_details: Array.isArray(profile?.injury_details) ? (profile!.injury_details as unknown[]) : [],
    exercise_dislikes: str(profile?.exercise_dislikes),
  }
}

/**
 * One default for every filter and prompt. Before 2026-10-04 the week path said
 * "advanced"/"intermediate" and the full path "elite"/"beginner", so the same
 * client got a different library depending on the button pressed.
 */
export function resolveClientDifficulty(
  profile: ClientProfileRow | null | undefined,
  ignoreProfile: boolean | undefined,
): string {
  return str(profile?.experience_level) ?? (ignoreProfile ? "advanced" : "intermediate")
}

function ageFrom(dob: unknown, now: Date): number | null {
  if (typeof dob !== "string") return null
  const d = new Date(dob)
  if (isNaN(d.getTime())) return null
  return now.getFullYear() - d.getFullYear()
}

/** The planning agents' "Client Profile" JSON, or null when there is no profile (callers word that case). */
export function buildProfileContext(profile: ClientProfileRow | null | undefined, now = new Date()): string | null {
  if (!profile) return null
  return JSON.stringify({
    goals: profile.goals,
    sport: normalizeSport(profile.sport),
    gender: profile.gender,
    age: ageFrom(profile.date_of_birth, now),
    experience_level: profile.experience_level,
    movement_confidence: profile.movement_confidence,
    sleep_hours: profile.sleep_hours,
    stress_level: profile.stress_level,
    occupation_activity_level: profile.occupation_activity_level,
    training_years: profile.training_years,
    injuries: profile.injuries,
    injury_details: profile.injury_details,
    available_equipment: profile.available_equipment,
    preferred_session_minutes: profile.preferred_session_minutes,
    preferred_training_days: profile.preferred_training_days,
    preferred_day_names: profile.preferred_day_names,
    preferred_techniques: profile.preferred_techniques,
    time_efficiency_preference: profile.time_efficiency_preference,
    height_cm: profile.height_cm,
    weight_kg: profile.weight_kg,
    exercise_likes: profile.exercise_likes,
    exercise_dislikes: profile.exercise_dislikes,
    training_background: profile.training_background,
    additional_notes: profile.additional_notes,
  })
}
```

(The field list is the full orchestrator's, `orchestrator.ts:385-411`, minus the raw `date_of_birth`, which `age` replaces.)

- [ ] **Step 4: Run — expect PASS.** Mutant: change the `ignoreProfile ? "advanced"` to `"intermediate"` → a test must fail; restore.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/athlete-context.ts functions/src/ai/__tests__/athlete-context.test.ts
git commit -m "feat(ai): one athlete/profile context builder for every generation path"
```

---

### Task 2: Assignment schema — `fit`, `fit_reason`, `per_side`

**Files:**
- Modify: `functions/src/ai/schemas.ts:146-151` (`assignedExerciseSchema`)
- Modify: `functions/src/ai/types.ts:124-129` (`AssignedExercise`)
- Test: `functions/src/ai/__tests__/schemas.test.ts` (append)

**Interfaces:**
- Produces: `AssignedExercise` gains `per_side?: boolean; fit?: "exact" | "close" | "poor"; fit_reason?: string | null`. Parsed values default to `false`, `"close"`, `null`.

- [ ] **Step 1: Append the failing test to `schemas.test.ts`**

```ts
import { exerciseAssignmentSchema } from "../schemas.js"

describe("exerciseAssignmentSchema fit and per_side", () => {
  it("defaults the new fields so an older-shaped answer still parses", () => {
    const parsed = exerciseAssignmentSchema.parse({
      assignments: [{ slot_id: "w1d1s1", exercise_id: "e", exercise_name: "Squat", notes: null }],
      substitution_notes: [],
    })
    expect(parsed.assignments[0]).toMatchObject({ per_side: false, fit: "close", fit_reason: null })
  })
  it("keeps what the model sent", () => {
    const parsed = exerciseAssignmentSchema.parse({
      assignments: [
        { slot_id: "s", exercise_id: "e", exercise_name: "n", notes: null, per_side: true, fit: "poor", fit_reason: "no squat left" },
      ],
      substitution_notes: [],
    })
    expect(parsed.assignments[0]).toMatchObject({ per_side: true, fit: "poor", fit_reason: "no squat left" })
  })
  it("rejects an unknown fit label", () => {
    expect(() =>
      exerciseAssignmentSchema.parse({
        assignments: [{ slot_id: "s", exercise_id: "e", exercise_name: "n", notes: null, fit: "great" }],
        substitution_notes: [],
      }),
    ).toThrow()
  })
})
```

(Merge the import into the file's existing import line if `exerciseAssignmentSchema` is already imported.)

- [ ] **Step 2: Run — expect FAIL** (`... run src/ai/__tests__/schemas.test.ts`)

- [ ] **Step 3: Implement**

`schemas.ts`:

```ts
const assignedExerciseSchema = z.object({
  slot_id: z.string(),
  exercise_id: z.string(),
  exercise_name: z.string(),
  notes: z.string().nullable(),
  // 2026-10-04: unilateral counts go here, not into the note ("6 each side"
  // in a note contradicted reps "6"). buildExerciseRows appends "each side".
  per_side: z.boolean().optional().default(false),
  // The model's own honesty channel. Code re-checks it (slot-fit.ts): a
  // pattern mismatch is "poor" whatever the label says.
  fit: z.enum(["exact", "close", "poor"]).optional().default("close"),
  fit_reason: z.string().nullable().optional().default(null),
})
```

`types.ts`:

```ts
export interface AssignedExercise {
  slot_id: string
  exercise_id: string
  exercise_name: string
  notes: string | null
  per_side?: boolean
  fit?: "exact" | "close" | "poor"
  fit_reason?: string | null
}
```

- [ ] **Step 4: Run — expect PASS.** Then `cd functions && $NODE node_modules/typescript/bin/tsc --noEmit` → expect clean.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/schemas.ts functions/src/ai/types.ts functions/src/ai/__tests__/schemas.test.ts
git commit -m "feat(ai): selector reports fit, fit_reason and per_side on every pick"
```

---

### Task 3: Note guard

**Files:**
- Create: `functions/src/ai/note-guard.ts`
- Modify: `functions/src/ai/shared-helpers.ts:780-783` (move `splitSentences` out; import it back)
- Test: `functions/src/ai/__tests__/note-guard.test.ts`

**Interfaces:**
- Produces: `splitSentences(text: string): string[]` (moved, now exported from `note-guard.ts`); `cleanNote(note: string, opts: { athleteSport: string | null }): { text: string | null; stripped: string[] }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { cleanNote } from "../note-guard.js"

const none = { athleteSport: null }

describe("cleanNote — prescription sentences", () => {
  it("drops sets/reps/rest restatements and keeps the cue", () => {
    const r = cleanNote("2 sets of 4; rest 90 seconds. Lower over 4 seconds, then drive up.", none)
    expect(r.text).toBe("Lower over 4 seconds, then drive up.")
    expect(r.stripped).toEqual(["2 sets of 4; rest 90 seconds."])
  })
  it("drops per-side counts, percentages, RPE and NxN", () => {
    expect(cleanNote("6 each side. Keep hips square.", none).text).toBe("Keep hips square.")
    expect(cleanNote("Work at 80% today. Fast bar.", none).text).toBe("Fast bar.")
    expect(cleanNote("Stay at RPE 7. Smooth reps.", none).text).toBe("Smooth reps.")
    expect(cleanNote("Do 3x8. Brace.", none).text).toBe("Brace.")
  })
  it("keeps tempo wording, which is a cue", () => {
    const note = "3 second eccentric, 1 second pause, explode up."
    expect(cleanNote(note, none)).toEqual({ text: note, stripped: [] })
  })
  it("returns null, not an empty string, when every sentence goes", () => {
    expect(cleanNote("3 sets of 8. Rest 90 seconds.", none).text).toBeNull()
  })
})

describe("cleanNote — sport sentences", () => {
  it("drops a sport the athlete does not play (live case: golf cue for a tennis player)", () => {
    const r = cleanNote("Rotate like a golf swing. Stay tall.", { athleteSport: "tennis" })
    expect(r.text).toBe("Stay tall.")
  })
  it("keeps the athlete's own sport", () => {
    const note = "Mimic your tennis split step."
    expect(cleanNote(note, { athleteSport: "tennis" }).text).toBe(note)
  })
  it("drops every sport mention when no sport is known", () => {
    expect(cleanNote("Land soft like a tennis player. Absorb.", none).text).toBe("Absorb.")
  })
  it("keeps a tennis BALL, which is equipment", () => {
    const note = "Squeeze a tennis ball between your knees."
    expect(cleanNote(note, { athleteSport: "pickleball" }).text).toBe(note)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `functions/src/ai/note-guard.ts`**

```ts
/**
 * The last check before an exercise note reaches the athlete (2026-10-04).
 * Notes are cues only: prescription numbers live in their own fields, and a
 * note that restates them can only ever agree or contradict ("6 each side" on
 * reps "6" shipped). A sport the athlete does not play is a hallucination the
 * prompt's examples invited ("golf" cues for a tennis player, "tennis" in
 * programs with no client — both found in live rows).
 */

/** Split on sentence boundaries, keeping the terminator with its sentence. */
export function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text]
}

const PRESCRIPTION_RES: RegExp[] = [
  /\b\d+\s*(?:sets?|reps?|repetitions?)\b/i,
  /\b\d+\s*[x×]\s*\d+/i,
  /\brest\b[^.!?]*\d/i,
  /\d\s*%/,
  /\bRPE\s*\d/i,
  /\b\d+\s*(?:each|per)\s*(?:side|leg|arm)\b/i,
]

const SPORT_RE =
  /\b(tennis|pickleball|padel|golf|soccer|football|basketball|lacrosse|baseball|softball|cricket|volleyball|hockey|rugby|swimming)\b/gi

function namesForeignSport(sentence: string, athleteSport: string | null): boolean {
  const withoutEquipment = sentence.replace(/tennis balls?/gi, "")
  for (const m of withoutEquipment.matchAll(SPORT_RE)) {
    if (m[1].toLowerCase() !== athleteSport) return true
  }
  return false
}

export function cleanNote(note: string, opts: { athleteSport: string | null }): { text: string | null; stripped: string[] } {
  const kept: string[] = []
  const stripped: string[] = []
  for (const sentence of splitSentences(note)) {
    const drop = PRESCRIPTION_RES.some((re) => re.test(sentence)) || namesForeignSport(sentence, opts.athleteSport)
    if (drop) stripped.push(sentence.trim())
    else kept.push(sentence)
  }
  if (stripped.length === 0) return { text: note, stripped }
  const text = kept.join("").replace(/\s{2,}/g, " ").trim()
  return { text: text.length > 0 ? text : null, stripped }
}
```

In `shared-helpers.ts`, delete the local `splitSentences` (lines 780-783) and add `import { splitSentences } from "./note-guard.js"` at the top of the file.

- [ ] **Step 4: Run** `note-guard.test.ts` and `shared-helpers.test.ts` — expect PASS. Mutants: (a) remove the `tennis balls?` replace → the equipment test fails; (b) delete the `RPE` regex → the RPE assertion fails. Restore both.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/note-guard.ts functions/src/ai/shared-helpers.ts functions/src/ai/__tests__/note-guard.test.ts
git commit -m "feat(ai): strip prescription restatements and foreign-sport sentences from client notes"
```

---

### Task 4: Slot normalisation — closed muscle list and number clamps

**Files:**
- Create: `functions/src/ai/slot-normalize.ts`
- Test: `functions/src/ai/__tests__/slot-normalize.test.ts`

**Interfaces:**
- Consumes: `ProgramWeek`, `ExerciseSlot` from `./types.js`
- Produces:
  - `normalizeMuscleName(m: string): string`
  - `muscleVocabulary(library: Array<{ primary_muscles?: string[] | null }>, minUses?: number): string[]`
  - `interface SlotChange { slot_id: string; field: string; from: unknown; to: unknown }`
  - `normalizeSkeletonInPlace(weeks: ProgramWeek[], vocab: string[]): SlotChange[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { muscleVocabulary, normalizeSkeletonInPlace, normalizeMuscleName } from "../slot-normalize.js"
import type { ProgramWeek } from "../types.js"

const VOCAB = ["glutes", "quadriceps", "shoulders", "hamstrings", "core", "obliques", "upper_back", "chest", "lats"]

function week(slot: Record<string, unknown>): ProgramWeek[] {
  return [
    {
      week_number: 1,
      phase: "p",
      intensity_modifier: "moderate",
      days: [
        {
          day_of_week: 1,
          label: "L",
          focus: "f",
          slots: [
            {
              slot_id: "w1d1s1",
              role: "accessory",
              movement_pattern: "squat",
              target_muscles: ["glutes"],
              sets: 3,
              reps: "8",
              rest_seconds: 60,
              rpe_target: 7,
              tempo: null,
              group_tag: null,
              technique: "straight_set",
              intensity_pct: null,
              ...slot,
            },
          ],
        },
      ],
    } as ProgramWeek,
  ]
}

describe("muscleVocabulary", () => {
  it("normalises spelling and keeps values used at least minUses times", () => {
    const lib = [
      { primary_muscles: ["Glutes", "serratus anterior"] },
      { primary_muscles: ["glutes", "serratus_anterior"] },
      { primary_muscles: ["glutes", "serratus anterior", "grip"] },
    ]
    expect(muscleVocabulary(lib, 3).sort()).toEqual(["glutes", "serratus_anterior"])
  })
  it("normalizeMuscleName folds case, spaces and hyphens", () => {
    expect(normalizeMuscleName(" Upper-Back ")).toBe("upper_back")
  })
})

describe("normalizeSkeletonInPlace — muscles", () => {
  it("maps known non-muscle words onto the list and drops unknown ones", () => {
    const w = week({ target_muscles: ["anti-rotation", "Glutes", "vibes"] })
    const changes = normalizeSkeletonInPlace(w, VOCAB)
    expect(w[0].days[0].slots[0].target_muscles).toEqual(["core", "obliques", "glutes"])
    expect(changes.some((c) => c.field === "target_muscles")).toBe(true)
  })
  it("never leaves a slot without muscles — falls back to its pattern's", () => {
    const w = week({ movement_pattern: "hinge", target_muscles: ["cardiovascular"] })
    normalizeSkeletonInPlace(w, VOCAB)
    expect(w[0].days[0].slots[0].target_muscles).toEqual(["hamstrings", "glutes"])
  })
  it("keeps the original list when even the fallback has nothing in the vocabulary", () => {
    const w = week({ movement_pattern: "carry", target_muscles: ["vibes"] })
    normalizeSkeletonInPlace(w, ["glutes"])
    expect(w[0].days[0].slots[0].target_muscles).toEqual(["vibes"])
  })
})

describe("normalizeSkeletonInPlace — numbers", () => {
  it("clamps sets, rest, RPE and intensity_pct and logs each change", () => {
    const w = week({ sets: 3.6, rest_seconds: 900, rpe_target: 11, intensity_pct: 150 })
    const changes = normalizeSkeletonInPlace(w, VOCAB)
    const s = w[0].days[0].slots[0]
    expect([s.sets, s.rest_seconds, s.rpe_target, s.intensity_pct]).toEqual([4, 600, 10, 110])
    expect(changes.map((c) => c.field).sort()).toEqual(["intensity_pct", "rest_seconds", "rpe_target", "sets"])
  })
  it("leaves in-range values alone and reports nothing", () => {
    const w = week({})
    expect(normalizeSkeletonInPlace(w, VOCAB)).toEqual([])
  })
  it("sets a non-finite sets value to 3 and a zero to 1", () => {
    const a = week({ sets: Number.NaN })
    normalizeSkeletonInPlace(a, VOCAB)
    expect(a[0].days[0].slots[0].sets).toBe(3)
    const b = week({ sets: 0 })
    normalizeSkeletonInPlace(b, VOCAB)
    expect(b[0].days[0].slots[0].sets).toBe(1)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `functions/src/ai/slot-normalize.ts`**

```ts
import type { ProgramWeek } from "./types.js"

/**
 * The architect's slots, made checkable (2026-10-04). target_muscles was free
 * text — the prompt's own examples wrote "anti-rotation", "cardiovascular",
 * "single-leg stability" — and the selector was told to match it against the
 * library's primary_muscles, which it cannot. Numbers had no bounds anywhere:
 * 0 sets, RPE 11 and 900 s rest all passed the schema.
 */

export function normalizeMuscleName(m: string): string {
  return m.trim().toLowerCase().replace(/[\s-]+/g, "_")
}

/** Distinct library muscles with at least `minUses` uses. Live library (2026-10-04): 18 main values. */
export function muscleVocabulary(library: Array<{ primary_muscles?: string[] | null }>, minUses = 3): string[] {
  const counts = new Map<string, number>()
  for (const ex of library) for (const m of ex.primary_muscles ?? []) {
    const k = normalizeMuscleName(m)
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, n]) => n >= minUses).map(([m]) => m)
}

/** Words the architect writes that are not library muscles. Applied only when the word is not itself in the list. */
const MUSCLE_ALIASES: Record<string, string[]> = {
  anti_rotation: ["core", "obliques"],
  anti_extension: ["core"],
  anti_lateral_flexion: ["obliques", "core"],
  abs: ["core"],
  rectus_abdominis: ["core"],
  transverse_abdominis: ["core"],
  scapular_stabilizers: ["upper_back"],
  rhomboids: ["upper_back"],
  rotator_cuff: ["shoulders"],
  rear_delts: ["shoulders"],
  delts: ["shoulders"],
  deltoids: ["shoulders"],
  quads: ["quadriceps"],
  hams: ["hamstrings"],
  glute: ["glutes"],
  erectors: ["lower_back"],
  spinal_erectors: ["lower_back"],
  posterior_chain: ["glutes", "hamstrings"],
  single_leg_stability: ["glutes"],
  hip_stabilizers: ["glutes", "abductors"],
  pecs: ["chest"],
  latissimus_dorsi: ["lats"],
}

const PATTERN_DEFAULT_MUSCLES: Record<string, string[]> = {
  squat: ["quadriceps", "glutes"],
  lunge: ["quadriceps", "glutes"],
  hinge: ["hamstrings", "glutes"],
  push: ["chest", "shoulders", "triceps"],
  pull: ["lats", "upper_back", "biceps"],
  carry: ["core", "forearms"],
  rotation: ["obliques", "core"],
  isometric: ["core"],
  locomotion: ["calves", "glutes"],
  conditioning: ["quadriceps", "glutes"],
}

export interface SlotChange {
  slot_id: string
  field: string
  from: unknown
  to: unknown
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function normalizeSkeletonInPlace(weeks: ProgramWeek[], vocab: string[]): SlotChange[] {
  const allowed = new Set(vocab)
  const changes: SlotChange[] = []
  for (const week of weeks) for (const day of week.days) for (const slot of day.slots) {
    const note = (field: string, from: unknown, to: unknown) => changes.push({ slot_id: slot.slot_id, field, from, to })

    // Muscles
    const mapped: string[] = []
    for (const raw of slot.target_muscles ?? []) {
      const m = normalizeMuscleName(raw)
      const out = allowed.has(m) ? [m] : (MUSCLE_ALIASES[m] ?? []).filter((a) => allowed.has(a))
      for (const o of out) if (!mapped.includes(o)) mapped.push(o)
    }
    let muscles = mapped
    if (muscles.length === 0) {
      muscles = (PATTERN_DEFAULT_MUSCLES[slot.movement_pattern] ?? []).filter((a) => allowed.has(a))
    }
    if (muscles.length === 0) muscles = slot.target_muscles // nothing better: keep, never empty
    if (JSON.stringify(muscles) !== JSON.stringify(slot.target_muscles)) {
      note("target_muscles", slot.target_muscles, muscles)
      slot.target_muscles = muscles
    }

    // Numbers
    const sets = Number.isFinite(slot.sets) ? clamp(Math.round(slot.sets), 1, 10) : 3
    if (sets !== slot.sets) (note("sets", slot.sets, sets), (slot.sets = sets))
    const rest = Number.isFinite(slot.rest_seconds) ? clamp(Math.round(slot.rest_seconds), 0, 600) : 90
    if (rest !== slot.rest_seconds) (note("rest_seconds", slot.rest_seconds, rest), (slot.rest_seconds = rest))
    if (slot.rpe_target != null) {
      const rpe = Number.isFinite(slot.rpe_target) ? clamp(slot.rpe_target, 1, 10) : null
      if (rpe !== slot.rpe_target) (note("rpe_target", slot.rpe_target, rpe), (slot.rpe_target = rpe))
    }
    if (slot.intensity_pct != null) {
      const pct = Number.isFinite(slot.intensity_pct) ? clamp(slot.intensity_pct, 30, 110) : null
      if (pct !== slot.intensity_pct) (note("intensity_pct", slot.intensity_pct, pct), (slot.intensity_pct = pct))
    }
  }
  return changes
}
```

If `ExerciseSlot.intensity_pct` is typed `number | null | undefined`, keep the `!= null` guards as written. If prettier rejects the comma-expression style, expand each `if` into a block — behaviour identical.

- [ ] **Step 4: Run — expect PASS.** Mutants: (a) remove the pattern fallback → "never leaves a slot without muscles" fails; (b) change `clamp(..., 1, 10)` for sets to `0, 10` → the zero test fails. Restore.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/slot-normalize.ts functions/src/ai/__tests__/slot-normalize.test.ts
git commit -m "feat(ai): closed muscle vocabulary and number clamps for architect slots"
```

---

### Task 5: Row builder — library names, `per_side`, `intensity_pct`, note guard

**Files:**
- Modify: `functions/src/ai/shared-helpers.ts:640-678` (`SlotDetails`, `buildSlotLookups`), `:802-861` (`sanitizeSlotRefsInNotes`, `buildExerciseRows`)
- Test: `functions/src/ai/__tests__/shared-helpers.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `cleanNote` (Task 3), `AssignedExercise` fields (Task 2)
- Produces:
  - `withSide(reps: string, perSide: boolean | undefined): string`
  - `interface RowBuildOptions { nameById?: Map<string, string>; athleteSport?: string | null; onCleanedNote?: (slotId: string, sentences: string[]) => void }`
  - `buildExerciseRows(assignments, slotLookup, slotDetailsLookup, programId, onStrippedNote?, opts: RowBuildOptions = {})`

- [ ] **Step 1: Append the failing tests** (reuse the file's existing `slotsForWeek()` helper from the "sanitizes internal slot refs" describe by copying it into the new describe — tests may be read out of order)

```ts
describe("buildExerciseRows strict notes (2026-10-04)", () => {
  function weeks(slot: Record<string, unknown> = {}): ProgramWeek[] {
    return [
      {
        week_number: 2,
        phase: "x",
        intensity_modifier: "moderate",
        days: [
          {
            day_of_week: 1,
            label: "Mon",
            focus: "f",
            slots: [1, 2].map((i) => ({
              slot_id: `w2d1s${i}`,
              role: "accessory",
              movement_pattern: "lunge",
              target_muscles: ["glutes"],
              sets: 3,
              reps: "8",
              rest_seconds: 60,
              rpe_target: 7,
              tempo: null,
              group_tag: "A",
              technique: "superset",
              intensity_pct: null,
              ...slot,
            })),
          },
        ],
      } as ProgramWeek,
    ]
  }

  it("names the superset partner from the LIBRARY, not the model's exercise_name", () => {
    const { slotLookup, slotDetailsLookup } = buildSlotLookups(weeks())
    const rows = buildExerciseRows(
      [
        { slot_id: "w2d1s1", exercise_id: "ex-1", exercise_name: "Hip Thrust", notes: "Superset with w2d1s2." },
        { slot_id: "w2d1s2", exercise_id: "ex-2", exercise_name: "Made Up Name", notes: null },
      ],
      slotLookup,
      slotDetailsLookup,
      "p",
      undefined,
      { nameById: new Map([["ex-1", "Hip Thrust"], ["ex-2", "Reverse Lunge"]]) },
    )
    expect(rows[0].notes).toBe("Superset with Reverse Lunge.")
  })

  it("appends 'each side' for per_side picks, once", () => {
    const { slotLookup, slotDetailsLookup } = buildSlotLookups(weeks())
    const rows = buildExerciseRows(
      [{ slot_id: "w2d1s1", exercise_id: "ex-1", exercise_name: "Split Squat", notes: null, per_side: true }],
      slotLookup,
      slotDetailsLookup,
      "p",
    )
    expect(rows[0].reps).toBe("8 each side")
    expect(withSide("8 each leg", true)).toBe("8 each leg")
    expect(withSide("30s/side", true)).toBe("30s/side")
    expect(withSide("8", false)).toBe("8")
  })

  it("saves the slot's intensity_pct instead of null", () => {
    const { slotLookup, slotDetailsLookup } = buildSlotLookups(weeks({ intensity_pct: 75 }))
    const rows = buildExerciseRows(
      [{ slot_id: "w2d1s1", exercise_id: "ex-1", exercise_name: "Squat", notes: null }],
      slotLookup,
      slotDetailsLookup,
      "p",
    )
    expect(rows[0].intensity_pct).toBe(75)
  })

  it("runs the note guard with the athlete's sport and reports what it removed", () => {
    const { slotLookup, slotDetailsLookup } = buildSlotLookups(weeks())
    const cleaned: string[] = []
    const rows = buildExerciseRows(
      [{ slot_id: "w2d1s1", exercise_id: "ex-1", exercise_name: "Lunge", notes: "3 sets of 8. Like a golf swing. Stay tall." }],
      slotLookup,
      slotDetailsLookup,
      "p",
      undefined,
      { athleteSport: "tennis", onCleanedNote: (_id, s) => cleaned.push(...s) },
    )
    expect(rows[0].notes).toBe("Stay tall.")
    expect(cleaned).toEqual(["3 sets of 8.", "Like a golf swing."])
  })
})
```

Add `withSide` to the file's import from `../shared-helpers.js`.

- [ ] **Step 2: Run — expect FAIL** (`... run src/ai/__tests__/shared-helpers.test.ts`)

- [ ] **Step 3: Implement in `shared-helpers.ts`**

`SlotDetails` gains `intensity_pct: number | null`; in `buildSlotLookups` add `intensity_pct: slot.intensity_pct ?? null,`.

Add above `sanitizeSlotRefsInNotes`:

```ts
/** "8" + per_side → "8 each side". Leaves reps that already name a side alone. */
export function withSide(reps: string, perSide: boolean | undefined): string {
  if (!perSide) return reps
  if (/\b(?:each|per)\s+(?:side|leg|arm)\b|\/\s*side\b/i.test(reps)) return reps
  return `${reps} each side`
}

export interface RowBuildOptions {
  /** Library names by exercise id. The model's exercise_name is never trusted (2026-10-04). */
  nameById?: Map<string, string>
  /** normalizeSport()'d. null = no sport known: every sport sentence is removed. */
  athleteSport?: string | null
  /** Sentences note-guard removed — console only, not a coach warning. */
  onCleanedNote?: (slotId: string, sentences: string[]) => void
}
```

`sanitizeSlotRefsInNotes` gains two parameters and runs the guard after the pipeline-internals strip:

```ts
export function sanitizeSlotRefsInNotes(
  notes: string | null,
  nameBySlotId: Map<string, string>,
  onStripped?: (sentences: string[]) => void,
  athleteSport: string | null = null,
  onCleaned?: (sentences: string[]) => void,
): string | null {
  if (!notes) return notes
  const deInternalised = stripPipelineInternals(notes)
  if (deInternalised.stripped.length > 0) onStripped?.(deInternalised.stripped)
  const guarded = cleanNote(deInternalised.text, { athleteSport })
  if (guarded.stripped.length > 0) onCleaned?.(guarded.stripped)
  if (guarded.text === null) return null

  const cleaned = guarded.text
    .replace(SLOT_REF_RE, (ref) => nameBySlotId.get(ref.toLowerCase()) ?? "the paired exercise")
    .replace(ID_FRAGMENT_RE, "")
  if (cleaned === notes) return notes
  const trimmed = cleaned.replace(/ {2,}/g, " ").trim()
  return trimmed.length > 0 ? trimmed : null
}
```

Import `cleanNote` alongside `splitSentences`: `import { splitSentences, cleanNote } from "./note-guard.js"`.

`buildExerciseRows`:

```ts
export function buildExerciseRows(
  assignments: Array<{ slot_id: string; exercise_id: string; notes: string | null; exercise_name?: string; per_side?: boolean }>,
  slotLookup: Map<string, SlotLocation>,
  slotDetailsLookup: Map<string, SlotDetails>,
  programId: string,
  /** Receives note sentences removed for narrating pipeline internals. */
  onStrippedNote?: (slotId: string, sentences: string[]) => void,
  opts: RowBuildOptions = {},
): Record<string, unknown>[] {
  const nameBySlotId = new Map<string, string>()
  for (const a of assignments) {
    const libraryName = opts.nameById?.get(a.exercise_id)
    if (libraryName && a.exercise_name && libraryName !== a.exercise_name) {
      console.warn(`[rows] model named ${a.exercise_id} "${a.exercise_name}"; library says "${libraryName}"`)
    }
    const name = libraryName ?? a.exercise_name
    if (name) nameBySlotId.set(a.slot_id.toLowerCase(), name)
  }
  return assignments
    .map((assigned) => {
      const location = slotLookup.get(assigned.slot_id)
      const details = slotDetailsLookup.get(assigned.slot_id)
      if (!location || !details) return null
      return {
        program_id: programId,
        exercise_id: assigned.exercise_id,
        day_of_week: location.day_of_week,
        week_number: location.week_number,
        order_index: location.order_index,
        sets: details.sets,
        reps: withSide(details.reps, assigned.per_side),
        duration_seconds: null,
        rest_seconds: details.rest_seconds,
        notes: sanitizeSlotRefsInNotes(
          assigned.notes,
          nameBySlotId,
          (sentences) => onStrippedNote?.(assigned.slot_id, sentences),
          opts.athleteSport ?? null,
          (sentences) => opts.onCleanedNote?.(assigned.slot_id, sentences),
        ),
        rpe_target: details.rpe_target,
        intensity_pct: details.intensity_pct,
        tempo: details.tempo,
        group_tag: details.group_tag,
        technique: VALID_TECHNIQUES.has(details.technique ?? "") ? details.technique : "straight_set",
        slot_role: details.role,
      }
    })
    .filter((r) => r !== null) as Record<string, unknown>[]
}
```

Note: with `athleteSport` defaulting to null, the existing callers (no opts) now strip ALL sport sentences. That is intended (no sport known ⇒ never mention one) and Tasks 8-9 pass the real sport.

- [ ] **Step 4: Run** `shared-helpers.test.ts`, `note-guard.test.ts` and every suite that imports `buildExerciseRows` / `sanitizeSlotRefsInNotes` (`git grep -l "buildExerciseRows\|sanitizeSlotRefsInNotes" -- functions/src`) — expect PASS. Existing assertions with sport words or "N reps" in notes may now fail: read each; if the fixture note only carried a sport word incidentally, change the fixture, never the guard. Mutant: replace `libraryName ?? a.exercise_name` with `a.exercise_name` → the library-name test fails. Restore.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/shared-helpers.ts functions/src/ai/__tests__/shared-helpers.test.ts
git commit -m "feat(ai): rows use library names, per_side reps, saved intensity_pct, guarded notes"
```

---

### Task 6: Fit grading

**Files:**
- Create: `functions/src/ai/slot-fit.ts`
- Test: `functions/src/ai/__tests__/slot-fit.test.ts`

**Interfaces:**
- Consumes: `ProgramWeek`, `AssignedExercise` (Task 2)
- Produces: `interface SlotFitItem { day_of_week: number; slot_role: string; slot_pattern: string; exercise_name: string; reason: string }`; `gradeFits(weeks: ProgramWeek[], assignments: AssignedExercise[], library: Array<{ id: string; name: string; movement_pattern?: string | null }>): SlotFitItem[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { gradeFits } from "../slot-fit.js"
import type { ProgramWeek } from "../types.js"

function weeks(slots: Array<{ id: string; role: string; pattern: string }>): ProgramWeek[] {
  return [
    {
      week_number: 3,
      phase: "p",
      intensity_modifier: "m",
      days: [
        {
          day_of_week: 2,
          label: "Tue",
          focus: "f",
          slots: slots.map((s) => ({
            slot_id: s.id,
            role: s.role,
            movement_pattern: s.pattern,
            target_muscles: ["glutes"],
            sets: 3,
            reps: "8",
            rest_seconds: 60,
            rpe_target: 7,
            tempo: null,
            group_tag: null,
            technique: "straight_set",
            intensity_pct: null,
          })),
        },
      ],
    } as ProgramWeek,
  ]
}
const LIB = [
  { id: "squat", name: "Goblet Squat", movement_pattern: "squat" },
  { id: "lunge", name: "Reverse Lunge", movement_pattern: "lunge" },
  { id: "plank", name: "Plank", movement_pattern: "isometric" },
  { id: "jump", name: "Box Jump", movement_pattern: "locomotion" },
]

describe("gradeFits", () => {
  it("flags a pattern mismatch even when the model said exact", () => {
    const out = gradeFits(weeks([{ id: "s1", role: "primary_compound", pattern: "squat" }]), [
      { slot_id: "s1", exercise_id: "plank", exercise_name: "x", notes: null, fit: "exact" },
    ], LIB)
    expect(out).toEqual([
      { day_of_week: 2, slot_role: "primary_compound", slot_pattern: "squat", exercise_name: "Plank", reason: "isometric exercise in a squat slot" },
    ])
  })
  it("treats squat and lunge as compatible", () => {
    expect(
      gradeFits(weeks([{ id: "s1", role: "accessory", pattern: "squat" }]), [
        { slot_id: "s1", exercise_id: "lunge", exercise_name: "x", notes: null, fit: "close" },
      ], LIB),
    ).toEqual([])
  })
  it("honours the model's own 'poor' with its reason", () => {
    const out = gradeFits(weeks([{ id: "s1", role: "accessory", pattern: "squat" }]), [
      { slot_id: "s1", exercise_id: "squat", exercise_name: "x", notes: null, fit: "poor", fit_reason: "only one squat left" },
    ], LIB)
    expect(out[0].reason).toBe("only one squat left")
  })
  it("skips the pattern test for power, warm-up and cool-down slots", () => {
    const out = gradeFits(
      weeks([
        { id: "p", role: "power", pattern: "squat" },
        { id: "w", role: "warm_up", pattern: "squat" },
      ]),
      [
        { slot_id: "p", exercise_id: "jump", exercise_name: "x", notes: null, fit: "close" },
        { slot_id: "w", exercise_id: "plank", exercise_name: "x", notes: null, fit: "close" },
      ],
      LIB,
    )
    expect(out).toEqual([])
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `functions/src/ai/slot-fit.ts`**

```ts
import type { AssignedExercise, ProgramWeek } from "./types.js"

/**
 * Substitutes the coach should know about (2026-10-04). The selector must fill
 * every slot, so when the library runs out it fills a squat slot with whatever
 * is left — 27 of 72 slots on 2026-08-31, with every check green. The model now
 * labels each pick; code does not trust the label and re-checks the pattern.
 * Shown to the coach, never rebuilt (owner decision).
 */
export interface SlotFitItem {
  day_of_week: number
  slot_role: string
  slot_pattern: string
  exercise_name: string
  reason: string
}

/** Roles where crossing patterns is normal (jumps, throws, drills) or irrelevant. */
const PATTERN_FREE_ROLES = new Set(["warm_up", "cool_down", "power", "conditioning", "activation"])

const COMPATIBLE: string[][] = [["squat", "lunge"], ["isometric", "rotation", "carry"], ["locomotion", "conditioning"]]
// ponytail: hand-written compatibility groups; replace with library co-occurrence data if they prove noisy.

function compatible(a: string, b: string): boolean {
  return a === b || COMPATIBLE.some((g) => g.includes(a) && g.includes(b))
}

export function gradeFits(
  weeks: ProgramWeek[],
  assignments: AssignedExercise[],
  library: Array<{ id: string; name: string; movement_pattern?: string | null }>,
): SlotFitItem[] {
  const byId = new Map(library.map((e) => [e.id, e]))
  const bySlot = new Map(assignments.map((a) => [a.slot_id, a]))
  const out: SlotFitItem[] = []
  for (const week of weeks) for (const day of week.days) for (const slot of day.slots) {
    const a = bySlot.get(slot.slot_id)
    const ex = a ? byId.get(a.exercise_id) : undefined
    if (!a || !ex) continue
    const mismatch =
      !PATTERN_FREE_ROLES.has(slot.role) && !!ex.movement_pattern && !compatible(ex.movement_pattern, slot.movement_pattern)
    if (!mismatch && a.fit !== "poor") continue
    const reason =
      a.fit_reason?.trim() ||
      (mismatch ? `${ex.movement_pattern} exercise in a ${slot.movement_pattern} slot` : "the AI marked this a poor match")
    out.push({ day_of_week: day.day_of_week, slot_role: slot.role, slot_pattern: slot.movement_pattern, exercise_name: ex.name, reason })
  }
  return out
}
```

- [ ] **Step 4: Run — expect PASS.** Mutant: remove `!PATTERN_FREE_ROLES.has(slot.role) &&` → the power/warm-up test fails. Restore.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/slot-fit.ts functions/src/ai/__tests__/slot-fit.test.ts
git commit -m "feat(ai): grade selector fit in code and list poor substitutes"
```

---

### Task 7: "Substitutes the AI had to make" panel

**Files:**
- Modify: `components/admin/GenerationWarnings.tsx` (append)
- Modify: `components/admin/GenerationDialog.tsx:485` and `components/admin/JobsNotificationDock.tsx:265-269`
- Test: `__tests__/components/admin/SlotFit.test.tsx`

**Interfaces:**
- Consumes: the function result's `slot_fit` (shape `SlotFitItem[]` from Task 6, mirrored — the root app cannot import `functions/`)
- Produces: `extractSlotFit(result: unknown): SlotFitItem[]`, `SlotFitPanel({ items, defaultOpen }: { items: SlotFitItem[]; defaultOpen?: boolean })`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { extractSlotFit, SlotFitPanel } from "@/components/admin/GenerationWarnings"

const item = { day_of_week: 2, slot_role: "primary_compound", slot_pattern: "squat", exercise_name: "Reverse Lunge", reason: "no unused squat exercise left" }

describe("extractSlotFit", () => {
  it("reads valid items and drops malformed ones", () => {
    expect(extractSlotFit({ slot_fit: [item, { day_of_week: "x" }, null] })).toEqual([item])
  })
  it("is empty for older results with no slot_fit", () => {
    expect(extractSlotFit({ warnings: [] })).toEqual([])
    expect(extractSlotFit(null)).toEqual([])
  })
})

describe("SlotFitPanel", () => {
  it("renders nothing with no items", () => {
    const { container } = render(<SlotFitPanel items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
  it("names the day, the exercise, the slot and the reason", () => {
    render(<SlotFitPanel items={[item]} defaultOpen />)
    expect(screen.getByText(/Substitutes the AI had to make/)).toBeInTheDocument()
    expect(screen.getByText(/Tuesday/)).toBeInTheDocument()
    expect(screen.getByText(/Reverse Lunge/)).toBeInTheDocument()
    expect(screen.getByText(/squat slot/)).toBeInTheDocument()
    expect(screen.getByText(/no unused squat exercise left/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`$NODE node_modules/vitest/vitest.mjs run __tests__/components/admin/SlotFit.test.tsx`)

- [ ] **Step 3: Implement — append to `GenerationWarnings.tsx`** (add `Shuffle` to the lucide import)

```tsx
/**
 * Picks the AI had to make that do not really match their slot
 * (functions/src/ai/slot-fit.ts). Shown even when the coach gave no
 * instructions — the instruction panel hides itself then, this must not.
 */
export interface SlotFitItem {
  day_of_week: number
  slot_role: string
  slot_pattern: string
  exercise_name: string
  reason: string
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

/** Defensive read of `result.slot_fit` — older deployments never wrote it. */
export function extractSlotFit(result: unknown): SlotFitItem[] {
  const raw = (result as { slot_fit?: unknown } | null)?.slot_fit
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (i): i is SlotFitItem =>
      !!i &&
      typeof i === "object" &&
      typeof (i as SlotFitItem).day_of_week === "number" &&
      typeof (i as SlotFitItem).exercise_name === "string" &&
      typeof (i as SlotFitItem).slot_pattern === "string" &&
      typeof (i as SlotFitItem).reason === "string",
  )
}

export function SlotFitPanel({ items, defaultOpen = false }: { items: SlotFitItem[]; defaultOpen?: boolean }) {
  if (items.length === 0) return null
  return (
    <details open={defaultOpen} className="w-full rounded-lg border border-border bg-surface/50 p-3 text-left">
      <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-foreground">
        <Shuffle className="size-3.5 shrink-0 text-accent" />
        {`Substitutes the AI had to make — ${items.length}`}
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((it, i) => (
          <li key={i} className="text-xs leading-relaxed">
            <span className="font-medium text-foreground">
              {`${DAY_NAMES[it.day_of_week - 1] ?? `Day ${it.day_of_week}`} · ${it.exercise_name}`}
            </span>
            <span className="text-muted-foreground">{` (${it.slot_pattern} slot) — ${it.reason}`}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
```

`GenerationDialog.tsx`: import `SlotFitPanel, extractSlotFit` and add directly under line 485:

```tsx
            {isComplete && <SlotFitPanel items={extractSlotFit(result)} defaultOpen />}
```

`JobsNotificationDock.tsx`: import the same and add after the instruction-check block (after line 269):

```tsx
            {isDone && extractSlotFit(state.result).length > 0 ? (
              <div className="mt-2">
                <SlotFitPanel items={extractSlotFit(state.result)} />
              </div>
            ) : null}
```

- [ ] **Step 4: Run** `SlotFit.test.tsx`, `InstructionCheck.test.tsx`, `JobsNotificationDock.warnings.test.tsx`, `GenerationDialog.reopen.test.tsx` — expect PASS. Mutant: make `extractSlotFit` return `[]` always → the read test fails. Restore.

- [ ] **Step 5: Commit**

```bash
git add components/admin/GenerationWarnings.tsx components/admin/GenerationDialog.tsx components/admin/JobsNotificationDock.tsx __tests__/components/admin/SlotFit.test.tsx
git commit -m "feat(admin): show the substitutes the AI had to make after a generation"
```

---

### Task 8: Week/Day orchestrator wiring (and the analyzer removed)

**Files:**
- Modify: `functions/src/ai/week-orchestrator.ts`
- Test: `functions/src/ai/__tests__/week-orchestrator-strict.test.ts` (new, source-level wiring checks in the style of `week-orchestrator-compliance.test.ts:223`), `functions/src/ai/__tests__/week-orchestrator.test.ts` (drop the analyzer mock response)

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: `WeekGenerationResult.slot_fit?: SlotFitItem[]`; exported `buildWeekFocusSummary` (for its test).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../week-orchestrator.ts"), "utf8")

describe("week/day orchestrator strict wiring (2026-10-04)", () => {
  it("no longer calls a week-scoped analyzer", () => {
    expect(src).not.toMatch(/WEEK_PROFILE_ANALYZER_PROMPT/)
  })
  it("gives the architect the full profile, the log quality and the muscle list", () => {
    expect(src).toMatch(/buildProfileContext\(profile\)/)
    expect(src).toMatch(/## Log Quality/)
    expect(src).toMatch(/## Muscle names/)
  })
  it("gives the selector the athlete block and one difficulty default", () => {
    expect(src).toMatch(/athlete: buildAthleteContext\(profile\)/)
    expect(src).toMatch(/resolveClientDifficulty\(profile, request\.ignore_profile\)/)
    expect(src).not.toMatch(/experience_level \?\? \(request\.ignore_profile/)
  })
  it("normalises the skeleton, grades fit after dedup, and saves with library names and the sport", () => {
    expect(src).toMatch(/normalizeSkeletonInPlace\(skeleton\.weeks, muscleVocabulary\(fullLibrary\)\)/)
    const dedupAt = src.indexOf("dedupAssignmentsInPlace(assignment.assignments")
    const fitAt = src.indexOf("gradeFits(skeleton.weeks, assignment.assignments")
    expect(fitAt).toBeGreaterThan(dedupAt)
    expect(src).toMatch(/athleteSport: athlete\.sport/)
    expect(src).toMatch(/nameById: new Map\(allExercises\.map/)
    expect(src).toMatch(/slot_fit: slotFit/)
  })
})
```

And for the summary (add to the same file):

```ts
import { buildWeekFocusSummary } from "../week-orchestrator.js"

describe("buildWeekFocusSummary carries load", () => {
  it("adds total sets and average RPE per week so a deload is visible", () => {
    const rows = [
      { week_number: 1, day_of_week: 1, sets: 4, rpe_target: 8, exercises: { name: "A" } },
      { week_number: 1, day_of_week: 1, sets: 3, rpe_target: 7, exercises: { name: "B" } },
      { week_number: 2, day_of_week: 1, sets: 2, rpe_target: null, exercises: { name: "C" } },
    ]
    const s = buildWeekFocusSummary(rows)
    expect(s[0]).toMatchObject({ week: 1, total_sets: 7, avg_rpe: 7.5 })
    expect(s[1]).toMatchObject({ week: 2, total_sets: 2, avg_rpe: null })
  })
})
```

(Importing `week-orchestrator.js` needs the same `vi.mock` block as `week-orchestrator.test.ts:10-57` if module load touches Supabase; copy those mocks into this file's top if the import fails.)

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement, in this order**

1. Imports: add `import { buildProfileContext, buildAthleteContext, resolveClientDifficulty, normalizeSport } from "./athlete-context.js"`, `import { muscleVocabulary, normalizeSkeletonInPlace } from "./slot-normalize.js"`, `import { gradeFits, type SlotFitItem } from "./slot-fit.js"`. Remove `WEEK_PROFILE_ANALYZER_PROMPT` and `MODEL_SONNET` (if now unused) from imports; remove `profileAnalysisSchema` if unused.
2. `WeekGenerationResult`: add
   ```ts
   /** Picks that do not really match their slot (slot-fit.ts). Shown, never rebuilt. */
   slot_fit?: SlotFitItem[]
   ```
3. `profileContext` (≈ line 904): replace the inline `JSON.stringify({...})` with `buildProfileContext(profile) ?? (request.ignore_profile ? "<existing coach-directed sentence>" : "No profile available")`. Right after it: `const athlete = buildAthleteContext(profile)` and `const clientDifficultyLevel = resolveClientDifficulty(profile, request.ignore_profile)` (move it up from line 1125 and delete the old declaration there).
4. `buildWeekFocusSummary`: export it; add to each week's accumulator `sets: number` and `rpes: number[]` from `pe.sets` and `pe.rpe_target`; emit `total_sets` and `avg_rpe` (`rpes.length ? Math.round(avg * 10) / 10 : null`).
5. `sameWeekOtherDays` mapping: add `sets: pe.sets, rpe: pe.rpe_target`. Replace the sentence `IMPORTANT: The day you are designing must COMPLEMENT these existing days. Do NOT duplicate the same primary muscle groups or movement patterns.` with `IMPORTANT: COMPLEMENT these days — do not load a movement pattern heavily (compound at RPE 8+) within 48 hours of a day that already does. On full_body and DUP programs, training the same patterns on several days is expected.`
6. Architect message (≈ line 990): before `## Client Profile` add
   ```
   ## Log Quality
   ${lowQuality ? `LOW (${(logQuality.quality * 100).toFixed(0)}% of ${logQuality.sample_size} recent logs include RPE). Do NOT autoregulate from these logs — keep each slot's prescription matching the prior week.` : `OK (${(logQuality.quality * 100).toFixed(0)}% of ${logQuality.sample_size} recent logs include RPE).`}

   ## Muscle names
   target_muscles may only use these values: ${muscleVocabulary(fullLibrary).join(", ")}
   ```
   and change the header `## Coach Instructions (HIGHEST PRIORITY — these override ALL default rules)` to `## Coach Instructions (ladder rank 3 — above every default, below safety)`, and the follow-up line to `You MUST follow these instructions. Where they conflict with a default technique, structure or progression rule, the coach's instructions win — never over injury exclusions, the coach's equipment setting or blocked exercises.`
7. After the slot-id restamp loop (≈ line 1092):
   ```ts
   const slotChanges = normalizeSkeletonInPlace(skeleton.weeks, muscleVocabulary(fullLibrary))
   if (slotChanges.length > 0) {
     console.log(
       `[week-orchestrator] Normalised ${slotChanges.length} slot field(s): ` +
         slotChanges.map((c) => `${c.slot_id}.${c.field} ${JSON.stringify(c.from)}→${JSON.stringify(c.to)}`).join("; "),
     )
   }
   ```
8. Delete the analyzer block (`const analyzerMessage = ...` through `analysis = fallback\n  }`) and replace it with the code-built analysis (the old fallback, now the normal path):
   ```ts
   // 2026-10-04: the week-scoped analyzer ran AFTER the architect and nothing
   // checked its output; only training_age_category reached code (the filter).
   const analysis: ProfileAnalysis = {
     recommended_split: program.split_type as ProfileAnalysis["recommended_split"],
     recommended_periodization: program.periodization as ProfileAnalysis["recommended_periodization"],
     volume_targets: [{ muscle_group: "full_body", sets_per_week: 12, priority: "medium" }],
     exercise_constraints: [],
     session_structure: { warm_up_minutes: 5, main_work_minutes: 45, cool_down_minutes: 5, total_exercises: 6, compound_count: 3, isolation_count: 3 },
     training_age_category: (clientDifficultyLevel === "beginner" ? "novice" : clientDifficultyLevel) as ProfileAnalysis["training_age_category"],
     technique_plan: [{ week_number: newWeekNumber, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "code" }],
     difficulty_ceiling: [{ week_number: newWeekNumber, max_tier: ceilingTier, max_score: ceilingScore }],
     notes: "",
   }
   ```
   Keep `policyInstructions`, `combinedInstructions` (the intent parser still reads it). Delete `analyzerInstructions` and `coachInstructionsSectionForAnalyzer`, and update `week-orchestrator-compliance.test.ts:223`, which pins `const analyzerInstructions = ...`: replace that assertion with `expect(src).not.toMatch(/analyzerInstructions/)` and keep the test's other assertions.

   The old fallback used `clientDifficultyLevel` as `training_age_category` directly; `"beginner"` is not a valid category, which is why the mapping to `"novice"` is added here.
9. Selector constraints (≈ line 1449):
   ```ts
   const constraintsContext = JSON.stringify({
     available_equipment: effectiveEquipment,
     client_difficulty: clientDifficultyLevel,
     athlete: buildAthleteContext(profile),
   })
   ```
10. After the post-hoc dedup block and before `checkInput`:
    ```ts
    const slotFit = gradeFits(skeleton.weeks, assignment.assignments, allExercises)
    if (slotFit.length > 0) {
      console.log(
        `[week-orchestrator] ${slotFit.length} poor fit(s): ` +
          slotFit.map((f) => `${f.exercise_name} in ${f.slot_pattern} (${f.reason})`).join("; "),
      )
    }
    ```
11. In `save`, pass options to `buildExerciseRows`:
    ```ts
    const cleanedNotes: string[] = []
    const exerciseRows = buildExerciseRows(
      assignment.assignments,
      slotLookup,
      slotDetailsLookup,
      request.program_id,
      (_slotId, sentences) => strippedNotes.push(...sentences),
      {
        nameById: new Map(allExercises.map((e) => [e.id, e.name])),
        athleteSport: athlete.sport,
        onCleanedNote: (_slotId, sentences) => cleanedNotes.push(...sentences),
      },
    )
    if (cleanedNotes.length > 0) {
      console.log(`[week-orchestrator] note-guard removed ${cleanedNotes.length} sentence(s): ${cleanedNotes.join(" | ")}`)
    }
    ```
    and add `slot_fit: slotFit,` to the returned result object.
12. In `week-orchestrator.test.ts`, remove the first `mockResolvedValueOnce` (the analysis object) so the mock order matches the pipeline (architect, then selector).

- [ ] **Step 4: Run** `week-orchestrator-strict.test.ts`, `week-orchestrator.test.ts`, `week-orchestrator-compliance.test.ts`, `../__tests__/week-orchestrator-prompt.test.ts`, `compliance-loop.test.ts`, `named-exercises.test.ts`, `preferred-pool.test.ts`, `log-quality.test.ts` — expect PASS. Then `cd functions && $NODE node_modules/typescript/bin/tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/week-orchestrator.ts functions/src/ai/__tests__/week-orchestrator-strict.test.ts functions/src/ai/__tests__/week-orchestrator.test.ts functions/src/ai/__tests__/week-orchestrator-compliance.test.ts
git commit -m "feat(ai): week/day generation gets the athlete's data, strict rows and fit grading; analyzer removed"
```

---

### Task 9: Full-program orchestrator — shared fixes and technique repair

**Files:**
- Modify: `functions/src/ai/orchestrator.ts`
- Modify: `functions/src/ai/schemas.ts` (add `repairSkeletonTechniques` beside `validateSkeletonAgainstAnalysis`)
- Test: `functions/src/ai/__tests__/schemas.test.ts` (append), `functions/src/ai/__tests__/orchestrator-strict.test.ts` (new, source-level)

**Interfaces:**
- Consumes: Tasks 1, 4, 5.
- Produces: `repairSkeletonTechniques(skeleton: { weeks: ProgramWeek[] }, plan: TechniquePlanWeek[]): Array<{ slot_id: string; from: string; to: string }>`

- [ ] **Step 1: Write the failing tests**

Append to `schemas.test.ts`:

```ts
import { repairSkeletonTechniques } from "../schemas.js"

describe("repairSkeletonTechniques", () => {
  const plan = [{ week_number: 1, allowed_techniques: ["straight_set", "superset"], default_technique: "straight_set", notes: "" }] as const
  function sk(technique: string) {
    return { weeks: [{ week_number: 1, phase: "p", intensity_modifier: "m", days: [{ day_of_week: 1, label: "L", focus: "f", slots: [{ slot_id: "w1d1s1", technique }] }] }] }
  }
  it("rewrites a disallowed technique to the week's default and reports it", () => {
    const s = sk("dropset")
    expect(repairSkeletonTechniques(s as never, [...plan] as never)).toEqual([{ slot_id: "w1d1s1", from: "dropset", to: "straight_set" }])
    expect(s.weeks[0].days[0].slots[0].technique).toBe("straight_set")
  })
  it("leaves allowed techniques and weeks without a plan alone", () => {
    expect(repairSkeletonTechniques(sk("superset") as never, [...plan] as never)).toEqual([])
    expect(repairSkeletonTechniques(sk("dropset") as never, [])).toEqual([])
  })
})
```

`orchestrator-strict.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../orchestrator.ts"), "utf8")

describe("full-program orchestrator strict wiring (2026-10-04)", () => {
  it("uses the shared profile, athlete and difficulty builders", () => {
    expect(src).toMatch(/buildProfileContext\(profile\)/)
    expect(src).toMatch(/athlete: buildAthleteContext\(profile\)/)
    expect(src).toMatch(/resolveClientDifficulty\(profile, request\.ignore_profile\)/)
  })
  it("repairs techniques after the architect instead of retrying the selector", () => {
    expect(src).toMatch(/repairSkeletonTechniques\(skeleton, analysis\.technique_plan\)/)
  })
  it("normalises slots and saves rows with library names and the sport", () => {
    expect(src).toMatch(/normalizeSkeletonInPlace\(skeleton\.weeks, muscleVocabulary\(allExercises\)\)/)
    expect(src).toMatch(/athleteSport: normalizeSport\(profile\?\.sport\)/)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

`schemas.ts`, after `validateSkeletonAgainstAnalysis`:

```ts
/**
 * A disallowed technique is the ARCHITECT's error, but the retry loop re-runs
 * only the selector, which cannot change a slot's technique — so those retries
 * could never pass (2026-10-04). Repair it once, in code, right after the
 * architect. Mutates in place; returns what changed for the log.
 */
export function repairSkeletonTechniques(
  skeleton: { weeks: Array<{ week_number: number; days: Array<{ slots: Array<{ slot_id: string; technique: string }> }> }> },
  plan: TechniquePlanWeek[],
): Array<{ slot_id: string; from: string; to: string }> {
  const byWeek = new Map(plan.map((p) => [p.week_number, p]))
  const changes: Array<{ slot_id: string; from: string; to: string }> = []
  for (const week of skeleton.weeks) {
    const p = byWeek.get(week.week_number)
    if (!p) continue
    const allowed = new Set<string>(p.allowed_techniques)
    for (const day of week.days) for (const slot of day.slots) {
      if (allowed.has(slot.technique)) continue
      changes.push({ slot_id: slot.slot_id, from: slot.technique, to: p.default_technique })
      slot.technique = p.default_technique
    }
  }
  return changes
}
```

`orchestrator.ts`:
1. Imports: `buildProfileContext, buildAthleteContext, resolveClientDifficulty, normalizeSport` from `./athlete-context.js`; `muscleVocabulary, normalizeSkeletonInPlace` from `./slot-normalize.js`; `repairSkeletonTechniques` from `./schemas.js`.
2. Replace the `age` block and the profile `JSON.stringify({...})` (lines 379-411) with `const profileContext = buildProfileContext(profile) ?? (request.ignore_profile ? <existing ignore JSON> : <existing no-profile JSON>)`. Keep the two existing fallback JSON strings verbatim.
3. Line 550: `const clientDifficultyLevel = resolveClientDifficulty(profile, request.ignore_profile)`. Lines 741 and 826: use `clientDifficultyLevel` instead of `profile?.experience_level ?? "beginner"`.
4. Agent-2 user message (line 670): append `\n\n## Muscle names\ntarget_muscles may only use these values: ${muscleVocabulary(allExercises).join(", ")}`.
5. After `dedupeSkeletonDaysInPlace(skeleton)` and its log (≈ line 690):
   ```ts
   const techniqueFixes = repairSkeletonTechniques(skeleton, analysis.technique_plan)
   if (techniqueFixes.length > 0) {
     console.warn(
       `[orchestrator:sync] Repaired ${techniqueFixes.length} technique(s) to the week default: ` +
         techniqueFixes.map((f) => `${f.slot_id} ${f.from}→${f.to}`).join(", "),
     )
   }
   const slotChanges = normalizeSkeletonInPlace(skeleton.weeks, muscleVocabulary(allExercises))
   if (slotChanges.length > 0) console.log(`[orchestrator:sync] Normalised ${slotChanges.length} slot field(s)`)
   ```
6. `constraintsContext` (line 738): add `athlete: buildAthleteContext(profile),` and use `client_difficulty: clientDifficultyLevel`.
7. `buildExerciseRows(weekAssignment.assignments, slotLookup, slotDetailsLookup, weekProgramId)` (line 1159) → add `undefined, { nameById: new Map(allExercises.map((e: { id: string; name: string }) => [e.id, e.name])), athleteSport: normalizeSport(profile?.sport) }`.

- [ ] **Step 4: Run** `schemas.test.ts`, `orchestrator-strict.test.ts`, `integration.test.ts`, `max-exercises.test.ts`, `prompt-caching.test.ts` (each imports the orchestrator or schemas; confirm with `git grep -l "orchestrator.js\|schemas.js" -- functions/src/ai/__tests__`) — expect PASS. `tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/orchestrator.ts functions/src/ai/schemas.ts functions/src/ai/__tests__/schemas.test.ts functions/src/ai/__tests__/orchestrator-strict.test.ts
git commit -m "feat(ai): full programs share the athlete data and strict rows; techniques repaired in code"
```

---

### Task 10: Prompt text — one ladder, no contradictions, no leaking examples

**Files:**
- Modify: `functions/src/ai/prompts.ts`, `functions/src/ai/week-orchestrator.ts` (`buildArchitectPrompt`), `functions/src/ai/shared-helpers.ts` (`buildCoachInstructionsSection`), `functions/src/ai/dedup-verify.ts` (two `prompt_text` lines)
- Test: `functions/src/ai/__tests__/strict-prompts.test.ts` (new), `functions/src/__tests__/week-orchestrator-prompt.test.ts` (append)

**Interfaces:**
- Produces: `export const PRIORITY_LADDER: string` in `prompts.ts`.

- [ ] **Step 1: Write the failing tests**

`strict-prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import * as prompts from "../prompts.js"
import { buildCoachInstructionsSection } from "../shared-helpers.js"

const { PRIORITY_LADDER, PROFILE_ANALYZER_PROMPT, PROGRAM_ARCHITECT_PROMPT, EXERCISE_SELECTOR_PROMPT } = prompts

describe("strict prompts (2026-10-04)", () => {
  it("every planning agent carries the same priority ladder", () => {
    for (const p of [PROFILE_ANALYZER_PROMPT, PROGRAM_ARCHITECT_PROMPT, EXERCISE_SELECTOR_PROMPT]) {
      expect(p).toContain(PRIORITY_LADDER)
    }
  })
  it("the removed phrases are gone", () => {
    const all = [PROFILE_ANALYZER_PROMPT, PROGRAM_ARCHITECT_PROMPT, EXERCISE_SELECTOR_PROMPT].join("\n")
    for (const phrase of [/3% repetition/i, /dumbbell throws/i, /split step/i, /\d+@\d+%/, /@ ~\d+%/, /anti-rotation\]/, /cardiovascular"\]/, /HIGHEST PRIORITY/]) {
      expect(all).not.toMatch(phrase)
    }
  })
  it("the dead prompts are deleted", () => {
    expect("VALIDATION_AGENT_PROMPT" in prompts).toBe(false)
    expect("WEEK_PROFILE_ANALYZER_PROMPT" in prompts).toBe(false)
  })
  it("the selector knows its athlete block, fit and per_side", () => {
    for (const s of ["Constraints.athlete", '"fit"', '"fit_reason"', '"per_side"', "sport is null"]) {
      expect(EXERCISE_SELECTOR_PROMPT).toContain(s)
    }
  })
  it("notes are cues only", () => {
    expect(EXERCISE_SELECTOR_PROMPT).toMatch(/never state sets, reps, rest, RPE, percentages or loads/i)
  })
  it("the architect reads the muscle list and has one week-1 effort", () => {
    expect(PROGRAM_ARCHITECT_PROMPT).toContain("Muscle names")
    expect(PROGRAM_ARCHITECT_PROMPT).toContain("RPE 6-7 in week 1, 7-8 in week 2, 8-9 from week 3")
    expect(PROGRAM_ARCHITECT_PROMPT).not.toMatch(/RPE 7-8 in weeks 1-2/)
  })
  it("the time cap yields to a coach-stated count", () => {
    expect(PROGRAM_ARCHITECT_PROMPT).toMatch(/NEVER exceed these caps unless the coach stated an exercise count/)
  })
  it("coach instructions sit below safety", () => {
    const s = buildCoachInstructionsSection("4 power exercises")
    expect(s).toContain("ladder rank 3")
    expect(s).toMatch(/Never overridden by these/)
  })
})
```

Append to `functions/src/__tests__/week-orchestrator-prompt.test.ts`:

```ts
import { PRIORITY_LADDER } from "../ai/prompts.js"

describe("week/day architect strict prompt (2026-10-04)", () => {
  for (const mode of ["week", "day"] as const) {
    it(`${mode}: carries the ladder and drops the compound-continuity goal`, () => {
      const p = buildArchitectPrompt(mode)
      expect(p).toContain(PRIORITY_LADDER)
      expect(p).not.toMatch(/continuity for compound lifts/)
      expect(p).not.toMatch(/3% repetition/)
      expect(p).toContain("Muscle names")
    })
  }
  it("day: overlap is about heavy loading, not shared patterns", () => {
    const p = buildArchitectPrompt("day")
    expect(p).toMatch(/within 48 hours/)
    expect(p).not.toMatch(/avoid duplicating the same muscle groups or movement patterns/)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Edit `prompts.ts`.** Add at the very top of the file (before Agent 1 — template literals below read it at module load):

```ts
// ─── Shared: one priority ladder for every planning agent (2026-10-04) ──────
// Replaces six "HIGHEST PRIORITY / override ALL" passages that each listed
// different things and never said what the coach could NOT override.
export const PRIORITY_LADDER = `PRIORITY LADDER — when two instructions conflict, the higher one wins:
1. Output contract: only exercise ids from the library you are given, the JSON schema, the slot ids.
2. Safety: injury exclusions, the coach's explicit equipment setting, blocked exercises.
3. The coach's own words for this run (COACH INSTRUCTIONS).
4. The coach's Exercise Pool.
5. Program continuity: split, training days, phase.
6. The defaults in this prompt.
If something you need is missing, use the default this prompt gives for it. Never invent a sport, an injury, a percentage, a load or an exercise.`
```

Then apply these exact replacements (old → new):

Analyzer:
- `(e.g., no cable machine → use bands, no plyometric boxes → use step-ups, no medicine balls → use dumbbell throws)` → `(e.g., no cable machine → use bands, no plyometric boxes → use step-ups or low hurdles)`
- `Every slot in every week of the generated program will be validated against these plans, and violations cause regeneration.` → `Every slot in every week will be checked against these plans; a disallowed technique is replaced with that week's default_technique.`
- `if the user message includes a "COACH INSTRUCTIONS" section, those instructions are the HIGHEST PRIORITY input. They override ALL default rules including technique selection, exercise preferences, and structure decisions.` → `if the user message includes a "COACH INSTRUCTIONS" section, those instructions are rank 3 on the priority ladder: they override every default rule in this prompt, including technique selection, exercise preferences, and structure decisions.`
- After `Core principles: Precision beats volume. Capacity beats fatigue. Systems beat workouts.` insert `\n\n${PRIORITY_LADDER}`.

Architect (full):
- After `- EVERY SESSION HAS A PURPOSE: ... it's entertainment.` (end of the philosophy list) insert `\n\n${PRIORITY_LADDER}`.
- `"target_muscles": [string] (e.g., ["glutes", "hamstrings", "core"], ["rotator_cuff", "scapular_stabilizers"]),` → `"target_muscles": [string] — ONLY values from the "Muscle names" list in the user message (e.g., ["glutes", "hamstrings"], ["shoulders", "upper_back"]),`
- `   NEVER exceed these caps. A real coach knows` → `   NEVER exceed these caps unless the coach stated an exercise count (rule 19). A real coach knows`
- `   - If the total exceeds the session_minutes by more than 10%, REMOVE the lowest-priority exercise slot` → `   - If the total exceeds the session_minutes by more than 10%, REMOVE the lowest-priority exercise slot — unless the coach stated an exercise count; then shorten rest or sets instead (rule 19)`
- `   - Primary compound: RPE 7-8 in weeks 1-2, building to RPE 8-9 in weeks 3-4 before deload (leave 1-3 reps in reserve` → `   - Primary compound: RPE 6-7 in week 1, 7-8 in week 2, 8-9 from week 3 until a deload (leave 1-3 reps in reserve`
- `       - Weeks 1-2 accessory: isolation / isometric / [core, anti-rotation] + accessory / lunge / [glutes, single-leg stability]` → `       - Weeks 1-2 accessory: isolation / isometric / [core, obliques] + accessory / lunge / [glutes, adductors]`
- `       - Weeks 3-4 accessory: isolation / rotation / [obliques, hip rotators] + accessory / hinge / [hamstrings, posterior chain]` → `       - Weeks 3-4 accessory: isolation / rotation / [obliques, core] + accessory / hinge / [hamstrings, glutes]`
- `   - target_muscles: ["full_body"] or ["lower_body", "cardiovascular"] as appropriate` → `   - target_muscles: the muscles the work mostly loads, from the Muscle names list (e.g. ["quadriceps", "glutes"])`
- `Lets the athlete keep heavier load and bar speed than a straight set of the same total reps. Note the exact scheme in exercise notes (e.g. "4 × (2+2+1) @ ~85%, 15s intra-cluster rest").` → `Lets the athlete keep heavier load and bar speed than a straight set of the same total reps. Put the scheme in reps (e.g. "2+2+1"); set intensity_pct only when the coach gave a percentage.`
- `   - "wave_loading": ascending/descending sets (e.g., 3/2/1/3/2/1). Express as reps: "3/2/1/3/2/1". Use intensity_pct to specify percentages.` → `   - "wave_loading": ascending/descending sets (e.g., 3/2/1/3/2/1). Express as reps: "3/2/1/3/2/1". Set intensity_pct only when the coach gave percentages.`
- `   COACH INSTRUCTIONS OVERRIDE ALL — if the user message includes a "COACH INSTRUCTIONS" section that names or rules out a technique, those instructions override technique_plan AND every default.` → `   COACH INSTRUCTIONS (ladder rank 3) — if the user message includes a "COACH INSTRUCTIONS" section that names or rules out a technique, those instructions override technique_plan AND every default.`
- After rule 27 add: `\n28. MUSCLE NAMES: target_muscles must use only the values in the user message's "Muscle names" list. Describe stability or anti-rotation work through role and movement_pattern, never as a muscle.`

Selector:
- After the paragraph ending `Every exercise change should have a reason.` insert `\n\n${PRIORITY_LADDER}\n\nTHE ATHLETE: Constraints.athlete holds sport (null when none is given), experience_level, movement_confidence, injury_details (empty = no known injuries) and exercise_dislikes. When sport is null, ignore sport_tags and never mention a sport. Avoid every exercise named in exercise_dislikes unless the coach's words ask for it.`
- HARD CONSTRAINT 4: `If none is an ideal match for a slot, pick the closest one from the library and explain the compromise in substitution_notes.` → `If none is an ideal match for a slot, pick the closest one from the library, set its "fit" to "poor" and write a one-line "fit_reason" a coach can read (e.g. "no unused squat exercise left — reverse lunge trains the same muscles").`
- Output schema: replace the `"notes": string | null (any specific instructions ... "Superset with Single Leg RDL")` line with:
  ```
      "notes": string | null (technique and intent cues for the CLIENT — see rule 16. Never internal slot_ids; refer to a paired exercise by its NAME, e.g. "Superset with Single Leg RDL"),
      "per_side": boolean (true when the exercise is done one side at a time and the slot's reps are a per-side count),
      "fit": "exact" | "close" | "poor" (how well the exercise matches the slot's movement_pattern, target_muscles and role),
      "fit_reason": string | null (required when fit is "poor": one plain sentence a coach can read)
  ```
- Rule 3d: replace from `   d. Difficulty must be appropriate for the athlete's level AND movement_confidence` through `Don't pick the most complex exercise available just because it matches the pattern.` (the whole sub-rule including its bullet list) with:
  ```
     d. Difficulty: the library you are given is ALREADY filtered to this athlete's level and this week's ceiling, so every exercise in it is allowed for them. Among exercises that fit a slot equally well, prefer the simpler one for a beginner, or when Constraints.athlete.movement_confidence is "learning" or "comfortable". Never reject a library exercise because of its tier.
  ```
- Rule 5: `5. Injury constraints: do not assign exercises that would aggravate known injuries.` → `5. Injury constraints: Constraints.athlete.injury_details lists the athlete's injuries (empty means none are known — do not assume any). Do not assign exercises that would aggravate them.`
- Rule 7: `Programs that repeat the same exercises every week WILL BE REJECTED by validation (target < 3% repetition score).` → `Code checks this: a working exercise_id from the AVOID list, or one used twice in the week, is sent back.` and delete the line `   - DIVERSITY METRIC: Your program must achieve < 3% repetition score. A 4-week program should use as many unique exercises as possible across weeks. More variety is better.`
- Rule 11: `11. SPORT-SPECIFIC SELECTION: when the client's sport is known, STRONGLY prefer` → `11. SPORT-SPECIFIC SELECTION: when Constraints.athlete.sport is set, STRONGLY prefer`; append to the rule: ` When sport is null, ignore sport_tags entirely.`
- Rule 12: `when injury_details are provided` → `when Constraints.athlete.injury_details is not empty`
- Rule 13: `For rotational sport athletes (tennis, golf, baseball, cricket)` → `When Constraints.athlete.sport is a rotational sport (tennis, pickleball, padel, golf, baseball, cricket)`
- Rule 16: replace the whole rule (from `16. Use exercise notes to add coaching cues` through the `CRITICAL: notes are displayed verbatim to the CLIENT...` bullet) with:
  ```
  16. Exercise notes are shown verbatim to the CLIENT. They give technique and intent cues only:
     - Movement quality: "brace before each rep", "drive through the whole foot", "land soft and absorb".
     - Intent for explosive work: "maximum intent on every rep — end the set if it slows down".
     - Tempo in words when the slot has a tempo: "lower slowly and control the bottom".
     - A modification near an injury listed in Constraints.athlete.injury_details: "use a neutral grip if the shoulder feels tight".
     - Notes never state sets, reps, rest, RPE, percentages or loads — those live in their own fields, and code deletes any note sentence that repeats them. Use "per_side" for one-side-at-a-time counts.
     - Mention a sport only when it equals Constraints.athlete.sport. When sport is null, mention no sport.
     - Never internal identifiers (slot_ids like "w2d1s9", exercise UUIDs). Refer to a paired exercise by its NAME.
  ```
- Rule 17 tail: `   - COACH INSTRUCTIONS: When coach instructions are provided, they are the HIGHEST PRIORITY signal for exercise selection.` → `   - COACH INSTRUCTIONS: When coach instructions are provided, they are rank 3 on the priority ladder — the strongest signal for exercise selection after safety.`
- Rule 18 testing: `Add notes explaining the testing protocol (e.g., "Work up to 3RM: warm-up sets at 50%, 60%, 70%, then attempts at estimated 3RM").` → `Add notes explaining the testing protocol in words (e.g., "build up in small jumps; stop when bar speed drops").`
- Rule 19: replace the four example parentheticals with number-free cues:
  - `(e.g., "15 seconds between singles, rack the bar between reps")` → `(e.g., "rack the bar between clusters and reset your brace")`
  - `(e.g., "Every minute: 5 reps. Rest remainder of minute.")` → `(e.g., "start each minute on the clock; rest whatever is left")`
  - `(e.g., "Wave 1: 3@80%, 2@85%, 1@90%. Wave 2: 3@82%, 2@87%, 1@92%")` → `(e.g., "each wave a little heavier than the last; stop if bar speed drops")`

Delete `VALIDATION_AGENT_PROMPT` (the whole `// ─── Agent 4 ...` section) and `WEEK_PROFILE_ANALYZER_PROMPT` (its section). Confirm nothing imports them: `git grep -n "VALIDATION_AGENT_PROMPT\|WEEK_PROFILE_ANALYZER_PROMPT" -- functions lib app` → no hits.

- [ ] **Step 4: Edit `buildArchitectPrompt` (week-orchestrator.ts)**

- Import `PRIORITY_LADDER` from `./prompts.js`.
- Both `goals` variants: `3. Maintains exercise continuity for compound lifts while rotating accessories` → `3. Rotates every working exercise from prior weeks while keeping each slot's movement pattern and purpose`
- Day rule 3 → `3. COMPLEMENT other days already programmed in this week: do not load a movement pattern heavily (primary/secondary compound at RPE 8+) within 48 hours of another day that already does. On full_body and DUP programs, training the same patterns on several days is expected.`
- Day rule 4 → `4. PROGRESS appropriately based on the client's logged performance. Primary compounds: RPE 6-7 in week 1, 7-8 in week 2, 8-9 from week 3 until a deload.`
- Day rule 6 opening → `6. COACH INSTRUCTIONS (ladder rank 3) override every default in this prompt, including technique selection, exercise structure, and progression logic — never injury exclusions, the coach's equipment setting or blocked exercises:`
- Week rule 2: add a first sub-bullet `   - Primary compounds: RPE 6-7 in week 1, 7-8 in week 2, 8-9 from week 3 until a deload.`
- Week rule 3: `Target < 3% repetition score.` → `Code rejects any working exercise_id from the AVOID list.`
- Week rule 5 opening → `5. COACH INSTRUCTIONS (ladder rank 3) override every default in this prompt, including technique selection, exercise structure, and progression logic — never injury exclusions, the coach's equipment setting or blocked exercises. The coach may specify:`
- Both rule lists: append a rule before "Output ONLY the JSON": `Use only values from the "Muscle names" list in the user message for target_muscles.` (renumber the final "Output ONLY" rule).
- In the returned template, insert `\n\n${PRIORITY_LADDER}` after the `${goals}` block.

- [ ] **Step 5: Edit `buildCoachInstructionsSection` (shared-helpers.ts:76-86)**

```ts
export function buildCoachInstructionsSection(instructions: string | undefined): string {
  if (!instructions) return ""
  return `\n\n## COACH INSTRUCTIONS (ladder rank 3 — above every default, below safety)\n${instructions}\n\nYou MUST follow these instructions exactly. They override every default rule (ladder ranks 4-6), including:
- **Structure**: If the coach specifies exercise counts (e.g., "4 power exercises", "2 quad exercises", "3 compounds and 2 accessories"), create exactly that many slots with the matching roles/patterns. Do NOT add extra slots or ignore the counts.
- **Periodization**: If the coach requests deload weeks, specific phases, or intensity patterns (e.g., "deload on week 4", "first 2 weeks hypertrophy then strength"), structure the program exactly as described.
- **Technique**: If the coach names a set technique (e.g., "no supersets", "use circuits", "use cluster sets", "rest-pause on compounds", "wave loading"), apply EXACTLY that technique even if default rules would suggest otherwise. Do not silently substitute supersets or straight sets because they are more familiar — if the coach asked for cluster sets, the program uses cluster sets.
- **Exercise focus**: If the coach requests specific focus areas, muscle groups, or movement patterns, prioritize those in slot design and exercise selection.
- **Session design**: If the coach specifies session structure (e.g., "start with plyometrics", "finish with core"), follow that order.
- **Never overridden by these**: injury exclusions, the coach's explicit equipment setting, blocked exercises, and the exercise library itself.

The coach knows this athlete. When in doubt, follow the coach's intent over any default in this prompt.`
}
```

- [ ] **Step 6: Edit `dedup-verify.ts`** — both occurrences (use replace-all): `"- EVERY working exercise (compounds, accessories, isolations) MUST be different each week. Target < 3% repetition.",` → `"- EVERY working exercise (compounds, accessories, isolations) MUST be different each week; code checks this against the AVOID list.",`

- [ ] **Step 7: Run** `strict-prompts.test.ts`, `../__tests__/week-orchestrator-prompt.test.ts`, `dedup-verify.test.ts`, `scoped-rules-prompts.test.ts`, `prompt-caching.test.ts`, `preferred-pool.test.ts`, `named-exercises.test.ts`, `shared-helpers.test.ts` — expect PASS. `tsc --noEmit` clean. Mutant: remove `${PRIORITY_LADDER}` from the selector → the ladder test fails. Restore.

- [ ] **Step 8: Commit**

```bash
git add functions/src/ai/prompts.ts functions/src/ai/week-orchestrator.ts functions/src/ai/shared-helpers.ts functions/src/ai/dedup-verify.ts functions/src/ai/__tests__/strict-prompts.test.ts functions/src/__tests__/week-orchestrator-prompt.test.ts
git commit -m "feat(ai): one priority ladder, contradictions removed, note and sport examples no longer leak"
```

---

### Task 11: Verification, replay comparison, review, report

**Files:**
- Create: `docs/superpowers/reports/2026-10-04-generation-strict-prompts-results.md`
- Create: `screenshots/generation-strict-prompts/` (after deploy only — see Step 6)

- [ ] **Step 1: Gates**

```bash
cd functions && $NODE node_modules/typescript/bin/tsc --noEmit
cd .. && $NODE node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -c "error TS"   # expect 236 (baseline), and:
$NODE node_modules/typescript/bin/tsc --noEmit 2>&1 | grep -E "GenerationWarnings|GenerationDialog|JobsNotificationDock|score-generation"   # expect no lines
npm_lifecycle_event=test:integration:selects $NODE node_modules/vitest/vitest.mjs run __tests__/integration/postgrest-select-contract.test.ts   # expect all pass
```

(The `npm_lifecycle_event` variable is what switches `vitest.config.ts` to the integration include; without it the file is excluded and "passes" by running nothing.)

- [ ] **Step 2: Re-run every test file touched in Tasks 0-10, by name, in one command per package.** Expect all green.

- [ ] **Step 3: Replay "after"** — same loop as Task 0 Step 9 with `--label after-…` and `--out tmp/replays-after.jsonl`. Keep the live view open; stream each run's summary line.

- [ ] **Step 4: Compare** — print a table from both jsonl files: per target and in total, `unmet`, `score.notes_foreign_sport`, `score.notes_prescription`, `slot_fit`, `est_cost_usd`, `seconds`. Pass criteria (spec "Done means"): foreign-sport = 0, prescription = 0, unmet ≤ baseline, cost ≤ baseline + 20%. Read the `note-guard removed` and `Normalised` log lines for one run and check no useful cue was lost; quote two examples in the report.

- [ ] **Step 5: Whole-branch review** — hand the reviewer `git diff main...HEAD > tmp/strict-prompts.diff` as a file (memory: reviewers inherit the worktree pin). Fix Critical/Important findings with a test each, rerun the affected files.

- [ ] **Step 6: Screenshots** — the panel reads PROD Firebase job docs, which only the deployed function writes. Before deploy: none possible without writing to production — do NOT fake it in a harness. After the owner deploys: drive one real Generate Day on a test program, capture the dialog and dock card (light only; admin is light-only), annotate with numbered markers burned into the PNG at native width, save to `screenshots/generation-strict-prompts/`. If no poor fit occurs naturally, pick inputs that force one (a strict pool smaller than the slot count), never a DB edit.

- [ ] **Step 6b: Production check (after the owner deploys)** — re-run the 2026-10-04 live queries (read-only) on rows created after the deploy time: AI rows (`slot_role is not null`) whose notes name a sport ≠ the assigned client's sport, and whose notes match the prescription pattern. Expected: 0 and 0. Report the counts; they replace the replay as the real-world proof.

- [ ] **Step 7: Report + journal + memory** — write the results report (numbers table, decisions, what is unverified). Add a dated `[Feature build-out]` entry to `JOURNAL.md` (not staged). Update `memory/ai-generation-hub.md`: analyzer removed from week/day; notes are cues only; `slot_fit` exists. Commit the report.

```bash
git add docs/superpowers/reports/2026-10-04-generation-strict-prompts-results.md
git commit -m "docs: strict generation prompts — replay results"
```

- [ ] **Step 8: Stop.** Branch is ready; merging to `main` deploys functions via CI and is the owner's call.

---

## Phase 2 (separate plan)

Write `docs/superpowers/plans/<date>-generation-strict-template.md` only after Task 11 shows phase 1's numbers. It covers the template rewrite of `buildArchitectPrompt` + `EXERCISE_SELECTOR_PROMPT` and per-call exercise aliases (`E1…En`), and is kept only if its replay meets the spec's phase-2 gate.
