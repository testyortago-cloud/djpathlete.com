# Excel → AI Program Import — Design Spec

**Date:** 2026-07-09
**Status:** Approved-by-default (authored autonomously while the user was away; user to review on return)
**Author:** Claude (autonomous session)

## 1. Summary

Add a feature to `/admin/programs` that lets a coach **upload an Excel spreadsheet** describing a training program. The AI **reads whatever is in the sheet** — a fully-built program, a partial one, or a messy real-world coach sheet — matches the exercises to the library, **fills the gaps**, and produces a complete, ready-to-review program in the coach's library.

A **downloadable `.xlsx` template** is provided as the "happy path": coaches who fill it in produce a clean, structured sheet that imports fast with minimal AI interpretation. Coaches who upload their own free-form sheet get the AI-interpretation fallback.

The resulting program can be **client-specific** (coach attaches a client; the AI uses that client's profile to fill gaps) or a **generic library program** (no client; reusable, assigned later). The coach chooses per upload.

## 2. Goals & non-goals

### Goals
- Upload `.xlsx`/`.xls` → a complete `programs` row + `program_exercises` rows, faithful to the sheet.
- Handle full, partial, and messy sheets (Scenario C).
- Resolve exercise names to the exercise library; never silently drop an exercise.
- Fill missing prescription fields (sets/reps/rest/etc.) with sensible defaults, using client context when a client is attached.
- Produce an **import report** the coach reviews before assigning.
- Ship a downloadable, validated template.
- DB-backed feature flag; admin-only.

### Non-goals (explicitly out of scope — documented as future enhancements)
- **Auto-progression of load** across weeks the sheet leaves blank. Blank weeks use the existing "repeat last built week" client behavior (`lib/program-weeks.ts` `sourceWeekForDisplay`). Inventing novel progressive overload for whole missing weeks is the existing **AI Generate** feature's job, not this one.
- **Auto-assigning** the program to the attached client. The client is used only for gap-filling context; the coach assigns afterward through the existing `assignProgram` flow (which enforces payment gating).
- **Interactive per-row edit-before-commit** preview. The coach reviews and edits the created (private) program in the existing `ProgramBuilder` after import.
- Batch/multi-file import; editing an existing program from a sheet (import always creates a **new** program).

## 3. Scope boundary (the one-sentence rule)

> This feature **faithfully imports and intelligently completes the sheet the coach gave it.** It does not design programming the coach didn't at least imply. Full from-scratch design remains **AI Generate**.

## 4. Architecture

Reuses the existing background-job pipeline used by AI Generate. Two runtimes, split at the `exceljs` boundary:

- **`exceljs` lives only in the Next.js app** (not in `functions/package.json`). Therefore **parsing happens in the Next.js API route**, and the Firebase Function receives a bounded JSON grid — never the binary file. This also keeps the file out of the Firestore job doc.

### End-to-end flow

```
Coach (ExcelImportDialog)
  │  picks optional client + options, uploads .xlsx
  ▼
POST /api/admin/programs/import-excel           [Next.js, admin + flag gated]
  │  • validate MIME/size, auth, flag
  │  • exceljs: workbook → ParsedSheet (bounded 2D string grid per sheet)
  │  • create ai_generation_log row (status: pending)
  │  • createAiJob({ type: "program_from_excel", input: { parsedSheet, client_id, options, logId, notify_email } })
  ▼  202 { jobId, log_id }
Firestore ai_jobs/{jobId} created
  ▼
programFromExcel  (onDocumentCreated, type-guard)  [Firebase Function, 540s]
  → handleProgramFromExcel(jobId):
       1. mark processing; progress updater + cancellation checker
       2. INTERPRET  — callAgent(PROGRAM_IMPORT_PROMPT, renderedSheet + optional clientProfile,
                        programImportSchema)  →  ProgramImportPlan (metadata + days + exercises + notes/gaps/assumptions)
       3. RESOLVE    — for each unique raw exercise name: exact→semantic(match_exercises)→fuzzy;
                        if no confident match, CREATE a source-tagged library exercise (+ auto-embed).
                        Track match method + confidence per name.
       4. BUILD      — plan → program_exercises rows (resolved exercise_id + prescription; defaults fill blanks)
       5. PERSIST    — createProgram({ is_ai_generated:true, is_public, created_by, tier,
                        ai_generation_params: { source:"excel_import", import_report, ... , token_usage } })
                        + bulkAddExercisesToProgram(rows)
       6. update ai_generation_log → completed; write result to Firestore/RTDB; notify email
  ▼
ExcelImportDialog live-listens RTDB → shows progress → "View Program" / "Assign to Clients"
Program detail page renders an "Imported from Excel" report card (from ai_generation_params).
```

### Client live-listening / progress
Reuse `AiGenerateDialog`'s pattern verbatim: RTDB live listener, floating jobs dock (`useAiJobsDock`), cancel via a cancel route, stale-check fallback. A small fixed list of progress steps (`Parsing`, `Interpreting`, `Matching exercises`, `Building program`, `Done`).

## 5. Components (each with a single clear purpose)

### New — Next.js side
- **`lib/excel-templates.ts` → `generateProgramTemplate()`** (extend existing file). Builds the `.xlsx`: an **Info** sheet (Program Name, Description, Weeks, Sessions/Week, Split, Periodization, Difficulty, Tier, Public?), a **Workout** sheet (columns below), and an **Instructions** sheet. Dropdowns for Day, Technique, Split, Difficulty, Tier. One filled example block.
  - Workout columns: `Week | Day | Exercise | Sets | Reps | Rest (s) | RPE | Tempo | Technique | Group/Superset | Notes`.
- **`lib/excel/parse-program-sheet.ts`** — `parseWorkbookToSheet(buffer): ParsedSheet`. Uses `exceljs` `workbook.xlsx.load(arrayBuffer)`; emits a bounded 2D string grid per sheet (trim cells, cap rows/cols, drop fully-empty trailing rows). Pure and unit-testable. **No AI, no interpretation** — just faithful extraction.
- **`lib/validators/program-import.ts`** — Zod: `parsedSheetSchema` (grid shape) + `programImportOptionsSchema` (client_id?, is_public?, name_override?, notify_email?). Shared request validation.
- **`app/api/admin/programs/import-excel/route.ts`** — `POST`: admin + flag gate, MIME/size guard (accept `.xlsx`/`.xls`, cap ~5 MB), parse, log row, enqueue job, `withAudit({ action: "program.imported" })`. Returns 202.
- **`app/api/admin/programs/import-excel/template/route.ts`** — `GET`: returns the generated template as a download (admin + flag gate).
- **`app/api/admin/programs/import-excel/cancel/route.ts`** — reuse/mirror the existing generate-cancel route (or extend it to accept this job type).
- **`components/admin/ExcelImportDialog.tsx`** — the wizard (client select + options → template download + upload → progress → result). Mirrors `AiGenerateDialog`. Mounted from `ProgramList.tsx` as a third button **"Import from Excel"**.
- **`components/admin/ImportReportCard.tsx`** (or extend `AiGenerationSummary`) — renders the import report on the program detail page.

### New — Firebase Functions side (twin copies; `functions/` can't import `lib/`)
- **`functions/src/ai/schemas.ts`** (extend) — `programImportSchema` (+ a matching `parsedSheetSchema` for input re-validation).
- **`functions/src/ai/prompts.ts`** (extend) — `PROGRAM_IMPORT_PROMPT`.
- **`functions/src/ai/resolve-exercise.ts`** — `resolveExerciseName(name, ctx)`: exact/normalized → semantic (`embedText` + `match_exercises` RPC, reuse from existing exercise-filter/embeddings) → `string-similarity-js` fuzzy → **create** (insert into `exercises`, source-tagged `ai_generation`/`excel_import`, fire-and-forget embed). Returns `{ exercise_id, method, confidence, created }`.
- **`functions/src/program-from-excel.ts`** — `handleProgramFromExcel(jobId)`: orchestrates interpret → resolve → build → persist → report → notify. Reuses `createProgram`, `buildExerciseRows`/`bulkAddExercisesToProgram`, progress/cancellation/notify helpers from `shared-helpers.ts` and the orchestrator's building blocks.
- **`functions/src/index.ts`** (extend) — new `export const programFromExcel = onDocumentCreated("ai_jobs/{jobId}", …)` with `if (data.type !== "program_from_excel") return`, dynamic-importing the handler.

### New — shared
- **`lib/ai-jobs.ts`** — add `"program_from_excel"` to the `AiJobType` union.
- **`lib/feature-flag-catalog.ts`** — add `feature_program_excel_import_enabled` (**default `true`** — the user explicitly asked for this feature; admin-only; creates only private programs; library additions are source-tagged, reported, and reversible. The flag exists so it can be disabled).

## 6. Data shapes

### `ParsedSheet` (parser output → job input)
```ts
type ParsedSheet = {
  sheets: { name: string; rows: string[][] }[]   // trimmed, bounded (e.g. ≤ 2000 rows, ≤ 40 cols/sheet total-capped)
}
```

### `ProgramImportPlan` (interpret agent output — `programImportSchema`)
```ts
{
  program: {
    name: string
    description?: string
    duration_weeks: number            // inferred from max week, or explicit; fallback 4
    sessions_per_week: number         // distinct days/week, or explicit
    split_type?: SplitType | null
    periodization?: Periodization | null
    difficulty: ProgramDifficulty     // fallback "intermediate"
    category: ProgramCategory[]       // fallback ["strength"]
    tier: ProgramTier                 // fallback "premium" (matches orchestrator default)
  }
  days: {
    week_number: number
    day_of_week: number               // 1–7
    day_label?: string
    exercises: {
      raw_name: string
      order_index: number
      sets?: number
      reps?: string
      rest_seconds?: number
      rpe_target?: number
      tempo?: string
      technique?: TrainingTechnique
      group_tag?: string
      notes?: string
    }[]
  }[]
  interpretation_notes?: string
  gaps_filled?: string[]              // human-readable list of what the AI inferred
  assumptions?: string[]
}
```

### Import report (stored in `ai_generation_params.import_report`, rendered on the program page)
```ts
{
  source: "excel_import"
  file_name: string
  client_id: string | null
  matched: { raw_name: string; exercise_id: string; exercise_name: string; method: "exact"|"semantic"|"fuzzy"; confidence: number }[]
  created: { raw_name: string; exercise_id: string }[]      // new library exercises — surfaced for review
  gaps_filled: string[]
  assumptions: string[]
  interpretation_notes?: string
  counts: { days: number; exercises: number; weeks: number }
}
```

## 7. Gap-filling & resolution rules (deterministic defaults)

**Program metadata fallbacks:** duration_weeks = max week seen (≥1) else 4; sessions_per_week = distinct `day_of_week` per week else derived; split_type/periodization = inferred or `null`; difficulty = `intermediate`; category = inferred or `["strength"]`; tier = `premium`; is_public = option (default `false`); price = free.

**Per-exercise field fallbacks** (match the builder's drag-in defaults): `sets: 3`, `reps: "8-12"`, `technique: "straight_set"`, `order_index` by sheet order; rest/rpe/tempo/notes = `null` when absent. When a client is attached, the interpret agent MAY tune sets/reps toward that client's level (recorded in `gaps_filled`).

**Exercise name resolution order:** (1) exact/normalized name equality against active library; (2) semantic top match via `match_exercises` above a confidence threshold; (3) `string-similarity-js` fuzzy above a threshold; (4) otherwise **create** a new active library exercise (name + any category/equipment hint from the sheet), source-tagged, auto-embedded — and list it under `created` in the report. **Nothing is dropped.**

**Blank weeks:** if `duration_weeks` exceeds the weeks actually detailed, the missing weeks are left with no rows; the existing client-side repeat-week behavior makes the program "complete." (Documented, intentional.)

## 8. Error handling
- Parse failure (corrupt/unsupported file) → 400 with a clear message; nothing enqueued.
- Empty/rows-only-headers sheet → 422 "no workout rows detected."
- Interpret agent failure → job `failed`, `ai_generation_log` failed, failure email; dialog shows the error.
- Exercise-create failure for one name → fall back to best fuzzy candidate (even if below threshold) and note it; never fail the whole job for one exercise.
- Persist ordering: resolve **all** exercise names and build the rows in memory first, **then** `createProgram` (needs the id for the FK), **then** `bulkAddExercisesToProgram`. If the bulk insert fails after its retries, set the just-created program `is_active = false` and mark the job `failed` with the report, so no half-empty program is left active.
- Cancellation honored between interpret / resolve / persist (reuse `createCancellationChecker`).

## 9. Testing
- **Unit — parser** (`lib/excel/parse-program-sheet.ts`): a fixture `.xlsx` (template-shaped) and a messy one → assert grid extraction, trimming, bounds.
- **Unit — template** (`generateProgramTemplate`): workbook has expected sheets/headers/dropdowns; round-trips through the parser.
- **Unit — validators** (`program-import.ts`): parsedSheet + options schemas accept/reject correctly.
- **Unit — resolveExerciseName** (functions): exact/semantic/fuzzy/create branches with a mocked supabase + embed.
- **Unit — programImportSchema** (functions): enum normalization + fallbacks.
- **Route test** (`import-excel/route.ts`): flag off → 404/403; non-xlsx → 400; happy path → 202 with a mocked `createAiJob`.
- **Handler test** (`handleProgramFromExcel`): mocked interpret + resolve → asserts `createProgram` + `bulkAddExercisesToProgram` called with the expected rows and report.

Verification bar honors the repo baseline (pre-existing reds noted in memory `test_baseline_not_green`): prod source stays tsc-clean (grep changed files), new tests green in isolation, don't attribute pre-existing failures to this diff.

## 10. Reuse map (what's borrowed vs. net-new)

| Reused as-is | Net-new |
|---|---|
| `createAiJob` + Firestore→Function trigger + RTDB progress + notify email | `program_from_excel` job type + `programFromExcel` function + handler |
| `AiGenerateDialog` UX patterns (dock, cancel, live listen) | `ExcelImportDialog` |
| `createProgram`, `buildExerciseRows`, `bulkAddExercisesToProgram` | interpret prompt + `programImportSchema` |
| `callAgent` (functions) structured output + retries + caching | `parseWorkbookToSheet` (exceljs) |
| `embedText` + `match_exercises` RPC + `string-similarity-js` | `resolveExerciseName` (match-or-create) |
| `exceljs` + `lib/excel-templates.ts` styling helpers | `generateProgramTemplate` |
| `AiGenerationSummary` / `ai_generation_params` card | `ImportReportCard` (or extension) |
| `withAudit`, `getSetting` flag gate, admin auth | `feature_program_excel_import_enabled` flag |

## 11. Rollout / activation checklist (for the user)
1. Review this spec and the diff.
2. `push` to `main` → Vercel (app) + GitHub Actions (functions) deploy.
3. Flag `feature_program_excel_import_enabled` defaults **true** → the "Import from Excel" button appears immediately. Flip off at `/admin/automation` to disable.
4. Click-through: download template → fill → upload → verify program + report → assign.
5. Audit action `program.imported` is added to the taxonomy (`lib/audit/actions.ts`).
