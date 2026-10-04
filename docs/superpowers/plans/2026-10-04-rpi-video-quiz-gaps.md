# RPI Video Quiz Gaps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Darren can upload quiz videos himself. Each movement test also shows a "common mistakes" clip. The result reads like a mini-assessment: what you told us, a left/right movement map, and one CTA.

**Architecture:** Migration `00286` adds four nullable columns to `quiz_questions`. They thread through the same sites `media_url` already uses. A new pure module `lib/quizzes/report.ts` builds the mirror and the map from the answers on the server. `presentResult` moves to `lib/quizzes/present-result.ts`, so the submit route and the preview-submit route share one result shape. Uploads go straight from the browser to Firebase through a v4 signed URL that a new admin route issues. A data migration, `00287`, backfills the live RPI quiz.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres, Firebase Storage (Admin SDK), Zod, Vitest + Testing Library, ffmpeg.

**Spec:** `docs/superpowers/specs/2026-10-04-rpi-video-quiz-gaps-design.md`

## Global Constraints

- Worktree: `.claude/worktrees/rpi-video-quiz-gaps`, branch `worktree-rpi-video-quiz-gaps`. Use absolute paths and never `cd` out of it.
- **No `Co-Authored-By` trailer, and no "Generated with Claude" line**, in any commit.
- Run targeted tests by FILE: `npx vitest run <file> [<file>…]`. Never run a whole directory. Never run the full suite.
- Use `npx tsc --noEmit` for compilation. Grep its output for touched files only; the baseline is not zero.
- New `quiz_questions` columns stay **nullable**, with no URL check constraint.
- On `QuizQuestion` and `PublicQuizQuestion`, the four new fields are **optional** (`?:`). That way the roughly 16 hand-written test fixtures keep compiling. The DB mapper always sets them.
- `publicQuizDefinition` ships `mistakesMediaUrl` and `mistakesMediaPosterUrl`. It **never** ships `reportLabel` or `side`.
- The mirror and the map render **only when `map.length > 0`**. The athlete quiz's live result must stay unchanged.
- `lib/funnels/sections/styles.ts` is one big template literal. **No backticks in comments.**
- The backfill is scoped to `quizzes.key = 'rotational-performance-index'`. It is idempotent and only fills `null`s or untouched seed text.
- Never merge to `main`, publish a funnel, or delete a prod quiz.
- One Firebase project (`darrenjpaulcom`). Any upload is a live-bucket write.

## Review Focus

1. **A `.mov` that Chrome cannot decode.** The poster grab must give up (8 s timeout) and return `null`. The clip must still upload and save with no poster. *(Task 6, test "uploads the clip even when no poster can be grabbed")*
2. **The PUT to the signed URL fails** (CORS, or the URL expired). Show the error, and do not patch the question with a URL that points at nothing. *(Task 6, test "a failed PUT shows the error and changes nothing")*
3. **The visitor answered only one side of a pair.** The row shows one meter and can never be `gap`. *(Task 2, test "one answered side")*
4. **A labelled question whose weights are all 0.** Its row is dropped, with no `NaN` and no divide-by-zero. *(Task 2, test "zero-max row dropped")*
5. **A quiz with no `report_label` (the athlete quiz).** Its result must render no mirror and no map, and the tier body markup must stay identical. *(Task 3, test "athlete-quiz result unchanged")*

---

### Task 0: Worktree setup

**Files:** none tracked.

- [ ] **Step 1: Bring env and deps into the worktree**

```bash
W="/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/worktrees/rpi-video-quiz-gaps"
M="/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete"
cp "$M/.env.local" "$W/.env.local"
npm ci --prefix "$W"
```

- [ ] **Step 2: Baseline compile count**

Run: `npx tsc --noEmit -p "$W" 2>&1 | grep -c "error TS"`
Record the number in the task notes. Later tasks compare against it.

---

### Task 1: Columns, types, DAL, admin schema, public definition

**Files:**
- Create: `supabase/migrations/00286_quiz_question_report_and_mistakes.sql`
- Modify: `lib/quizzes/types.ts` (QuizQuestion, add `QuizSide`)
- Modify: `lib/db/quizzes.ts:133-144` (mapper), `:410-421` (createQuizFrom insert), `:500-525` (QuizSaveInput), `:710-721` (addQuestions insert), `:776-786` (patch)
- Modify: `app/api/admin/quizzes/[id]/route.ts:58-68` (questions schema), `:130-145` (addQuestions schema)
- Modify: `lib/quizzes/public-definition.ts:30-40,72-82`
- Test: `__tests__/lib/quizzes/public-definition.test.ts`, `__tests__/api/admin-quiz-save.test.ts`

**Interfaces — Produces:**
```ts
export type QuizSide = "left" | "right"
// on QuizQuestion:
mistakesMediaUrl?: string | null
mistakesMediaPosterUrl?: string | null
reportLabel?: string | null
side?: QuizSide | null
// on PublicQuizQuestion:
mistakesMediaUrl?: string | null
mistakesMediaPosterUrl?: string | null
```

- [ ] **Step 1: Failing public-definition test.** Append to `__tests__/lib/quizzes/public-definition.test.ts`:

```ts
describe("publicQuizDefinition — mistakes clip and results-map fields", () => {
  const base: QuizDefinition = {
    id: "q", key: "k", name: "n", status: "active",
    introHeadline: "", introBody: "", gateHeadline: "", gateBody: "", resultHeadline: "",
    seedMarker: null, branches: [], tiers: [], profiles: [],
    questions: [{
      id: "m1", quizId: "q", branchId: null, position: 30, prompt: "Copenhagen — left side: how many?",
      helpText: null, mediaUrl: "https://x/demo.mp4", mediaPosterUrl: "https://x/demo.jpg",
      mistakesMediaUrl: "https://x/mistakes.mp4", mistakesMediaPosterUrl: "https://x/mistakes.jpg",
      reportLabel: "Short lever Copenhagen", side: "left", isActive: true,
      options: [{ id: "o1", questionId: "m1", position: 1, label: "All three", weight: 3, routesToBranchId: null, profileId: null }],
    }],
  }

  it("ships the mistakes clip and its poster", () => {
    const q = publicQuizDefinition(base).questions[0]
    expect(q.mistakesMediaUrl).toBe("https://x/mistakes.mp4")
    expect(q.mistakesMediaPosterUrl).toBe("https://x/mistakes.jpg")
  })

  it("never ships reportLabel or side — the browser has no use for them before the result", () => {
    const json = JSON.stringify(publicQuizDefinition(base))
    expect(json).not.toContain("Short lever Copenhagen")
    expect(json).not.toMatch(/reportLabel|"side"/)
  })

  it("ships null, not undefined, when a question has no mistakes clip", () => {
    const def = { ...base, questions: [{ ...base.questions[0], mistakesMediaUrl: undefined, mistakesMediaPosterUrl: undefined }] }
    const q = publicQuizDefinition(def).questions[0]
    expect(q.mistakesMediaUrl).toBeNull()
    expect(q.mistakesMediaPosterUrl).toBeNull()
  })
})
```
Ensure `QuizDefinition` is imported as a type at the top of the file. Add it to the existing import if it is missing.

- [ ] **Step 2: Run it. It must fail.**
Run: `npx vitest run __tests__/lib/quizzes/public-definition.test.ts`
Expected: the type error or assertion fails on `mistakesMediaUrl` (undefined).

- [ ] **Step 3: Migration.** Create `supabase/migrations/00286_quiz_question_report_and_mistakes.sql`:

```sql
-- 00286_quiz_question_report_and_mistakes.sql
-- A second clip per movement test, and the two fields that put a question on
-- the results map.
--
-- mistakes_media_url / mistakes_media_poster_url: the "common mistakes" clip.
-- Every RPI source video ends with Darren demonstrating each wrong version;
-- self-grading inflates toward green without it. Same hosting and same
-- durability rule as media_url (00262): a public Firebase download URL,
-- never a signed one.
--
-- report_label / side: questions sharing a report_label are one row on the
-- results map; side pairs a left and a right attempt so asymmetry can be
-- shown. Read server-side only (lib/quizzes/report.ts) and never shipped in
-- the public definition.
--
-- ALL NULLABLE, NO URL CHECK — the reasons 00262 gives still hold: most
-- questions have none, and Zod .url() in the admin route is the right layer.

alter table public.quiz_questions
  add column if not exists mistakes_media_url text,
  add column if not exists mistakes_media_poster_url text,
  add column if not exists report_label text,
  add column if not exists side text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quiz_questions_side_check') then
    alter table public.quiz_questions
      add constraint quiz_questions_side_check check (side in ('left', 'right'));
  end if;
end $$;

comment on column public.quiz_questions.mistakes_media_url is
  'Durable public URL of a "common mistakes" clip. Null unless a movement test. Shipped to anonymous visitors by publicQuizDefinition.';
comment on column public.quiz_questions.mistakes_media_poster_url is
  'Poster frame for mistakes_media_url. Null whenever it is null.';
comment on column public.quiz_questions.report_label is
  'Row name on the results map. Questions sharing it form one row. Null = not on the map. Server-only.';
comment on column public.quiz_questions.side is
  'left | right for a paired movement test; null when unpaired. Server-only.';
```

- [ ] **Step 4: Types.** In `lib/quizzes/types.ts`, add `export type QuizSide = "left" | "right"` above `QuizOption`. Add these after `mediaPosterUrl` on `QuizQuestion`:

```ts
  /**
   * The "common mistakes" clip — Darren demonstrating each wrong version.
   * OPTIONAL ON THE TYPE so hand-written fixtures predating it compile; the
   * DB mapper always sets it.
   */
  mistakesMediaUrl?: string | null
  mistakesMediaPosterUrl?: string | null
  /** Row name on the results map. Server-only: never in the public definition. */
  reportLabel?: string | null
  /** Which side of a paired test. Server-only. */
  side?: QuizSide | null
```

- [ ] **Step 5: DAL.** In `lib/db/quizzes.ts`:
  - Mapper (`getQuizDefinition`, after `mediaPosterUrl`):
    ```ts
    mistakesMediaUrl: strOrNull(row.mistakes_media_url),
    mistakesMediaPosterUrl: strOrNull(row.mistakes_media_poster_url),
    reportLabel: strOrNull(row.report_label),
    side: row.side === "left" || row.side === "right" ? row.side : null,
    ```
  - `createQuizFrom` insert (after `media_poster_url`):
    ```ts
    mistakes_media_url: question.mistakesMediaUrl ?? null,
    mistakes_media_poster_url: question.mistakesMediaPosterUrl ?? null,
    report_label: question.reportLabel ?? null,
    side: question.side ?? null,
    ```
  - `QuizSaveInput.questions[]` and `addQuestions[]`: add
    `mistakesMediaUrl?: string | null; mistakesMediaPosterUrl?: string | null; reportLabel?: string | null; side?: QuizSide | null` (import `QuizSide` from `@/lib/quizzes/types`).
  - `addQuestions` insert: the same four lines as `createQuizFrom`.
  - Per-question patch, after the `mediaPosterUrl` line:
    ```ts
    if (question.mistakesMediaUrl !== undefined) patch.mistakes_media_url = question.mistakesMediaUrl
    if (question.mistakesMediaPosterUrl !== undefined) patch.mistakes_media_poster_url = question.mistakesMediaPosterUrl
    if (question.reportLabel !== undefined) patch.report_label = question.reportLabel
    if (question.side !== undefined) patch.side = question.side
    ```

- [ ] **Step 6: Admin route schema.** In `app/api/admin/quizzes/[id]/route.ts`, below `mediaUrlField`:
  ```ts
  const reportLabelField = z.string().trim().min(1).max(80).nullable()
  const sideField = z.enum(["left", "right"]).nullable()
  ```
  In the `questions` object, add `mistakesMediaUrl: mediaUrlField.optional(), mistakesMediaPosterUrl: mediaUrlField.optional(), reportLabel: reportLabelField.optional(), side: sideField.optional()`.
  In the `addQuestions` object, add the same four with `.default(null)` instead of `.optional()`.

- [ ] **Step 7: Public definition.** In `lib/quizzes/public-definition.ts`, add `mistakesMediaUrl?: string | null` and `mistakesMediaPosterUrl?: string | null` to `PublicQuizQuestion`. In the projection, after `mediaPosterUrl`:
  ```ts
  mistakesMediaUrl: question.mistakesMediaUrl ?? null,
  mistakesMediaPosterUrl: question.mistakesMediaPosterUrl ?? null,
  ```

- [ ] **Step 8: Admin save test.** In `__tests__/api/admin-quiz-save.test.ts`, add a case that PATCHes `questions: [{ id: Q_A1, reportLabel: "Copenhagen", side: "left", mistakesMediaUrl: "https://x/m.mp4" }]`. It must assert that `saveQuizDefinition` was called with those three values on that question. Add a second case: `side: "middle"` → status 400 and `saveQuizDefinition` not called. Reuse that file's existing request helper and `beforeEach` mocks.

- [ ] **Step 9: Run.**
Run: `npx vitest run __tests__/lib/quizzes/public-definition.test.ts __tests__/api/admin-quiz-save.test.ts __tests__/lib/quizzes/quiz-create.test.ts __tests__/lib/quizzes/quiz-structural-save.test.ts __tests__/api/admin-quiz-structural.test.ts`
Expected: all PASS.

- [ ] **Step 10: Apply to the dev clone, then the drift and select gates.**
  Apply `00286` through the dev Supabase MCP `apply_migration` (project `anjvztjiokcgiyhobknq`, name `quiz_question_report_and_mistakes`). Then:
  Run: `npm run test:integration:drift --prefix "$W"` and `npm run test:integration:selects --prefix "$W"`
  Expected: both PASS.

- [ ] **Step 11: Commit.**
```bash
git add supabase/migrations/00286_quiz_question_report_and_mistakes.sql lib/quizzes/types.ts lib/db/quizzes.ts "app/api/admin/quizzes/[id]/route.ts" lib/quizzes/public-definition.ts __tests__/lib/quizzes/public-definition.test.ts __tests__/api/admin-quiz-save.test.ts
git commit -m "feat(quiz): mistakes clip and results-map columns on quiz questions"
```

---

### Task 2: Report builder and shared result shape

**Files:**
- Create: `lib/quizzes/report.ts`
- Create: `lib/quizzes/present-result.ts`
- Modify: `app/api/quiz/submit/route.ts:272,545-558` (delete local `presentResult`, import the shared one)
- Modify: `app/api/quiz/preview-submit/route.ts:87-99`
- Test: `__tests__/lib/quizzes/report.test.ts` (new), `__tests__/app/api/quiz/preview-submit.test.ts`

**Interfaces — Consumes:** `QuizQuestion.reportLabel`, `QuizQuestion.side` (Task 1); `walkedQuestions`, `QuizScoreResult` from `lib/quizzes/score.ts`.
**Interfaces — Produces:**
```ts
// lib/quizzes/report.ts
export type MapStatus = "solid" | "watch" | "leak" | "gap"
export interface MapRow { label: string; left: number | null; right: number | null; single: number | null; max: number; status: MapStatus }
export interface MirrorLine { prompt: string; answer: string }
export interface QuizReport { mirror: MirrorLine[]; map: MapRow[] }
export function buildReport(definition: QuizDefinition, answers: QuizAnswer[], branchId: string | null): QuizReport
// lib/quizzes/present-result.ts
export interface PresentedResult {
  score: number
  tier: { key: string; headline: string; body: string; ctaLabel: string | null; ctaHref: string | null } | null
  profile: { key: string; name: string; description: string } | null
  branch: { key: string; name: string } | null
  mirror: MirrorLine[]
  map: MapRow[]
}
export function presentResult(definition: QuizDefinition, result: QuizScoreResult, answers: QuizAnswer[]): PresentedResult
```

- [ ] **Step 1: Failing tests.** Create `__tests__/lib/quizzes/report.test.ts`:

```ts
// @vitest-environment node
// ZERO MOCKS — lib/quizzes/report.ts imports types and the pure score module only.
import { describe, it, expect } from "vitest"
import { buildReport } from "@/lib/quizzes/report"
import type { QuizDefinition, QuizOption, QuizQuestion, QuizSide } from "@/lib/quizzes/types"

function opts(qid: string, weights: number[], extra: Partial<QuizOption> = {}): QuizOption[] {
  return weights.map((weight, i) => ({
    id: `${qid}-o${weight}`, questionId: qid, position: i, label: `${qid} ${weight}`,
    weight, routesToBranchId: null, profileId: null, ...extra,
  }))
}
function q(id: string, position: number, o: QuizOption[], extra: Partial<QuizQuestion> = {}): QuizQuestion {
  return { id, quizId: "q", branchId: null, position, prompt: `${id}?`, helpText: null, mediaUrl: null, mediaPosterUrl: null, isActive: true, options: o, ...extra }
}
function test(id: string, position: number, label: string, side: QuizSide | null): QuizQuestion {
  return q(id, position, opts(id, [3, 2, 1, 0]), { reportLabel: label, side })
}
function def(questions: QuizQuestion[]): QuizDefinition {
  return { id: "q", key: "k", name: "n", status: "active", introHeadline: "", introBody: "", gateHeadline: "",
    gateBody: "", resultHeadline: "", seedMarker: null, branches: [], tiers: [], profiles: [], questions }
}
const pick = (qid: string, weight: number) => ({ questionId: qid, optionId: `${qid}-o${weight}` })

const RPI = def([
  q("sport", 10, opts("sport", [0, 0])),
  test("cL", 60, "Copenhagen", "left"),
  test("cR", 70, "Copenhagen", "right"),
  test("hollow", 50, "Rocking hollow", null),
  q("feel", 130, opts("feel", [0, 0])),
  q("area", 140, opts("area", [0, 0], { profileId: "pf1" })),
  q("freq", 120, opts("freq", [3, 0])),
])

describe("buildReport — the map", () => {
  it("pairs left and right under one label, in walk order", () => {
    const { map } = buildReport(RPI, [pick("cL", 3), pick("cR", 3), pick("hollow", 3)], null)
    expect(map.map((r) => r.label)).toEqual(["Rocking hollow", "Copenhagen"])
    expect(map[1]).toMatchObject({ left: 3, right: 3, single: null, max: 3, status: "solid" })
  })

  it("a 2-point side difference is a gap", () => {
    expect(buildReport(RPI, [pick("cL", 3), pick("cR", 1)], null).map[0].status).toBe("gap")
  })

  it("a 1-point difference is not a gap — it is watch when neither side is low", () => {
    expect(buildReport(RPI, [pick("cL", 3), pick("cR", 2)], null).map[0].status).toBe("watch")
  })

  it("a low side without a big difference is a leak", () => {
    expect(buildReport(RPI, [pick("cL", 1), pick("cR", 0)], null).map[0].status).toBe("leak")
  })

  it("one answered side: one meter, never a gap", () => {
    const row = buildReport(RPI, [pick("cL", 0)], null).map[0]
    expect(row).toMatchObject({ left: 0, right: null, status: "leak" })
  })

  it("an unpaired test fills `single`", () => {
    const row = buildReport(RPI, [pick("hollow", 2)], null).map.find((r) => r.label === "Rocking hollow")
    expect(row).toMatchObject({ single: 2, left: null, right: null, status: "watch" })
  })

  it("zero-max row dropped — no NaN, no divide by zero", () => {
    const d = def([q("z", 10, opts("z", [0, 0]), { reportLabel: "Zero", side: null })])
    expect(buildReport(d, [pick("z", 0)], null).map).toEqual([])
  })

  it("an unanswered test is not on the map", () => {
    expect(buildReport(RPI, [], null).map).toEqual([])
  })

  it("only walked questions count — a question on another branch is ignored", () => {
    const d = def([test("b", 10, "Branch only", "left")])
    d.questions[0].branchId = "B"
    expect(buildReport(d, [pick("b", 3)], "A").map).toEqual([])
  })

  it("two questions with the same label and side: the later one in walk order wins", () => {
    const d = def([test("x1", 10, "Dup", "left"), test("x2", 20, "Dup", "left")])
    expect(buildReport(d, [pick("x1", 3), pick("x2", 0)], null).map[0].left).toBe(0)
  })

  it("a quiz with no report labels has an empty map", () => {
    const d = def([q("a", 10, opts("a", [3, 0]))])
    expect(buildReport(d, [pick("a", 3)], null).map).toEqual([])
  })
})

describe("buildReport — the mirror", () => {
  it("echoes unscored answers, skipping scored, labelled and profile-vote questions", () => {
    const { mirror } = buildReport(RPI, [pick("sport", 0), pick("feel", 0), pick("area", 0), pick("freq", 3), pick("cL", 3)], null)
    expect(mirror).toEqual([
      { prompt: "sport?", answer: "sport 0" },
      { prompt: "feel?", answer: "feel 0" },
    ])
  })
})
```

Note: the `opts` ids are `${qid}-o${weight}`. In `sport`, `feel` and `area` both options weigh 0, so their ids collide. That is fine, because `pick(x, 0)` selects the first one either way.

- [ ] **Step 2: Run it. It must fail.**
Run: `npx vitest run __tests__/lib/quizzes/report.test.ts`
Expected: FAIL, "Cannot find module '@/lib/quizzes/report'".

- [ ] **Step 3: Implement `lib/quizzes/report.ts`.**

```ts
// lib/quizzes/report.ts — the mini-assessment on the results page.
//
// PURE, like score.ts: types plus score.ts's walk, nothing else, so its tests
// run with zero mocks. Runs on the SERVER after scoring. It is the only place
// a visitor's per-question points leave the server, and then only their own,
// only after they have submitted.
//
// Spec: docs/superpowers/specs/2026-10-04-rpi-video-quiz-gaps-design.md §6.1

import { walkedQuestions } from "@/lib/quizzes/score"
import type { QuizAnswer, QuizDefinition } from "@/lib/quizzes/types"

export type MapStatus = "solid" | "watch" | "leak" | "gap"

export interface MapRow {
  label: string
  left: number | null
  right: number | null
  single: number | null
  max: number
  status: MapStatus
}

export interface MirrorLine {
  prompt: string
  answer: string
}

export interface QuizReport {
  mirror: MirrorLine[]
  map: MapRow[]
}

/**
 * Status by FRACTION of the max, so a test scored 0–3 and one scored 0–5 read
 * the same. A gap needs both sides and half the scale between them: on 0–3,
 * a 3 against a 1 is a gap, a 3 against a 2 is not.
 */
function statusOf(row: Omit<MapRow, "status">): MapStatus {
  if (row.left !== null && row.right !== null && Math.abs(row.left - row.right) / row.max >= 0.5) return "gap"
  const fractions = [row.left, row.right, row.single]
    .filter((points): points is number => points !== null)
    .map((points) => points / row.max)
  if (fractions.some((fraction) => fraction < 0.5)) return "leak"
  if (fractions.some((fraction) => fraction < 1)) return "watch"
  return "solid"
}

export function buildReport(definition: QuizDefinition, answers: QuizAnswer[], branchId: string | null): QuizReport {
  const chosen = new Map(answers.map((answer) => [answer.questionId, answer.optionId]))
  const rows = new Map<string, Omit<MapRow, "status">>()
  const mirror: MirrorLine[] = []

  for (const question of walkedQuestions(definition, branchId)) {
    const option = question.options.find((candidate) => candidate.id === chosen.get(question.id))
    const max = Math.max(0, ...question.options.map((candidate) => candidate.weight))

    if (question.reportLabel) {
      const row = rows.get(question.reportLabel) ?? { label: question.reportLabel, left: null, right: null, single: null, max: 0 }
      row.max = Math.max(row.max, max)
      if (option) row[question.side ?? "single"] = option.weight
      rows.set(question.reportLabel, row)
      continue
    }

    // Unscored and not a profile vote: something the visitor TOLD us, which
    // is what "mirror back what they said" means. The profile vote surfaces
    // as the profile block instead.
    if (option && max === 0 && !question.options.some((candidate) => candidate.profileId)) {
      mirror.push({ prompt: question.prompt, answer: option.label })
    }
  }

  const map = [...rows.values()]
    .filter((row) => row.max > 0 && (row.left !== null || row.right !== null || row.single !== null))
    .map((row) => ({ ...row, status: statusOf(row) }))

  return { mirror, map }
}
```

- [ ] **Step 4: Run report tests.**
Run: `npx vitest run __tests__/lib/quizzes/report.test.ts`
Expected: PASS.

- [ ] **Step 5: `lib/quizzes/present-result.ts`.**

```ts
// lib/quizzes/present-result.ts — the visitor-facing result, ONE copy.
//
// Both /api/quiz/submit and /api/quiz/preview-submit return this. The preview
// route used to build the same object by hand, which is how a preview starts
// disagreeing with the real thing. Carries no weight and no raw total; the
// map carries only the visitor's own points, after they submitted.

import { buildReport, type MapRow, type MirrorLine } from "@/lib/quizzes/report"
import type { QuizScoreResult } from "@/lib/quizzes/score"
import type { QuizAnswer, QuizDefinition } from "@/lib/quizzes/types"

export interface PresentedResult {
  score: number
  tier: { key: string; headline: string; body: string; ctaLabel: string | null; ctaHref: string | null } | null
  profile: { key: string; name: string; description: string } | null
  branch: { key: string; name: string } | null
  mirror: MirrorLine[]
  map: MapRow[]
}

export function presentResult(definition: QuizDefinition, result: QuizScoreResult, answers: QuizAnswer[]): PresentedResult {
  const tier = definition.tiers.find((candidate) => candidate.key === result.tierKey) ?? null
  const profile = definition.profiles.find((candidate) => candidate.key === result.profileKey) ?? null
  const branch = definition.branches.find((candidate) => candidate.key === result.branchKey) ?? null
  const { mirror, map } = buildReport(definition, answers, result.branchId)
  return {
    score: result.score,
    tier: tier
      ? { key: tier.key, headline: tier.headline, body: tier.body, ctaLabel: tier.ctaLabel, ctaHref: tier.ctaHref }
      : null,
    profile: profile ? { key: profile.key, name: profile.name, description: profile.description } : null,
    branch: branch ? { key: branch.key, name: branch.name } : null,
    mirror,
    map,
  }
}
```

- [ ] **Step 6: Wire both routes.**
  - `app/api/quiz/submit/route.ts`: delete the local `presentResult` function (lines ~545-558) and its doc comment. Add `import { presentResult } from "@/lib/quizzes/present-result"`. Change line ~272 to `return NextResponse.json(presentResult(definition, result, answers))`. If `QuizDefinition` or `scoreQuiz` imports become unused, remove them.
  - `app/api/quiz/preview-submit/route.ts`: replace the three `find` lines and the object literal with:
    ```ts
    return NextResponse.json({ testRun: true, ...presentResult(definition, result, answers) })
    ```
    and add the same import.

- [ ] **Step 7: Route assertions.** In `__tests__/app/api/quiz/preview-submit.test.ts`, find the existing happy-path test that reads the response JSON. Add:
  ```ts
  expect(Array.isArray(json.mirror)).toBe(true)
  expect(Array.isArray(json.map)).toBe(true)
  ```
  (use that test's own variable name for the parsed body). Add one source-level test to `__tests__/lib/quizzes/report.test.ts`:
  ```ts
  import fs from "node:fs"
  import path from "node:path"
  it("both result routes use the one shared presentResult", () => {
    for (const route of ["app/api/quiz/submit/route.ts", "app/api/quiz/preview-submit/route.ts"]) {
      const src = fs.readFileSync(path.join(process.cwd(), route), "utf8")
      expect(src).toContain('from "@/lib/quizzes/present-result"')
      expect(src).not.toMatch(/function presentResult/)
    }
  })
  ```

- [ ] **Step 8: Run.**
Run: `npx vitest run __tests__/lib/quizzes/report.test.ts __tests__/app/api/quiz/preview-submit.test.ts __tests__/api/quiz-submit.test.ts __tests__/api/quiz-submit-funnel-lead.test.ts __tests__/lib/quizzes/score.test.ts`
Expected: PASS. If a `quiz-submit` test deep-equals the old response shape, extend its expected object with `mirror: [], map: []`. Do not loosen it to `toMatchObject`.

- [ ] **Step 9: Commit.**
```bash
git add lib/quizzes/report.ts lib/quizzes/present-result.ts app/api/quiz/submit/route.ts app/api/quiz/preview-submit/route.ts __tests__/lib/quizzes/report.test.ts __tests__/app/api/quiz/preview-submit.test.ts __tests__/api/quiz-submit.test.ts
git commit -m "feat(quiz): mirror and left/right movement map in the quiz result"
```

---

### Task 3: Runner — mistakes toggle and mini-assessment result

**Files:**
- Modify: `components/funnels/islands/QuizRunner.tsx:23-28` (QuizResultView), `:235-262` (result JSX), `:385-405` (clip)
- Modify: `lib/funnels/sections/styles.ts` (after `.djp-quiz-profile-body`, ~line 1915)
- Test: `__tests__/components/funnels/QuizRunner.test.tsx`

**Interfaces — Consumes:** `MapRow`, `MirrorLine` from `lib/quizzes/report.ts`; `PublicQuizQuestion.mistakesMediaUrl` (Task 1).

- [ ] **Step 1: Failing tests.** Append to `__tests__/components/funnels/QuizRunner.test.tsx`:

```tsx
describe("QuizRunner — the mistakes clip", () => {
  const withClip: PublicQuizDefinition = {
    ...DEFINITION,
    questions: DEFINITION.questions.map((q) =>
      q.id === "q-router" ? { ...q, mediaUrl: "https://x/demo.mp4", mistakesMediaUrl: "https://x/mistakes.mp4", mistakesMediaPosterUrl: "https://x/m.jpg" } : q,
    ),
  }

  it("shows no toggle when a question has no mistakes clip", () => {
    renderRunner()
    start()
    expect(screen.queryByRole("button", { name: "Common mistakes" })).toBeNull()
  })

  it("swaps the player to the mistakes clip and back", () => {
    const { container } = render(<QuizRunner definition={withClip} submitLabel="See my result" />)
    start()
    const src = () => container.querySelector("video.djp-quiz-media")?.getAttribute("src")
    expect(src()).toBe("https://x/demo.mp4")
    fireEvent.click(screen.getByRole("button", { name: "Common mistakes" }))
    expect(src()).toBe("https://x/mistakes.mp4")
    expect(container.querySelector("video.djp-quiz-media")?.getAttribute("poster")).toBe("https://x/m.jpg")
    fireEvent.click(screen.getByRole("button", { name: "How to do it" }))
    expect(src()).toBe("https://x/demo.mp4")
  })
})

describe("QuizRunner — the mini-assessment result", () => {
  async function walkToResult(body: Record<string, unknown>) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("/api/quiz/progress")
        ? new Response(JSON.stringify({ attemptId: "att-1" }), { status: 200 })
        : new Response(JSON.stringify(body), { status: 200 }),
    ))
    const view = renderRunner()
    start()
    fireEvent.click(screen.getByRole("button", { name: "I am an Alpha" }))
    fireEvent.click(screen.getByRole("button", { name: "Alpha answer" }))
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Sam" } })
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: "See my result" }))
    await waitFor(() => expect(screen.getByText("Real gaps")).toBeTruthy())
    return view
  }
  const tier = { key: "orange", headline: "Real gaps", body: "First para.\n\nSecond para.", ctaLabel: "Go", ctaHref: "/x" }

  it("renders the mirror, the map rows with sides and status, and splits the body into paragraphs", async () => {
    await walkToResult({
      score: 48, tier, profile: null, branch: null,
      mirror: [{ prompt: "Which sport?", answer: "Golf" }],
      map: [{ label: "Short lever Copenhagen", left: 3, right: 1, single: null, max: 3, status: "gap" }],
    })
    expect(screen.getByText("What you told us")).toBeTruthy()
    expect(screen.getByText("Golf")).toBeTruthy()
    expect(screen.getByText("Your movement map")).toBeTruthy()
    expect(screen.getByText("Short lever Copenhagen")).toBeTruthy()
    expect(screen.getByText("Left/right gap")).toBeTruthy()
    expect(screen.getByLabelText("Left: 3 of 3")).toBeTruthy()
    expect(screen.getByLabelText("Right: 1 of 3")).toBeTruthy()
    expect(screen.getByText("First para.")).toBeTruthy()
    expect(screen.getByText("Second para.")).toBeTruthy()
  })

  it("athlete-quiz result unchanged: no mirror, no map when the map is empty", async () => {
    const { container } = await walkToResult({
      score: 48, tier: { ...tier, body: "One para." }, profile: null, branch: null,
      mirror: [{ prompt: "Which sport?", answer: "Golf" }], map: [],
    })
    expect(screen.queryByText("What you told us")).toBeNull()
    expect(screen.queryByText("Your movement map")).toBeNull()
    expect(container.querySelectorAll("p.djp-quiz-profile-body")).toHaveLength(1)
  })

  it("tolerates an older server response with no mirror or map", async () => {
    await walkToResult({ score: 48, tier, profile: null, branch: null })
    expect(screen.queryByText("Your movement map")).toBeNull()
  })
})
```

- [ ] **Step 2: Run. It must fail.**
Run: `npx vitest run __tests__/components/funnels/QuizRunner.test.tsx`
Expected: the new tests FAIL (no toggle, no map).

- [ ] **Step 3: Result type.** In `QuizRunner.tsx`, add `import type { MapRow, MirrorLine } from "@/lib/quizzes/report"` and extend `QuizResultView` with:
  ```ts
  /** Absent on a response from before the mini-assessment shipped. */
  mirror?: MirrorLine[]
  map?: MapRow[]
  ```
  Add module-level constants:
  ```ts
  const STATUS_LABEL: Record<MapRow["status"], string> = { solid: "Solid", watch: "Watch", leak: "Leak", gap: "Left/right gap" }
  const SIDE_LABEL = { left: "Left", right: "Right", single: "Score" } as const
  ```

- [ ] **Step 4: Clip toggle.** Add state `const [mistakesFor, setMistakesFor] = useState<string | null>(null)`. Keying it by question id means it resets on every question change with no effect hook. Replace the `{current.mediaUrl ? (<video …/>) : null}` block with:
  ```tsx
  {(() => {
    const showMistakes = mistakesFor === current.id && Boolean(current.mistakesMediaUrl)
    const src = showMistakes ? current.mistakesMediaUrl : current.mediaUrl
    const poster = showMistakes ? current.mistakesMediaPosterUrl : current.mediaPosterUrl
    return (
      <>
        {current.mistakesMediaUrl ? (
          <div className="djp-quiz-toggle" role="group" aria-label="Which clip to watch">
            <button type="button" aria-pressed={!showMistakes} onClick={() => setMistakesFor(null)}>How to do it</button>
            <button type="button" aria-pressed={showMistakes} onClick={() => setMistakesFor(current.id)}>Common mistakes</button>
          </div>
        ) : null}
        {src ? (
          <video key={src} className="djp-quiz-media" src={src} poster={poster ?? undefined}
            preload="none" controls loop muted playsInline />
        ) : null}
      </>
    )
  })()}
  ```
  Keep the existing comment above the video. Add one sentence: the mistakes clip keeps its audio track, so a visitor can unmute Darren naming each mistake.

- [ ] **Step 5: Result JSX.** In the result phase, keep the existing order (tier chip, score, scale). After the scale line:
  ```tsx
  {(() => {
    const map = result.map ?? []
    const assessment = map.length > 0
    const sides = (row: MapRow) =>
      (["left", "right", "single"] as const).flatMap((side) => (row[side] === null ? [] : [[side, row[side] as number] as const]))
    return (
      <>
        {assessment && result.mirror?.length ? (
          <div className="djp-quiz-mirror">
            <p className="djp-quiz-section-title">What you told us</p>
            <dl>
              {result.mirror.map((line) => (
                <div key={line.prompt}>
                  <dt>{line.prompt}</dt>
                  <dd>{line.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
        {result.tier
          ? result.tier.body.split(/\n\s*\n/).map((paragraph, index) => (
              <p key={index} className="djp-quiz-profile-body">{paragraph}</p>
            ))
          : null}
        {assessment ? (
          <div className="djp-quiz-map">
            <p className="djp-quiz-section-title">Your movement map</p>
            <ul>
              {map.map((row) => (
                <li key={row.label} className="djp-quiz-map-row">
                  <span className="djp-quiz-map-label">{row.label}</span>
                  <span className="djp-quiz-map-sides">
                    {sides(row).map(([side, points]) => (
                      <span key={side} className="djp-quiz-meter" aria-label={`${SIDE_LABEL[side]}: ${points} of ${row.max}`}>
                        {side === "single" ? null : <span className="djp-quiz-meter-side">{side === "left" ? "L" : "R"}</span>}
                        <span className="djp-quiz-meter-track">
                          <span className="djp-quiz-meter-fill" style={{ width: `${(points / row.max) * 100}%` }} />
                        </span>
                        <span className="djp-quiz-meter-value">{points}/{row.max}</span>
                      </span>
                    ))}
                  </span>
                  <span className="djp-quiz-status" data-status={row.status}>{STATUS_LABEL[row.status]}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </>
    )
  })()}
  ```
  Remove the old single `{result.tier ? <p className="djp-quiz-profile-body">{result.tier.body}</p> : null}` line. The profile block and the CTA stay below, unchanged.

- [ ] **Step 6: CSS.** In `lib/funnels/sections/styles.ts`, directly after the `.djp-quiz-profile-body` rule, add (no backticks anywhere):
  ```css
  ${ROOT} .djp-s-quiz .djp-quiz-toggle { display: inline-flex; gap: 0.25rem; padding: 0.25rem; margin: 0 0 0.75rem; border-radius: 999px; background: var(--surface); }
  ${ROOT} .djp-s-quiz .djp-quiz-toggle button { border: none; background: transparent; font: inherit; font-size: 0.8125rem; font-weight: 600; color: var(--muted-foreground); padding: 0.375rem 0.875rem; border-radius: 999px; cursor: pointer; }
  ${ROOT} .djp-s-quiz .djp-quiz-toggle button[aria-pressed="true"] { background: var(--background); color: inherit; }
  ${ROOT} .djp-s-quiz .djp-quiz-section-title { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted-foreground); margin: 1.5rem 0 0.625rem; }
  ${ROOT} .djp-s-quiz .djp-quiz-mirror dl { margin: 0; display: grid; gap: 0.5rem; }
  ${ROOT} .djp-s-quiz .djp-quiz-mirror dt { font-size: 0.8125rem; color: var(--muted-foreground); }
  ${ROOT} .djp-s-quiz .djp-quiz-mirror dd { margin: 0; font-weight: 600; }
  ${ROOT} .djp-s-quiz .djp-quiz-map ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  ${ROOT} .djp-s-quiz .djp-quiz-map-row { display: grid; grid-template-columns: 1fr auto; gap: 0.375rem 0.75rem; align-items: center; padding: 0.75rem 1rem; border: 1px solid var(--surface); border-radius: var(--radius); }
  ${ROOT} .djp-s-quiz .djp-quiz-map-label { font-weight: 600; }
  ${ROOT} .djp-s-quiz .djp-quiz-map-sides { grid-column: 1 / -1; display: grid; gap: 0.25rem; }
  ${ROOT} .djp-s-quiz .djp-quiz-meter { display: grid; grid-template-columns: 1rem 1fr 2.25rem; align-items: center; gap: 0.5rem; font-size: 0.8125rem; }
  ${ROOT} .djp-s-quiz .djp-quiz-meter-side { font-weight: 700; color: var(--muted-foreground); }
  ${ROOT} .djp-s-quiz .djp-quiz-meter-track { height: 0.5rem; border-radius: 999px; background: var(--surface); overflow: hidden; }
  ${ROOT} .djp-s-quiz .djp-quiz-meter-fill { display: block; height: 100%; background: var(--accent); }
  ${ROOT} .djp-s-quiz .djp-quiz-meter-value { text-align: right; color: var(--muted-foreground); }
  ${ROOT} .djp-s-quiz .djp-quiz-status { grid-column: 2; grid-row: 1; font-size: 0.75rem; font-weight: 700; padding: 0.125rem 0.5rem; border-radius: 999px; background: var(--surface); }
  ${ROOT} .djp-s-quiz .djp-quiz-status[data-status="gap"], ${ROOT} .djp-s-quiz .djp-quiz-status[data-status="leak"] { color: var(--error); }
  ```
  Also add, for the unpaired row that has no L/R span: `${ROOT} .djp-s-quiz .djp-quiz-meter:not(:has(.djp-quiz-meter-side)) { grid-template-columns: 1fr 2.25rem; }`.

- [ ] **Step 7: Run.**
Run: `npx vitest run __tests__/components/funnels/QuizRunner.test.tsx __tests__/components/funnels/quiz-runner-funnel.test.tsx __tests__/lib/funnels/sections/quiz-section.test.ts`
Expected: PASS. If a styles snapshot or contrast test exists for the quiz section, it may fail on the new rules. Read the failure first. Update a snapshot only if the diff is exactly the added rules.

- [ ] **Step 8: Commit.**
```bash
git add components/funnels/islands/QuizRunner.tsx lib/funnels/sections/styles.ts __tests__/components/funnels/QuizRunner.test.tsx
git commit -m "feat(quiz): common-mistakes clip toggle and the mini-assessment result"
```

---

### Task 4: Signed upload route

**Files:**
- Create: `app/api/admin/quizzes/[id]/media-upload-url/route.ts`
- Test: `__tests__/app/api/admin/quizzes/media-upload-url.test.ts` (new)

**Interfaces — Produces:** `POST /api/admin/quizzes/:id/media-upload-url`. Body: `{ filename: string, contentType: "video/mp4" | "video/quicktime" | "video/webm" | "image/jpeg" | "image/png" }`. Response 200: `{ uploadUrl: string, publicUrl: string }`. Errors: 404 for a non-admin, a bad id, or a missing or foreign quiz; 403 when the caller has no business; 400 for a bad body.

- [ ] **Step 1: Failing test.**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const auth = vi.fn()
const resolveAdminTenantForRequest = vi.fn()
const getQuizDefinition = vi.fn()
const getSignedUrl = vi.fn(async () => ["https://signed.example/put"])
const file = vi.fn(() => ({ getSignedUrl }))

vi.mock("@/lib/auth", () => ({ auth: () => auth() }))
vi.mock("@/lib/db/quizzes", () => ({ getQuizDefinition: (...a: unknown[]) => getQuizDefinition(...a) }))
vi.mock("@/lib/firebase-admin", () => ({ getAdminStorage: () => ({ bucket: () => ({ name: "bucket-x", file }) }) }))
vi.mock("@/lib/tenancy/resolve", async () => {
  class NoAccessibleBusinessError extends Error {}
  return { NoAccessibleBusinessError, resolveAdminTenantForRequest: (...a: unknown[]) => resolveAdminTenantForRequest(...a) }
})

import { POST } from "@/app/api/admin/quizzes/[id]/media-upload-url/route"

const QUIZ_ID = "1b93a8c7-c08f-4716-a6e0-226d61bdf820"
const call = (body: unknown, id = QUIZ_ID) =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: "u", role: "admin" } })
  resolveAdminTenantForRequest.mockResolvedValue({ businessId: "biz" })
  getQuizDefinition.mockResolvedValue({ id: QUIZ_ID, key: "rotational-performance-index" })
})

describe("POST media-upload-url", () => {
  it("404s a non-admin and signs nothing", async () => {
    auth.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await call({ filename: "a.mp4", contentType: "video/mp4" })).status).toBe(404)
    expect(getSignedUrl).not.toHaveBeenCalled()
  })

  it("404s a quiz outside the caller's business", async () => {
    getQuizDefinition.mockResolvedValue(null)
    expect((await call({ filename: "a.mp4", contentType: "video/mp4" })).status).toBe(404)
    expect(getQuizDefinition).toHaveBeenCalledWith("biz", QUIZ_ID)
  })

  it("400s a content type that is not a clip or a poster", async () => {
    expect((await call({ filename: "a.exe", contentType: "application/octet-stream" })).status).toBe(400)
  })

  it("signs a WRITE url under quiz-media/<quizKey>/ and returns the durable public url", async () => {
    const res = await call({ filename: "Test 3.mov", contentType: "video/quicktime" })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { uploadUrl: string; publicUrl: string }
    expect(json.uploadUrl).toBe("https://signed.example/put")
    const path = (file.mock.calls[0] as unknown as [string])[0]
    expect(path).toMatch(/^quiz-media\/rotational-performance-index\/\d+-Test_3\.mov$/)
    expect(getSignedUrl).toHaveBeenCalledWith(expect.objectContaining({ version: "v4", action: "write", contentType: "video/quicktime" }))
    expect(json.publicUrl).toBe(`https://firebasestorage.googleapis.com/v0/b/bucket-x/o/${encodeURIComponent(path)}?alt=media`)
  })
})
```

- [ ] **Step 2: Run. It must fail.**
Run: `npx vitest run __tests__/app/api/admin/quizzes/media-upload-url.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement.**

```ts
// app/api/admin/quizzes/[id]/media-upload-url/route.ts
//
// Hands the quiz editor a signed WRITE url so a clip goes straight from the
// browser to Firebase Storage. Proxying the bytes through this route is not
// an option: Vercel caps a request body at 4.5 MB, and a phone clip is ten
// times that.
//
// The object lands under quiz-media/<quizKey>/, the only prefix storage.rules
// makes publicly readable, and the editor stores the DURABLE download url this
// returns, never the signed one (see lib/quiz-media-storage.ts for why).
//
// Same guard as PATCH /api/admin/quizzes/[id]: admin, the caller's business,
// and a foreign quiz reads as absent.
//
// No Cache-Control is signed. An extra signed header also has to pass the
// bucket's CORS config, which nothing here verifies, and a CORS refusal is a
// silent dead upload. Editor uploads get Firebase's default caching instead
// of the upload script's "immutable" — the timestamp in the name already
// makes every re-upload a new object.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getQuizDefinition } from "@/lib/db/quizzes"
import { getAdminStorage } from "@/lib/firebase-admin"
import { quizMediaPublicUrl, quizMediaStoragePath } from "@/lib/quiz-media-storage"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"

const UPLOAD_URL_EXPIRY_MS = 15 * 60 * 1000

const bodySchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.enum(["video/mp4", "video/quicktime", "video/webm", "image/jpeg", "image/png"]),
})

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user?.role !== "admin") return notFound()

  let businessId: string
  try {
    ;({ businessId } = await resolveAdminTenantForRequest(request))
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    throw err
  }

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) return notFound()

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "That file type cannot be used for a quiz clip." }, { status: 400 })

  const quiz = await getQuizDefinition(businessId, id)
  if (!quiz) return notFound()

  const storagePath = quizMediaStoragePath(quiz.key, `${Date.now()}-${parsed.data.filename}`)
  const bucket = getAdminStorage().bucket()
  const [uploadUrl] = await bucket.file(storagePath).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + UPLOAD_URL_EXPIRY_MS,
    contentType: parsed.data.contentType,
  })

  return NextResponse.json({ uploadUrl, publicUrl: quizMediaPublicUrl(bucket.name, storagePath) })
}
```

- [ ] **Step 4: Run. It must pass.**
Run: `npx vitest run __tests__/app/api/admin/quizzes/media-upload-url.test.ts`
Expected: PASS. The safeSegment rule turns `"<ts>-Test 3.mov"` into `"<ts>-Test_3.mov"`. If the regex assertion fails on that, read `quizMediaStoragePath` and fix the test's expectation, not the helper.

- [ ] **Step 5: Commit.**
```bash
git add "app/api/admin/quizzes/[id]/media-upload-url/route.ts" __tests__/app/api/admin/quizzes/media-upload-url.test.ts
git commit -m "feat(quiz): signed upload url for quiz clips"
```

---

### Task 5: Poster-frame helper

**Files:**
- Create: `lib/quizzes/poster-frame.ts`

This is its own module so the editor test can mock it. jsdom never fires video events, so the real one would wait out its timeout.

- [ ] **Step 1: Implement** (it is browser-only and covered through Task 6's mocked boundary, so it gets no unit test of its own):

```ts
// lib/quizzes/poster-frame.ts — a JPEG poster grabbed in the browser.
//
// Resolves null instead of throwing whenever it cannot: Chrome cannot decode
// an iPhone HEVC .mov, a corrupt file never fires loadeddata, and a clip with
// no poster still works (the player shows its first frame once played). The
// timeout is what makes "never fires" a null rather than a hung upload.

const TIMEOUT_MS = 8000

export async function grabPosterFrame(file: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(file)
  const video = document.createElement("video")
  try {
    video.muted = true
    video.playsInline = true
    video.preload = "auto"
    const settle = (event: "loadeddata" | "seeked") =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), TIMEOUT_MS)
        video.addEventListener(event, () => { clearTimeout(timer); resolve(true) }, { once: true })
        video.addEventListener("error", () => { clearTimeout(timer); resolve(false) }, { once: true })
      })
    const loaded = settle("loadeddata")
    video.src = url
    if (!(await loaded)) return null
    const seeked = settle("seeked")
    video.currentTime = Math.min(1, (video.duration || 0) / 2)
    if (!(await seeked)) return null
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext("2d")
    if (!context || canvas.width === 0) return null
    context.drawImage(video, 0, 0)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))
  } finally {
    video.removeAttribute("src")
    URL.revokeObjectURL(url)
  }
}
```

- [ ] **Step 2: Compile check.**
Run: `npx tsc --noEmit -p "$W" 2>&1 | grep poster-frame`
Expected: no output.

- [ ] **Step 3: Commit.**
```bash
git add lib/quizzes/poster-frame.ts
git commit -m "feat(quiz): grab a poster frame from a clip in the browser"
```

---

### Task 6: Editor — clip pickers and results-map fields

**Files:**
- Create: `components/admin/quizzes/QuizClipPicker.tsx`
- Modify: `components/admin/quizzes/QuizEditor.tsx` (question card ~669-685, save payload ~329-366)
- Test: `__tests__/components/admin/QuizClipPicker.test.tsx` (new), `__tests__/components/admin/QuizEditor.test.tsx`

**Interfaces — Consumes:** `POST /api/admin/quizzes/:id/media-upload-url` (Task 4), `grabPosterFrame` (Task 5), the `QuizQuestion` fields from Task 1.
**Interfaces — Produces:** `QuizClipPicker({ quizId, label, url, onChange })`, where `onChange(next: { url: string | null; posterUrl: string | null })`.

- [ ] **Step 1: Failing picker tests.** Create `__tests__/components/admin/QuizClipPicker.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const grabPosterFrame = vi.fn()
vi.mock("@/lib/quizzes/poster-frame", () => ({ grabPosterFrame: (...a: unknown[]) => grabPosterFrame(...a) }))

import { QuizClipPicker } from "@/components/admin/quizzes/QuizClipPicker"

const QUIZ_ID = "1b93a8c7-c08f-4716-a6e0-226d61bdf820"
const clip = new File([new Uint8Array(10)], "copenhagen.mp4", { type: "video/mp4" })

function stubFetch(putStatus = 200) {
  let n = 0
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/media-upload-url")) {
      n += 1
      return new Response(JSON.stringify({ uploadUrl: `https://signed/${n}`, publicUrl: `https://public/${n}` }), { status: 200 })
    }
    expect(init?.method).toBe("PUT")
    return new Response(null, { status: putStatus })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => vi.clearAllMocks())

describe("QuizClipPicker", () => {
  it("uploads the clip and its poster, then reports both public urls", async () => {
    grabPosterFrame.mockResolvedValue(new Blob(["jpg"], { type: "image/jpeg" }))
    const fetchMock = stubFetch()
    const onChange = vi.fn()
    render(<QuizClipPicker quizId={QUIZ_ID} label="Demo clip" url={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("Demo clip"), { target: { files: [clip] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ url: "https://public/1", posterUrl: "https://public/2" }))
    expect(fetchMock).toHaveBeenCalledWith(`/api/admin/quizzes/${QUIZ_ID}/media-upload-url`, expect.anything())
  })

  it("uploads the clip even when no poster can be grabbed", async () => {
    grabPosterFrame.mockResolvedValue(null)
    stubFetch()
    const onChange = vi.fn()
    render(<QuizClipPicker quizId={QUIZ_ID} label="Demo clip" url={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("Demo clip"), { target: { files: [clip] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ url: "https://public/1", posterUrl: null }))
  })

  it("a failed PUT shows the error and changes nothing", async () => {
    grabPosterFrame.mockResolvedValue(null)
    stubFetch(403)
    const onChange = vi.fn()
    render(<QuizClipPicker quizId={QUIZ_ID} label="Demo clip" url={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("Demo clip"), { target: { files: [clip] } })
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Upload failed \(403\)/))
    expect(onChange).not.toHaveBeenCalled()
  })

  it("warns, but still uploads, above 25 MB", async () => {
    grabPosterFrame.mockResolvedValue(null)
    stubFetch()
    const onChange = vi.fn()
    const big = new File([new Uint8Array(10)], "big.mp4", { type: "video/mp4" })
    Object.defineProperty(big, "size", { value: 40 * 1024 * 1024 })
    render(<QuizClipPicker quizId={QUIZ_ID} label="Demo clip" url={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("Demo clip"), { target: { files: [big] } })
    expect(screen.getByText(/40 MB/)).toBeTruthy()
    await waitFor(() => expect(onChange).toHaveBeenCalled())
  })

  it("Remove clears the clip and the poster", () => {
    const onChange = vi.fn()
    render(<QuizClipPicker quizId={QUIZ_ID} label="Demo clip" url="https://public/x.mp4" onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Remove Demo clip" }))
    expect(onChange).toHaveBeenCalledWith({ url: null, posterUrl: null })
  })
})
```

- [ ] **Step 2: Run. It must fail.**
Run: `npx vitest run __tests__/components/admin/QuizClipPicker.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `components/admin/quizzes/QuizClipPicker.tsx`.**

```tsx
"use client"
// One clip slot on a quiz question: pick a video, it goes straight to
// Firebase through a signed url (Vercel caps request bodies at 4.5 MB), a
// poster is grabbed in the browser, and the two DURABLE urls come back to the
// editor. Nothing is written to the quiz until the editor's own Save.

import { useState } from "react"
import { grabPosterFrame } from "@/lib/quizzes/poster-frame"

const WARN_BYTES = 25 * 1024 * 1024

async function upload(quizId: string, body: Blob, filename: string, contentType: string): Promise<string> {
  const res = await fetch(`/api/admin/quizzes/${quizId}/media-upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType }),
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(json?.error ?? "Could not start the upload.")
  }
  const { uploadUrl, publicUrl } = (await res.json()) as { uploadUrl: string; publicUrl: string }
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body })
  if (!put.ok) throw new Error(`Upload failed (${put.status}). Try again.`)
  return publicUrl
}

export function QuizClipPicker({
  quizId,
  label,
  url,
  onChange,
}: {
  quizId: string
  label: string
  url: string | null
  onChange: (next: { url: string | null; posterUrl: string | null }) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  async function pick(file: File) {
    setError(null)
    setWarning(
      file.size > WARN_BYTES
        ? `This file is ${Math.round(file.size / 1048576)} MB. Visitors on phones will wait for it to load — a shorter clip is better.`
        : null,
    )
    setBusy(true)
    try {
      const contentType = file.type || "video/mp4"
      const clipUrl = await upload(quizId, file, file.name, contentType)
      const poster = await grabPosterFrame(file)
      const posterUrl = poster ? await upload(quizId, poster, `${file.name}-poster.jpg`, "image/jpeg") : null
      onChange({ url: clipUrl, posterUrl })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-foreground">
        {label}
        <input
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          aria-label={label}
          disabled={busy}
          className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ""
            if (file) void pick(file)
          }}
        />
      </label>
      {busy ? <p className="text-xs text-muted-foreground">Uploading…</p> : null}
      {warning ? <p className="text-xs text-warning">{warning}</p> : null}
      {error ? <p role="alert" className="text-xs text-error">{error}</p> : null}
      {url ? (
        <div className="flex items-start gap-2">
          <video src={url} controls muted preload="metadata" className="h-24 rounded-md border border-border" />
          <button
            type="button"
            aria-label={`Remove ${label}`}
            className="text-xs text-muted-foreground underline"
            onClick={() => onChange({ url: null, posterUrl: null })}
          >
            Remove
          </button>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Run picker tests.**
Run: `npx vitest run __tests__/components/admin/QuizClipPicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into the editor.** In `QuizEditor.tsx`, import `QuizClipPicker` and `type QuizSide`. Inside each question card, directly after the `{!question.isActive ? … : null}` note inside `<div className="flex-1">`, add:

```tsx
<details className="mt-3 rounded-md border border-border p-3">
  <summary className="cursor-pointer text-sm font-medium">
    Video and results map{question.mediaUrl || question.mistakesMediaUrl ? " · has video" : ""}
  </summary>
  <div className="mt-3 grid gap-4 sm:grid-cols-2">
    <QuizClipPicker
      quizId={quiz.id}
      label="Demo clip"
      url={question.mediaUrl}
      onChange={({ url, posterUrl }) => patchQuestion(question.id, { mediaUrl: url, mediaPosterUrl: posterUrl })}
    />
    <QuizClipPicker
      quizId={quiz.id}
      label="Common mistakes clip"
      url={question.mistakesMediaUrl ?? null}
      onChange={({ url, posterUrl }) =>
        patchQuestion(question.id, { mistakesMediaUrl: url, mistakesMediaPosterUrl: posterUrl })
      }
    />
    <Field
      label="Results map label"
      value={question.reportLabel ?? ""}
      onChange={(v) => patchQuestion(question.id, { reportLabel: v.trim() ? v : null })}
    />
    <label className="block text-sm font-medium text-foreground">
      Side
      <select
        className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
        value={question.side ?? ""}
        onChange={(event) => patchQuestion(question.id, { side: (event.target.value || null) as QuizSide | null })}
      >
        <option value="">None</option>
        <option value="left">Left</option>
        <option value="right">Right</option>
      </select>
    </label>
  </div>
  <p className="mt-2 text-xs text-muted-foreground">
    Questions with the same results map label show as one row on the results page. Give a left and a right attempt
    the same label and pick their sides, and the visitor sees both sides compared.
  </p>
</details>
```
  Check `Field`'s props at line ~933 before using it. If it requires props not shown here, pass them the way the prompt `Field` does.
  In the save payload, add to BOTH the `questions` map and the `addQuestions` map, after `mediaPosterUrl`:
  ```ts
  mistakesMediaUrl: q.mistakesMediaUrl ?? null,
  mistakesMediaPosterUrl: q.mistakesMediaPosterUrl ?? null,
  reportLabel: q.reportLabel?.trim() ? q.reportLabel.trim() : null,
  side: q.side ?? null,
  ```
  In the new-question default (~line 137), add the same four fields as `null`.

- [ ] **Step 6: Editor payload test.** In `__tests__/components/admin/QuizEditor.test.tsx`, add:
```tsx
it("saves the results-map label and side a human typed", async () => {
  render(<QuizEditor initial={healthy()} />)
  openQuestions()
  fireEvent.click(screen.getAllByText(/Video and results map/)[0])
  fireEvent.change(screen.getAllByLabelText("Results map label")[0], { target: { value: "  Copenhagen  " } })
  fireEvent.change(screen.getAllByLabelText("Side")[0], { target: { value: "left" } })
  fireEvent.click(screen.getByRole("button", { name: "Save" }))
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  const body = JSON.parse((fetchMock.mock.calls.at(-1) as [string, RequestInit])[1].body as string)
  expect(body.questions.some((q: { reportLabel: string | null; side: string | null }) => q.reportLabel === "Copenhagen" && q.side === "left")).toBe(true)
})
```
  If `Field` does not associate its label with its input, `getAllByLabelText("Results map label")` fails. Fix it by passing an `id` or wrapping, following however the editor's other labelled inputs are queried in that test file.

- [ ] **Step 7: Run.**
Run: `npx vitest run __tests__/components/admin/QuizClipPicker.test.tsx __tests__/components/admin/QuizEditor.test.tsx __tests__/components/admin/QuizEditor.structural.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit.**
```bash
git add components/admin/quizzes/QuizClipPicker.tsx components/admin/quizzes/QuizEditor.tsx __tests__/components/admin/QuizClipPicker.test.tsx __tests__/components/admin/QuizEditor.test.tsx
git commit -m "feat(quiz): upload demo and mistakes clips from the quiz editor"
```

---

### Task 7: Cut and upload the five mistakes clips

**Files:** none tracked. Output goes to the main checkout's gitignored `media/` so that removing the worktree cannot destroy it.

- [ ] **Step 1: Cut.**
```bash
SRC="$HOME/Downloads"
OUT="/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/media/quiz-rotational-reboot-mistakes"
mkdir -p "$OUT"
cutclip() {
  ffmpeg -y -v error -ss "$2" -i "$SRC/$1" -vf "scale=1280:720" -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p \
    -c:a aac -b:a 96k -movflags +faststart -sn "$OUT/$3.mp4" &&
  ffmpeg -y -v error -ss 1 -i "$OUT/$3.mp4" -frames:v 1 -q:v 3 "$OUT/$3-poster.jpg"
}
cutclip "Test 1_Prone_compensate.MOV.mp4"        65.0 1-prone-hip-abduction-mistakes
cutclip "Test 2_Rocking Hollows.MOV.mp4"         75.0 2-rocking-hollow-mistakes
cutclip "Test 3_Short lever Copenhagen.MOV.mp4"  60.0 3-short-lever-copenhagen-mistakes
cutclip "Test 4_Windshield wiper.MOV.mp4"        53.3 4-windshield-wipers-mistakes
cutclip "Test 5_ Retro backwards jump.MOV.mp4"   64.3 5-retro-backwards-hop-mistakes
```

- [ ] **Step 2: Verify by probing and looking.**
Run: `for f in "$OUT"/*.mp4; do ffprobe -v error -show_entries format=duration,size:stream=codec_type,width,height -of compact "$f"; done`
Expected for each: video 1280×720, an audio stream, duration 18–47 s, size under 6 MB.
Then extract the frame at +3 s from each clip and **Read the images**. Each must show Darren mid-demonstration. It must not be a black frame or the end of the "good" rep. If a cut starts too early, re-cut with a later start and say so in the commit notes.

- [ ] **Step 3: Upload (live bucket — new objects only).**
Run: `npx tsx scripts/upload-quiz-media.ts "$OUT" rotational-reboot` (from the worktree, so `.env.local` and `node_modules` resolve)
Expected: 10 `✓` lines and `$OUT/urls.json` written.

- [ ] **Step 4: Prove they serve.**
Run: `for u in $(jq -r '.[]' "$OUT/urls.json"); do curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "$u"; done`
Expected: ten `200` lines, with `video/mp4` or `image/jpeg`.

No commit (no tracked files).

---

### Task 8: Seed and the live-row backfill

**Files:**
- Modify: `lib/quizzes/seed/rotational-performance-index.ts` (MovementTest, SeedQuestion, movementQuestions, tier bodies, the QuizQuestion mapping ~line 496)
- Create: `supabase/migrations/00287_rpi_results_map_backfill.sql`
- Test: `__tests__/lib/quizzes/rotational-performance-index.test.ts`

- [ ] **Step 1: Failing seed tests.** Append to `__tests__/lib/quizzes/rotational-performance-index.test.ts` (use that file's existing import of the built definition; it already asserts `mediaUrl` around line 229):

```ts
describe("RPI — results map and mistakes clips", () => {
  const movement = () => rpiDefinition().questions.filter((q) => q.mediaUrl)

  it("every movement question is on the map, and paired tests have exactly one left and one right", () => {
    const byLabel = new Map<string, string[]>()
    for (const q of movement()) {
      expect(q.reportLabel).toBeTruthy()
      byLabel.set(q.reportLabel!, [...(byLabel.get(q.reportLabel!) ?? []), q.side ?? "single"])
    }
    expect(byLabel.get("Rocking hollow")).toEqual(["single"])
    for (const [label, sides] of byLabel) if (label !== "Rocking hollow") expect(sides.sort()).toEqual(["left", "right"])
    expect(byLabel.size).toBe(5)
  })

  it("every movement question has a mistakes clip under quiz-media/rotational-reboot/ named -mistakes", () => {
    for (const q of movement()) {
      expect(q.mistakesMediaUrl).toMatch(/quiz-media%2Frotational-reboot%2F\d-[a-z-]+-mistakes\.mp4\?alt=media$/)
      expect(q.mistakesMediaPosterUrl).toMatch(/-mistakes-poster\.jpg\?alt=media$/)
    }
  })

  it("red, orange and yellow reframe the result as a structure problem; every tier keeps its CTA", () => {
    const tiers = rpiDefinition().tiers
    for (const key of ["red", "orange", "yellow"]) {
      expect(tiers.find((t) => t.key === key)!.body).toContain("This isn't an effort problem. It's a structure problem")
    }
    for (const t of tiers) expect(t.ctaHref).toBeTruthy()
  })
})
```
  Replace `rpiDefinition()` with the file's actual accessor for the built `QuizDefinition`. Read the top of the test file first and use exactly what the existing `mediaUrl` assertions use.

- [ ] **Step 2: Run. It must fail.**
Run: `npx vitest run __tests__/lib/quizzes/rotational-performance-index.test.ts`

- [ ] **Step 3: Seed changes.**
  - `SeedQuestion`: add `mistakesMediaUrl?: string | null; mistakesMediaPosterUrl?: string | null; reportLabel?: string | null; side?: "left" | "right" | null`.
  - `movementQuestions()`: on each pushed question add
    ```ts
    mistakesMediaUrl: clip(`${test.file}-mistakes.mp4`),
    mistakesMediaPosterUrl: clip(`${test.file}-mistakes-poster.jpg`),
    reportLabel: test.name,
    side,
    ```
  - Mapping to `QuizQuestion` (~line 496): add the four fields with `?? null`.
  - Replace the four tier `body` strings with the spec's §6.2 copy, verbatim, using `\n\n` between paragraphs. Do not keep the old strings here; 00287 carries them as SQL literals.

- [ ] **Step 4: Run seed tests.**
Run: `npx vitest run __tests__/lib/quizzes/rotational-performance-index.test.ts __tests__/lib/quizzes/seed-rpi.test.ts`
Expected: PASS.

- [ ] **Step 5: Backfill migration.** Create `supabase/migrations/00287_rpi_results_map_backfill.sql`. Copy the four OLD tier bodies verbatim from `git show HEAD~1:lib/quizzes/seed/rotational-performance-index.ts` (lines ~362, 372, 382, 392) and the four NEW ones from the seed. Escape `'` as `''`. Write `\n\n` as `E'\n\n'` concatenation or a literal newline inside the string.

```sql
-- 00287_rpi_results_map_backfill.sql
-- Puts the live Rotational Performance Index on the results map and gives
-- each movement test its common-mistakes clip.
--
-- SCOPED to quizzes.key = 'rotational-performance-index'. A database without
-- that quiz is untouched. Every update fills only what is still NULL, or copy
-- that is still exactly the seed's original text: copy a human has edited in
-- the quiz editor is left alone. Re-running is a no-op.
--
-- The seed (lib/quizzes/seed/rotational-performance-index.ts) is the source
-- of truth for a fresh seed; this migration brings an already-seeded quiz up
-- to it.

-- 1. Paired tests: "<Test> — left side: …" / "<Test> — right side: …"
update public.quiz_questions qq
   set report_label = (regexp_match(qq.prompt, '^(.+?) — (left|right) side:'))[1],
       side         = (regexp_match(qq.prompt, '^(.+?) — (left|right) side:'))[2]
 where qq.quiz_id in (select id from public.quizzes where key = 'rotational-performance-index')
   and qq.report_label is null
   and qq.prompt ~ '^(.+?) — (left|right) side:';

-- 2. The one unpaired test.
update public.quiz_questions qq
   set report_label = 'Rocking hollow'
 where qq.quiz_id in (select id from public.quizzes where key = 'rotational-performance-index')
   and qq.report_label is null
   and qq.prompt like 'Rocking hollow:%';

-- 3. Mistakes clips, by the label just written.
update public.quiz_questions qq
   set mistakes_media_url = v.url,
       mistakes_media_poster_url = v.poster
  from (values
    ('Prone hip abduction with external rotation', '1-prone-hip-abduction'),
    ('Rocking hollow',                              '2-rocking-hollow'),
    ('Short lever Copenhagen',                      '3-short-lever-copenhagen'),
    ('Windshield wipers',                           '4-windshield-wipers'),
    ('Retro backwards hop',                         '5-retro-backwards-hop')
  ) as f(label, file),
  lateral (select
    'https://firebasestorage.googleapis.com/v0/b/darrenjpaulcom.firebasestorage.app/o/quiz-media%2Frotational-reboot%2F' || f.file || '-mistakes.mp4?alt=media' as url,
    'https://firebasestorage.googleapis.com/v0/b/darrenjpaulcom.firebasestorage.app/o/quiz-media%2Frotational-reboot%2F' || f.file || '-mistakes-poster.jpg?alt=media' as poster
  ) as v
 where qq.report_label = f.label
   and qq.mistakes_media_url is null
   and qq.quiz_id in (select id from public.quizzes where key = 'rotational-performance-index');

-- 4. Tier copy — only where it is still the seed's original.
update public.quiz_tiers t
   set body = n.body
  from (values
    ('red',    '<OLD red body>',    '<NEW red body>'),
    ('orange', '<OLD orange body>', '<NEW orange body>'),
    ('yellow', '<OLD yellow body>', '<NEW yellow body>'),
    ('green',  '<OLD green body>',  '<NEW green body>')
  ) as n(key, old_body, body)
 where t.key = n.key
   and t.body = n.old_body
   and t.quiz_id in (select id from public.quizzes where key = 'rotational-performance-index');
```
  The `<OLD …>` / `<NEW …>` markers here are **instructions to paste the literal strings from the sources named above**. Before committing, `grep -c "<OLD\|<NEW" 00287_*.sql` must print `0`.

- [ ] **Step 6: Apply to the dev clone and verify the rows.**
  Apply through the dev MCP `apply_migration` (name `rpi_results_map_backfill`). Then run on the dev clone:
  ```sql
  select report_label, side, count(*), count(mistakes_media_url) as with_mistakes
    from quiz_questions where quiz_id = '1b93a8c7-c08f-4716-a6e0-226d61bdf820' and report_label is not null
   group by 1, 2 order by 1, 2;
  select key, left(body, 60) from quiz_tiers where quiz_id = '1b93a8c7-c08f-4716-a6e0-226d61bdf820' order by position;
  ```
  Expected: 9 rows across 5 labels (4 × left/right, 1 × null side), each `with_mistakes = count`. All four tier bodies start with the new copy. If a tier did NOT update, its dev body differs from the seed original. Report it; do not widen the match.
  Then: `npm run test:integration:drift --prefix "$W"` → PASS.

- [ ] **Step 7: Commit.**
```bash
git add lib/quizzes/seed/rotational-performance-index.ts supabase/migrations/00287_rpi_results_map_backfill.sql __tests__/lib/quizzes/rotational-performance-index.test.ts
git commit -m "feat(quiz): put the Rotational Performance Index on the results map"
```

---

### Task 9: Verify in the real app, screenshot, journal

**Files:**
- Create: `screenshots/rpi-video-quiz-gaps/` (annotated PNGs + `index.html`), `scripts/capture-rpi-video-quiz-gaps.ts`
- Modify: `JOURNAL.md` in the MAIN checkout (never committed)

- [ ] **Step 1: Build gate.**
Run: `npx tsc --noEmit -p "$W" 2>&1 | grep -c "error TS"`
Expected: equal to the Task 0 baseline. Then `... | grep -E "quiz|report|present-result|poster-frame|QuizClipPicker|styles.ts"` → no output.

- [ ] **Step 2: Select gate.**
Run: `npm run test:integration:selects --prefix "$W"` → PASS.

- [ ] **Step 3: Drive the real app** (`npm run dev` in the worktree, port 3050; use `--webpack` if Turbopack fails on Google fonts). Sign in as an admin off camera. Capture, light mode only (admin UI is light-only), with the pointer parked:
  1. `/admin/funnels/quizzes/1b93a8c7-…` → Questions → one movement question's "Video and results map" expanded, showing both clips, the label and the side.
  2. Upload a real file through the picker (one of the 720p clips), confirm the preview appears, and **do not Save**. This proves the signed PUT and the bucket CORS against the live bucket. If the PUT is refused, stop and report the exact status and response. That is a CORS config change the owner must approve.
  3. `/preview/<rpi funnel slug>` → a movement question with "Common mistakes" selected, the mistakes clip showing.
  4. The same preview walked to the result as a test run. Pick answers that give at least one `gap` row and one `solid` row (e.g. Copenhagen left "All three", right "One of the three"). Capture the mirror, the map and the CTA.
  5. The athlete quiz's result via `/preview/athlete-quiz` test run. This is the no-regression shot: no map, no mirror.
  Burn numbered markers and captions into each PNG at its native width (derive marker positions from `boundingBox × deviceScaleFactor`). Write `index.html` referencing the sibling PNGs.

- [ ] **Step 4: Commit the capture script and screenshots.**
```bash
git add scripts/capture-rpi-video-quiz-gaps.ts screenshots/rpi-video-quiz-gaps
git commit -m "docs(quiz): annotated screenshots of the RPI video quiz gaps"
```

- [ ] **Step 5: Journal.** Add a dated `[Feature build-out]` entry to the main checkout's `JOURNAL.md` covering: branch and SHAs; what is verified and how; the prod key for 00287 still being unverified; the CORS result from step 3.2; mistakes made, with their lessons. Do not stage it.

- [ ] **Step 6: Whole-branch review** (one fresh reviewer, diff handed over as a file), then report. **Owner actions to list, not do:**
  1. Confirm the prod quiz key is `rotational-performance-index` with one read: `select key from quizzes where id = '8698d925-ae9a-4c8a-873a-9d0696d2544f'`.
  2. Merge to `main`, which applies 00286 and 00287 to prod and deploys.
  3. Publish the RPI funnel in `/admin/funnels`. Its CSS freezes at publish, so this has to happen after the merge.
  4. Decide on the two clone quizzes.
