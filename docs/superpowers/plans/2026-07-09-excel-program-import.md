# Excel → AI Program Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a coach upload an Excel spreadsheet on `/admin/programs`; the AI reads it (full, partial, or messy), matches exercises to the library, fills gaps, and creates a complete review-ready program — with a downloadable template.

**Architecture:** Mirrors the existing AI Generate background-job pipeline. The Next.js route parses the `.xlsx` with `exceljs` (which is **not** in the Functions bundle) into a bounded JSON grid, writes an `ai_generation_log` row, and enqueues a Firestore `ai_jobs` doc of type `program_from_excel` (seeding RTDB for live progress). A new Firebase Function interprets the grid with `callAgent`, resolves exercise names to the library (match-or-create), builds `program_exercises` rows, and persists a private `is_ai_generated` program plus an import report. A wizard dialog live-listens to RTDB exactly like `AiGenerateDialog`.

**Tech Stack:** Next.js 16 App Router, TypeScript, `exceljs` 4.4, Zod 4, `@anthropic-ai/sdk` (via `functions/src/ai/anthropic.ts` `callAgent`), Firebase Firestore + RTDB + Functions, Supabase (service role), `@huggingface/transformers` embeddings + `match_exercises` pgvector RPC, `string-similarity-js`, Vitest.

## Global Constraints

- **No new dependencies.** `exceljs@^4.4.0`, `string-similarity-js@^2.1.4`, `@huggingface/transformers`, `zod@^4.3.6` are already present in the runtimes that need them. Do NOT add `xlsx`/SheetJS/`papaparse`.
- **`functions/` cannot import from `lib/`** (`rootDir: "src"`). Any helper needed in both runtimes is a twin copy. New Functions code imports only from `functions/src/**` with `.js` extensions.
- **Feature flags are DB-backed** (`system_settings` rows via `getSetting`), never env-driven. New flag: `feature_program_excel_import_enabled`, **default `true`**.
- **New AI job type** `program_from_excel` must be added to BOTH `lib/ai-jobs.ts` and `functions/src/ai/types.ts`.
- **Admin-only** routes: inline guard `const session = await auth(); if (!session?.user?.id || session.user.role !== "admin") return 403`. There is no `requireAdmin` helper.
- **`match_exercises` RPC only returns embedded + `is_active` exercises.** Resolve all names against the existing library before creating any new exercise; reference created exercises by their returned `id`, never re-match them.
- Brand: no hardcoded hex except inside `lib/excel-templates.ts` (ARGB fills already use `FF0E3F50` etc. there — follow that file's existing convention).
- The resulting program is **private** (`is_public` defaults false), **not auto-assigned**. Coach assigns via existing flow afterward.
- Commit after each task. Do NOT push (deploy is gated on the user).

---

## File Structure

**Next.js (app) side**
- `lib/ai-jobs.ts` *(modify)* — add `program_from_excel` to `AiJobType`.
- `lib/feature-flag-catalog.ts` *(modify)* — add the flag.
- `lib/audit/actions.ts` *(modify)* — add `program.imported`.
- `hooks/use-ai-jobs-dock.tsx` *(modify)* — add `"excel_import"` to `AiJobKind`.
- `lib/excel-templates.ts` *(modify)* — add `generateProgramTemplate()`.
- `lib/excel/parse-program-sheet.ts` *(create)* — `parseWorkbookToSheet(buffer)` + `ParsedSheet` type.
- `lib/validators/program-import.ts` *(create)* — `parsedSheetSchema`, `programImportOptionsSchema`.
- `app/api/admin/programs/import-excel/route.ts` *(create)* — POST upload+parse+enqueue.
- `app/api/admin/programs/import-excel/template/route.ts` *(create)* — GET template download.
- `components/admin/ExcelImportDialog.tsx` *(create)* — the wizard.
- `components/admin/ProgramList.tsx` *(modify)* — third button + dialog in both render sites.
- `components/admin/ImportReportCard.tsx` *(create)* — report card.
- `app/(admin)/admin/programs/[id]/page.tsx` *(modify)* — render report card when `source === "excel_import"`.

**Firebase Functions side**
- `functions/src/ai/types.ts` *(modify)* — add `program_from_excel` to `AiJobType`.
- `functions/src/ai/schemas.ts` *(modify)* — add `programImportSchema` (+ `parsedSheetSchema`).
- `functions/src/ai/prompts.ts` *(modify)* — add `PROGRAM_IMPORT_PROMPT`.
- `functions/src/ai/resolve-exercise.ts` *(create)* — `resolveExerciseNames(...)` match-or-create.
- `functions/src/program-from-excel.ts` *(create)* — `handleProgramFromExcel(jobId)`.
- `functions/src/index.ts` *(modify)* — new `programFromExcel` trigger.

**Cancellation reuses** the existing `app/api/admin/programs/generate/cancel/route.ts` (it is job-type-agnostic — only needs `jobId`).

---

### Task 1: Shared scaffolding — job type, dock kind, feature flag, audit action

**Files:**
- Modify: `lib/ai-jobs.ts` (union at lines 12-42)
- Modify: `functions/src/ai/types.ts` (`AiJobType` ~line 208)
- Modify: `hooks/use-ai-jobs-dock.tsx` (`AiJobKind` ~line 24)
- Modify: `lib/feature-flag-catalog.ts` (`FEATURE_FLAG_CATALOG`)
- Modify: `lib/audit/actions.ts` (add slug `program.imported`)
- Test: `__tests__/feature-flag-catalog.test.ts` (create)

**Interfaces:**
- Produces: `AiJobType` now includes `"program_from_excel"`; `AiJobKind` includes `"excel_import"`; flag key `"feature_program_excel_import_enabled"` (default `true`); audit action `"program.imported"`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/feature-flag-catalog.test.ts
import { describe, it, expect } from "vitest"
import { FEATURE_FLAG_CATALOG, isFeatureFlagKey } from "@/lib/feature-flag-catalog"

describe("program excel import feature flag", () => {
  it("is registered in the catalog and defaults enabled", () => {
    const flag = FEATURE_FLAG_CATALOG.find((f) => f.key === "feature_program_excel_import_enabled")
    expect(flag).toBeDefined()
    expect(flag?.defaultEnabled).toBe(true)
    expect(isFeatureFlagKey("feature_program_excel_import_enabled")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/feature-flag-catalog.test.ts`
Expected: FAIL (flag undefined).

- [ ] **Step 3: Implement the changes**

In `lib/feature-flag-catalog.ts`, add to `FEATURE_FLAG_CATALOG`:
```ts
  {
    key: "feature_program_excel_import_enabled",
    label: "Import program from Excel",
    description:
      "Adds an 'Import from Excel' button to /admin/programs. Coaches upload a spreadsheet (full, partial, or messy); the AI reads it, matches exercises to the library, fills gaps, and creates a private review-ready program. Includes a downloadable template.",
    defaultEnabled: true,
  },
```

In `lib/ai-jobs.ts`, add to the `AiJobType` union (after `"program_chat"`):
```ts
  | "program_from_excel"
```

In `functions/src/ai/types.ts`, add the same string to its `AiJobType` union.

In `hooks/use-ai-jobs-dock.tsx`, extend `AiJobKind`:
```ts
export type AiJobKind = "full_program" | "week" | "day" | "excel_import"
```

In `lib/audit/actions.ts`, add `"program.imported"` alongside `"program.created"` (same category grouping). Confirm the exact array/const it belongs to by reading the file; mirror the neighbor entry.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/feature-flag-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the touched prod source**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ai-jobs|feature-flag|use-ai-jobs-dock|audit/actions" || echo "clean"`
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add lib/ai-jobs.ts functions/src/ai/types.ts hooks/use-ai-jobs-dock.tsx lib/feature-flag-catalog.ts lib/audit/actions.ts __tests__/feature-flag-catalog.test.ts
git commit -m "feat(programs): scaffolding for Excel import (job type, flag, dock kind, audit action)"
```

---

### Task 2: Program Excel template generator

**Files:**
- Modify: `lib/excel-templates.ts` (add `generateProgramTemplate`)
- Test: `__tests__/excel-program-template.test.ts` (create)

**Interfaces:**
- Produces: `export async function generateProgramTemplate(): Promise<Buffer>` — returns an `.xlsx` buffer with sheets `Info`, `Workout`, `Instructions`. `Workout` headers (row 1, exact order): `Week`, `Day`, `Exercise`, `Sets`, `Reps`, `Rest (s)`, `RPE`, `Tempo`, `Technique`, `Group/Superset`, `Notes`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/excel-program-template.test.ts
import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { generateProgramTemplate } from "@/lib/excel-templates"

describe("generateProgramTemplate", () => {
  it("produces a workbook with Info, Workout, Instructions sheets and correct headers", async () => {
    const buf = await generateProgramTemplate()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as unknown as ArrayBuffer)

    expect(wb.getWorksheet("Info")).toBeTruthy()
    expect(wb.getWorksheet("Instructions")).toBeTruthy()
    const workout = wb.getWorksheet("Workout")
    expect(workout).toBeTruthy()

    const headers = (workout!.getRow(1).values as unknown[]).slice(1).map(String)
    expect(headers).toEqual([
      "Week", "Day", "Exercise", "Sets", "Reps", "Rest (s)", "RPE", "Tempo", "Technique", "Group/Superset", "Notes",
    ])
    // at least one example data row present
    expect(workout!.actualRowCount).toBeGreaterThan(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/excel-program-template.test.ts`
Expected: FAIL (`generateProgramTemplate` not exported).

- [ ] **Step 3: Implement `generateProgramTemplate`**

Add to `lib/excel-templates.ts`. Reuse the existing `HEADER_FILL`, `HEADER_FONT`, `HINT_FILL`, `HINT_FONT`, `BORDER` constants and the same `ExcelJS` build style as `generateExerciseTemplate`. Structure:
- `Info` sheet: two columns (`Field`, `Value`); rows for `Program Name`, `Description`, `Weeks`, `Sessions per week`, `Split` (dropdown: full_body/upper_lower/push_pull_legs/push_pull/body_part/movement_pattern/custom), `Periodization` (linear/undulating/block/reverse_linear/none), `Difficulty` (beginner/intermediate/advanced/elite), `Tier` (generalize/premium), `Public?` (TRUE/FALSE). A leading hint row explaining "Fill what you know — the AI fills the rest."
- `Workout` sheet: the 11 headers above (styled header row), a hint row (italic) under the header, and 2–3 pre-filled example rows (e.g. `1, Monday, Barbell Back Squat, 4, 6-8, 120, 8, 3-1-1-0, straight_set, , Warm up first`). Add dropdowns: `Day` column → Monday..Sunday; `Technique` column → the 11 technique values (`straight_set` etc. from `types/database.ts`).
- `Instructions` sheet: plain text rows explaining each column, that Week/Day repeat per session, that unknown fields can be blank, and that exercise names are matched to the library (close matches auto-linked; unmatched exercises are added to the library and flagged for review).
- Return `Buffer.from(await workbook.xlsx.writeBuffer())`.

Use dropdowns via `worksheet.dataValidations.add("B6", { type: "list", allowBlank: true, formulae: ['"a,b,c"'] })` exactly as `generateExerciseTemplate` does (read that function for the precise API usage before writing).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/excel-program-template.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/excel-templates.ts __tests__/excel-program-template.test.ts
git commit -m "feat(programs): downloadable Excel program template"
```

---

### Task 3: Workbook parser (`parseWorkbookToSheet`)

**Files:**
- Create: `lib/excel/parse-program-sheet.ts`
- Test: `__tests__/parse-program-sheet.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ParsedSheet { sheets: { name: string; rows: string[][] }[] }
export const PARSE_LIMITS = { maxRowsPerSheet: 1500, maxColsPerSheet: 30, maxCellChars: 500, maxSheets: 6 } as const
export async function parseWorkbookToSheet(buffer: Buffer): Promise<ParsedSheet>
```
- Behavior: load workbook; for each worksheet (up to `maxSheets`), read up to `maxRowsPerSheet` rows × `maxColsPerSheet` cols; each cell → trimmed string (`cellText` style: prefer `.text`, fall back to `String(value)`, empty for null/formula-error); truncate cells to `maxCellChars`; drop trailing fully-empty rows; drop sheets that are entirely empty. Throws `Error("Could not read the Excel file")` on `xlsx.load` failure.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/parse-program-sheet.test.ts
import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { parseWorkbookToSheet } from "@/lib/excel/parse-program-sheet"

async function makeBuffer(rows: (string | number)[][], sheetName = "Workout"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName)
  rows.forEach((r) => ws.addRow(r))
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe("parseWorkbookToSheet", () => {
  it("extracts a trimmed 2D string grid per sheet", async () => {
    const buf = await makeBuffer([
      ["Week", "Day", "Exercise", "Sets", "Reps"],
      [1, "Monday", "  Squat  ", 4, "6-8"],
    ])
    const parsed = await parseWorkbookToSheet(buf)
    const sheet = parsed.sheets.find((s) => s.name === "Workout")!
    expect(sheet.rows[0]).toEqual(["Week", "Day", "Exercise", "Sets", "Reps"])
    expect(sheet.rows[1]).toEqual(["1", "Monday", "Squat", "4", "6-8"])
  })

  it("drops fully-empty trailing rows and empty sheets", async () => {
    const buf = await makeBuffer([["A"], [""], [""]])
    const parsed = await parseWorkbookToSheet(buf)
    expect(parsed.sheets[0].rows.length).toBe(1)
  })

  it("throws a friendly error on a non-workbook buffer", async () => {
    await expect(parseWorkbookToSheet(Buffer.from("not a spreadsheet"))).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/parse-program-sheet.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/excel/parse-program-sheet.ts`**

```ts
import ExcelJS from "exceljs"

export interface ParsedSheet {
  sheets: { name: string; rows: string[][] }[]
}

export const PARSE_LIMITS = {
  maxRowsPerSheet: 1500,
  maxColsPerSheet: 30,
  maxCellChars: 500,
  maxSheets: 6,
} as const

function cellToText(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v === null || v === undefined) return ""
  if (typeof v === "object") {
    // rich text / hyperlink / formula result
    const anyV = v as { text?: string; result?: unknown; richText?: { text: string }[] }
    if (typeof anyV.text === "string") return anyV.text.trim()
    if (Array.isArray(anyV.richText)) return anyV.richText.map((r) => r.text).join("").trim()
    if (anyV.result !== undefined && anyV.result !== null) return String(anyV.result).trim()
    return ""
  }
  return String(v).trim()
}

export async function parseWorkbookToSheet(buffer: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  } catch {
    throw new Error("Could not read the Excel file. Please upload a valid .xlsx workbook.")
  }

  const sheets: ParsedSheet["sheets"] = []
  const worksheets = wb.worksheets.slice(0, PARSE_LIMITS.maxSheets)

  for (const ws of worksheets) {
    const rows: string[][] = []
    const rowCount = Math.min(ws.rowCount, PARSE_LIMITS.maxRowsPerSheet)
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r)
      const cells: string[] = []
      for (let c = 1; c <= PARSE_LIMITS.maxColsPerSheet; c++) {
        cells.push(cellToText(row.getCell(c)).slice(0, PARSE_LIMITS.maxCellChars))
      }
      // trim trailing empty cells
      while (cells.length && cells[cells.length - 1] === "") cells.pop()
      rows.push(cells)
    }
    // drop trailing empty rows
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop()
    if (rows.length === 0) continue
    sheets.push({ name: ws.name, rows })
  }

  if (sheets.length === 0) {
    throw new Error("The workbook has no readable rows.")
  }
  return { sheets }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/parse-program-sheet.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add lib/excel/parse-program-sheet.ts __tests__/parse-program-sheet.test.ts
git commit -m "feat(programs): exceljs workbook parser to bounded string grid"
```

---

### Task 4: Import validators

**Files:**
- Create: `lib/validators/program-import.ts`
- Test: `__tests__/program-import-validator.test.ts`

**Interfaces:**
- Produces:
```ts
export const parsedSheetSchema: z.ZodType<{ sheets: { name: string; rows: string[][] }[] }>
export const programImportOptionsSchema: z.ZodObject<...>
export type ProgramImportOptions = { client_id: string | null; is_public: boolean; name_override: string | null; notify_email: string | null }
```

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/program-import-validator.test.ts
import { describe, it, expect } from "vitest"
import { parsedSheetSchema, programImportOptionsSchema } from "@/lib/validators/program-import"

describe("program-import validators", () => {
  it("accepts a well-formed parsed sheet", () => {
    const ok = parsedSheetSchema.safeParse({ sheets: [{ name: "Workout", rows: [["a", "b"], ["1", "2"]] }] })
    expect(ok.success).toBe(true)
  })
  it("rejects a sheet with non-string cells", () => {
    const bad = parsedSheetSchema.safeParse({ sheets: [{ name: "x", rows: [[1, 2]] }] })
    expect(bad.success).toBe(false)
  })
  it("defaults options and coerces empty client_id to null", () => {
    const parsed = programImportOptionsSchema.parse({})
    expect(parsed.is_public).toBe(false)
    expect(parsed.client_id).toBeNull()
  })
  it("rejects a bad client_id uuid", () => {
    const bad = programImportOptionsSchema.safeParse({ client_id: "not-a-uuid" })
    expect(bad.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/program-import-validator.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/validators/program-import.ts`**

```ts
import { z } from "zod"

export const parsedSheetSchema = z.object({
  sheets: z
    .array(
      z.object({
        name: z.string(),
        rows: z.array(z.array(z.string())),
      }),
    )
    .min(1),
})

export type ParsedSheetInput = z.infer<typeof parsedSheetSchema>

export const programImportOptionsSchema = z.object({
  client_id: z
    .string()
    .uuid("Invalid client ID")
    .nullish()
    .transform((v) => v ?? null),
  is_public: z.coerce.boolean().default(false),
  name_override: z
    .string()
    .max(200)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  notify_email: z
    .string()
    .email()
    .nullish()
    .transform((v) => v ?? null),
})

export type ProgramImportOptions = z.infer<typeof programImportOptionsSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/program-import-validator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validators/program-import.ts __tests__/program-import-validator.test.ts
git commit -m "feat(programs): zod validators for excel import (parsed sheet + options)"
```

---

### Task 5: Import API route + template download route

**Files:**
- Create: `app/api/admin/programs/import-excel/route.ts`
- Create: `app/api/admin/programs/import-excel/template/route.ts`
- Test: `__tests__/import-excel-route.test.ts`

**Interfaces:**
- Consumes: `parseWorkbookToSheet` (Task 3), `parsedSheetSchema`/`programImportOptionsSchema` (Task 4), `generateProgramTemplate` (Task 2), `getSetting` (`lib/db/system-settings`), `createGenerationLog` (`lib/db/ai-generation-log`), `getAdminFirestore`/`getAdminRtdb` (`lib/firebase-admin`), `FieldValue`, `auth`, `withAudit`.
- Produces: `POST /api/admin/programs/import-excel` → `202 { jobId, log_id, status }`; `GET /api/admin/programs/import-excel/template` → xlsx download. Firestore job doc shape:
```ts
{ type: "program_from_excel", status: "pending",
  input: { parsedSheet, options, fileName, requestedBy, logId, notify_email },
  result: null, error: null, userId, createdAt, updatedAt }
```

- [ ] **Step 1: Write the failing test**

Read an existing route test in `__tests__/` first to copy the mocking style for `@/lib/auth`, `@/lib/firebase-admin`, and `@/lib/db/*`. Then:

```ts
// __tests__/import-excel-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn(async (_k: string, d: unknown) => d) }))
vi.mock("@/lib/db/ai-generation-log", () => ({ createGenerationLog: vi.fn(async () => ({ id: "log-1" })) }))
const jobSet = vi.fn(async () => {})
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ id: "job-1", set: jobSet }) }) }),
  getAdminRtdb: () => ({ ref: () => ({ set: vi.fn(async () => {}) }) }),
}))
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "ts" } }))

import { POST } from "@/app/api/admin/programs/import-excel/route"
import ExcelJS from "exceljs"

async function xlsxFile(): Promise<File> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Workout")
  ws.addRow(["Week", "Day", "Exercise", "Sets", "Reps"])
  ws.addRow([1, "Monday", "Squat", 4, "6-8"])
  const buf = await wb.xlsx.writeBuffer()
  return new File([buf], "program.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

function req(file: File | null, fields: Record<string, string> = {}): Request {
  const fd = new FormData()
  if (file) fd.set("file", file)
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return new Request("http://localhost/api/admin/programs/import-excel", { method: "POST", body: fd })
}

beforeEach(() => { authMock.mockReset(); jobSet.mockClear() })

describe("POST /api/admin/programs/import-excel", () => {
  it("403 when not admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req(await xlsxFile()))
    expect(res.status).toBe(403)
  })

  it("400 when file missing", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "admin" } })
    const res = await POST(req(null))
    expect(res.status).toBe(400)
  })

  it("202 and enqueues a job on the happy path", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    const res = await POST(req(await xlsxFile()))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.log_id).toBe("log-1")
    expect(jobSet).toHaveBeenCalledOnce()
    const jobDoc = jobSet.mock.calls[0][0]
    expect(jobDoc.type).toBe("program_from_excel")
    expect(jobDoc.input.parsedSheet.sheets[0].rows[1]).toEqual(["1", "Monday", "Squat", "4", "6-8"])
  })
})
```

Note: `withAudit` wraps the handler. If wrapping complicates unit-testing `POST` directly, export the inner handler as `POST` wrapped by `withAudit` but keep it callable — mirror how `app/api/admin/programs/route.ts` is structured and how its test (if any) handles it. If no existing route test mocks `withAudit`, add `vi.mock("@/lib/audit/with-audit", () => ({ withAudit: (_o: unknown, h: unknown) => h }))` to the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/import-excel-route.test.ts`
Expected: FAIL (route not found).

- [ ] **Step 3: Implement the POST route**

`app/api/admin/programs/import-excel/route.ts`. Mirror `app/api/admin/programs/generate/route.ts` for the log-row + Firestore-doc + RTDB-seed + 202 pattern, wrapped in `withAudit({ action: "program.imported", category: "admin_write", metadata: async (_req, res) => { const id = res.headers.get("x-audit-target-id"); return id ? { target_id: id } : {} } }, handler)`. The handler:
1. `auth()` admin guard → 403.
2. Flag gate: `const enabled = await getSetting<boolean>("feature_program_excel_import_enabled", true); if (!enabled) return NextResponse.json({ error: "Feature disabled" }, { status: 404 })`.
3. `const formData = await request.formData(); const file = formData.get("file") as File | null`.
   - `if (!file) return 400 "No file provided"`.
   - `const ALLOWED = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"]`; also accept when `file.name` ends `.xlsx`/`.xls` (some browsers send `application/octet-stream`). If neither MIME nor extension matches → 400.
   - `const MAX = 5 * 1024 * 1024; if (file.size > MAX) return 400 "File too large. Maximum 5 MB"`.
4. `const buffer = Buffer.from(await file.arrayBuffer())`. `let parsedSheet; try { parsedSheet = await parseWorkbookToSheet(buffer) } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }) }`.
5. Parse options from formData fields (`client_id`, `is_public`, `name_override`, `notify_email`) with `programImportOptionsSchema.safeParse({...})` → 400 on failure.
6. `const log = await createGenerationLog({ program_id: null, client_id: options.client_id, requested_by: session.user.id, status: "pending", input_params: { source: "excel_import", file_name: file.name, options }, output_summary: null, error_message: null, model_used: "sonnet", tokens_used: null, cache_creation_tokens: null, cache_read_tokens: null, duration_ms: null, completed_at: null, current_step: 0, total_steps: 4 })`.
7. Create Firestore doc (inline, like generate route) with the job shape above; seed RTDB `ai_jobs/${jobRef.id}` with `{ status: "pending", progress: { status: "queued", current_step: 0, total_steps: 4 }, result: null, error: null, updatedAt: Date.now() }`.
8. `const response = NextResponse.json({ jobId: jobRef.id, log_id: log.id, status: "pending" }, { status: 202 }); response.headers.set("x-audit-target-id", jobRef.id); return response`.

- [ ] **Step 4: Implement the template GET route**

`app/api/admin/programs/import-excel/template/route.ts`:
```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { generateProgramTemplate } from "@/lib/excel-templates"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  const buf = await generateProgramTemplate()
  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="program-template.xlsx"',
    },
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/import-excel-route.test.ts`
Expected: PASS (all three).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "import-excel" || echo "clean"`
Expected: `clean`.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/programs/import-excel __tests__/import-excel-route.test.ts
git commit -m "feat(programs): import-excel upload route + template download"
```

---

### Task 6: Functions — interpret schema + prompt

**Files:**
- Modify: `functions/src/ai/schemas.ts` (add `programImportSchema`, `parsedSheetSchema`)
- Modify: `functions/src/ai/prompts.ts` (add `PROGRAM_IMPORT_PROMPT`)
- Test: `functions/src/ai/__tests__/program-import-schema.test.ts` (create; check the functions test dir convention first — look for existing `functions/src/**/*.test.ts`)

**Interfaces:**
- Produces:
```ts
export const programImportSchema  // zod, shape = ProgramImportPlan below
export const parsedSheetSchema
export type ProgramImportPlan = z.infer<typeof programImportSchema>
export const PROGRAM_IMPORT_PROMPT: string
```
`ProgramImportPlan`:
```ts
{
  program: {
    name: string; description?: string | null
    duration_weeks: number; sessions_per_week: number
    split_type?: SplitType | null; periodization?: Periodization | null
    difficulty: "beginner"|"intermediate"|"advanced"|"elite"
    category: string[]; tier: "generalize"|"premium"
  }
  days: Array<{
    week_number: number; day_of_week: number; day_label?: string | null
    exercises: Array<{
      raw_name: string; order_index: number
      sets?: number | null; reps?: string | null; rest_seconds?: number | null
      rpe_target?: number | null; tempo?: string | null
      technique?: Technique | null; group_tag?: string | null; notes?: string | null
    }>
  }>
  interpretation_notes?: string | null
  gaps_filled?: string[]
  assumptions?: string[]
}
```

- [ ] **Step 1: Write the failing test**

```ts
// functions/src/ai/__tests__/program-import-schema.test.ts
import { describe, it, expect } from "vitest"
import { programImportSchema } from "../schemas.js"

describe("programImportSchema", () => {
  it("parses a complete plan", () => {
    const plan = {
      program: {
        name: "Test Block", duration_weeks: 4, sessions_per_week: 3,
        difficulty: "intermediate", category: ["strength"], tier: "premium",
      },
      days: [
        { week_number: 1, day_of_week: 1, exercises: [
          { raw_name: "Back Squat", order_index: 0, sets: 4, reps: "6-8", technique: "straight_set" },
        ] },
      ],
      gaps_filled: ["assumed 4 weeks from the sheet"],
    }
    const parsed = programImportSchema.parse(plan)
    expect(parsed.program.name).toBe("Test Block")
    expect(parsed.days[0].exercises[0].raw_name).toBe("Back Squat")
  })

  it("normalizes upper-cased enum values", () => {
    const plan = {
      program: { name: "x", duration_weeks: 1, sessions_per_week: 1, difficulty: "Intermediate", category: ["Strength"], tier: "Premium" },
      days: [{ week_number: 1, day_of_week: 1, exercises: [{ raw_name: "Ex", order_index: 0, technique: "Straight_Set" }] }],
    }
    // callAgent runs normalizeEnumFields before parse; emulate the lower-casing the model layer applies:
    plan.program.difficulty = plan.program.difficulty.toLowerCase()
    plan.program.tier = plan.program.tier.toLowerCase()
    plan.days[0].exercises[0].technique = plan.days[0].exercises[0].technique.toLowerCase()
    plan.program.category = plan.program.category.map((c) => c.toLowerCase())
    expect(programImportSchema.safeParse(plan).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root): `cd functions && npx vitest run src/ai/__tests__/program-import-schema.test.ts`
Expected: FAIL (export missing). (Return to root after: `cd ..`.)

- [ ] **Step 3: Implement the schemas**

In `functions/src/ai/schemas.ts`, reuse the existing top-level `as const` enum tuples (`SPLIT_TYPES`, `PERIODIZATION_TYPES`, `TECHNIQUES`). Add:
```ts
const PROGRAM_DIFFICULTIES = ["beginner", "intermediate", "advanced", "elite"] as const
const PROGRAM_TIERS = ["generalize", "premium"] as const

export const parsedSheetSchema = z.object({
  sheets: z.array(z.object({ name: z.string(), rows: z.array(z.array(z.string())) })).min(1),
})

const importExerciseSchema = z.object({
  raw_name: z.string().min(1),
  order_index: z.number().int().min(0),
  sets: z.number().int().min(1).max(20).nullish(),
  reps: z.string().max(40).nullish(),
  rest_seconds: z.number().int().min(0).max(1200).nullish(),
  rpe_target: z.number().min(1).max(10).nullish(),
  tempo: z.string().max(20).nullish(),
  technique: z.enum(TECHNIQUES).nullish(),
  group_tag: z.string().max(40).nullish(),
  notes: z.string().max(1000).nullish(),
})

const importDaySchema = z.object({
  week_number: z.number().int().min(1).max(52),
  day_of_week: z.number().int().min(1).max(7),
  day_label: z.string().max(60).nullish(),
  exercises: z.array(importExerciseSchema),
})

export const programImportSchema = z.object({
  program: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullish(),
    duration_weeks: z.number().int().min(1).max(52),
    sessions_per_week: z.number().int().min(1).max(7),
    split_type: z.enum(SPLIT_TYPES).nullish(),
    periodization: z.enum(PERIODIZATION_TYPES).nullish(),
    difficulty: z.enum(PROGRAM_DIFFICULTIES).default("intermediate"),
    category: z.array(z.string()).min(1).default(["strength"]),
    tier: z.enum(PROGRAM_TIERS).default("premium"),
  }),
  days: z.array(importDaySchema).min(1),
  interpretation_notes: z.string().max(4000).nullish(),
  gaps_filled: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
})

export type ProgramImportPlan = z.infer<typeof programImportSchema>
```

- [ ] **Step 4: Implement the prompt**

In `functions/src/ai/prompts.ts`, add `PROGRAM_IMPORT_PROMPT`. It must instruct the model to:
- Read the provided spreadsheet grid (rendered as text; may be one or many sheets; an `Info` sheet may hold program-level fields; a workout sheet holds exercise rows; headers vary or may be missing).
- Produce EXACTLY the `programImportSchema` JSON via the structured_output tool.
- Faithfully transcribe what's present: exercise names verbatim into `raw_name` (do NOT invent library IDs), sets/reps/rest/rpe/tempo/technique/group/notes when present.
- Infer `week_number`/`day_of_week` from the sheet layout (repeated week/day columns, day headers like "Monday"/"Day 1", or section blocks). Map day names/numbers to 1–7 (Mon=1..Sun=7).
- Fill gaps conservatively and record each inference in `gaps_filled`/`assumptions`: derive `duration_weeks` from the max week seen (default 4 if none), `sessions_per_week` from distinct days per week, and leave prescription fields null when truly unknown (the code layer applies defaults) — but you MAY suggest sets/reps when the context clearly implies them.
- If a client profile block is included, tune ambiguous prescriptions to that client's level and note it in `gaps_filled`.
- Never drop an exercise. Keep original ordering via `order_index` within each day.
- Include the literal JSON shape in the prompt (copy the field list from `programImportSchema`), matching the style of `EXERCISE_SELECTOR_PROMPT`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd functions && npx vitest run src/ai/__tests__/program-import-schema.test.ts; cd ..`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/schemas.ts functions/src/ai/prompts.ts functions/src/ai/__tests__/program-import-schema.test.ts
git commit -m "feat(programs): functions interpret schema + prompt for excel import"
```

---

### Task 7: Functions — exercise name resolver (match-or-create)

**Files:**
- Create: `functions/src/ai/resolve-exercise.ts`
- Test: `functions/src/ai/__tests__/resolve-exercise.test.ts`

**Interfaces:**
- Consumes: `getSupabase` (`../lib/supabase.js`), `embedText`/`embedExercise` (`./embeddings.js`), `stringSimilarity` (`string-similarity-js`).
- Produces:
```ts
export interface ResolvedExercise {
  raw_name: string; exercise_id: string; exercise_name: string
  method: "exact" | "semantic" | "fuzzy" | "created"; confidence: number; created: boolean
}
export async function resolveExerciseNames(
  rawNames: string[],
  deps?: Partial<ResolveDeps>,   // injectable for tests: { listLibrary, matchByEmbedding, insertExercise, embed }
): Promise<Map<string, ResolvedExercise>>
```
Behavior (per unique normalized name, in order): (1) exact/normalized name equality against the active library list; (2) semantic top match via `match_exercises` RPC with `match_threshold: 0.5`, take top if `similarity >= 0.62`; (3) fuzzy `stringSimilarity(name, libName) >= 0.72`; (4) else create a new active library row `{ name: rawName, category: ["strength"] }`, fire-and-forget embed, mark `created`. Cache by normalized name so a repeated name resolves/creates once. Thresholds are module constants.

- [ ] **Step 1: Write the failing test**

```ts
// functions/src/ai/__tests__/resolve-exercise.test.ts
import { describe, it, expect, vi } from "vitest"
import { resolveExerciseNames } from "../resolve-exercise.js"

const LIB = [
  { id: "ex-squat", name: "Barbell Back Squat" },
  { id: "ex-bench", name: "Barbell Bench Press" },
]

function deps(overrides = {}) {
  return {
    listLibrary: vi.fn(async () => LIB),
    matchByEmbedding: vi.fn(async () => [] as { id: string; similarity: number }[]),
    insertExercise: vi.fn(async (name: string) => ({ id: `new-${name}`, name })),
    embed: vi.fn(async () => {}),
    ...overrides,
  }
}

describe("resolveExerciseNames", () => {
  it("matches exact/normalized names", async () => {
    const map = await resolveExerciseNames(["barbell back squat"], deps())
    expect(map.get("barbell back squat")!.exercise_id).toBe("ex-squat")
    expect(map.get("barbell back squat")!.method).toBe("exact")
  })

  it("uses semantic match above threshold", async () => {
    const d = deps({ matchByEmbedding: vi.fn(async () => [{ id: "ex-bench", similarity: 0.8 }]) })
    const map = await resolveExerciseNames(["flat barbell press"], d)
    expect(map.get("flat barbell press")!.exercise_id).toBe("ex-bench")
    expect(map.get("flat barbell press")!.method).toBe("semantic")
  })

  it("creates a new exercise when nothing matches, once per unique name", async () => {
    const d = deps()
    const map = await resolveExerciseNames(["Sled Push", "sled push"], d)
    expect(d.insertExercise).toHaveBeenCalledTimes(1)
    expect(map.get("sled push")!.created).toBe(true)
    expect(map.get("sled push")!.method).toBe("created")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/ai/__tests__/resolve-exercise.test.ts; cd ..`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `functions/src/ai/resolve-exercise.ts`**

```ts
import { getSupabase } from "../lib/supabase.js"
import { embedText, embedExercise } from "./embeddings.js"
import { stringSimilarity } from "string-similarity-js"

const SEMANTIC_MIN = 0.62
const FUZZY_MIN = 0.72

export interface ResolvedExercise {
  raw_name: string
  exercise_id: string
  exercise_name: string
  method: "exact" | "semantic" | "fuzzy" | "created"
  confidence: number
  created: boolean
}

export interface ResolveDeps {
  listLibrary: () => Promise<{ id: string; name: string }[]>
  matchByEmbedding: (name: string) => Promise<{ id: string; similarity: number }[]>
  insertExercise: (name: string) => Promise<{ id: string; name: string }>
  embed: (id: string, name: string) => Promise<void>
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
}

function defaultDeps(): ResolveDeps {
  return {
    listLibrary: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase.from("exercises").select("id, name").eq("is_active", true)
      if (error) throw new Error(`listLibrary failed: ${error.message}`)
      return (data ?? []) as { id: string; name: string }[]
    },
    matchByEmbedding: async (name: string) => {
      const supabase = getSupabase()
      const emb = await embedText(name)
      const { data } = await supabase.rpc("match_exercises", {
        query_embedding: JSON.stringify(emb),
        match_threshold: 0.5,
        match_count: 5,
      })
      return (data ?? []) as { id: string; similarity: number }[]
    },
    insertExercise: async (name: string) => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("exercises")
        .insert({ name, category: ["strength"], description: "Imported from Excel — review metadata." })
        .select("id, name")
        .single()
      if (error) throw new Error(`insertExercise failed: ${error.message}`)
      return data as { id: string; name: string }
    },
    embed: async (id: string, name: string) => {
      const supabase = getSupabase()
      const vec = await embedExercise({
        name,
        category: ["strength"],
        difficulty: "intermediate",
        movement_pattern: null,
        primary_muscles: [],
        secondary_muscles: [],
        equipment_required: [],
        is_bodyweight: false,
        training_intent: ["build"],
      } as never)
      await supabase.from("exercises").update({ embedding: JSON.stringify(vec) }).eq("id", id)
    },
  }
}

export async function resolveExerciseNames(
  rawNames: string[],
  overrides: Partial<ResolveDeps> = {},
): Promise<Map<string, ResolvedExercise>> {
  const deps = { ...defaultDeps(), ...overrides }
  const library = await deps.listLibrary()
  const byNorm = new Map(library.map((e) => [normalize(e.name), e]))
  const result = new Map<string, ResolvedExercise>()

  for (const raw of rawNames) {
    const key = normalize(raw)
    if (result.has(key)) continue

    // 1. exact/normalized
    const exact = byNorm.get(key)
    if (exact) {
      result.set(key, { raw_name: raw, exercise_id: exact.id, exercise_name: exact.name, method: "exact", confidence: 1, created: false })
      continue
    }

    // 2. semantic
    let matched = false
    try {
      const cands = await deps.matchByEmbedding(raw)
      if (cands.length && cands[0].similarity >= SEMANTIC_MIN) {
        const hit = library.find((e) => e.id === cands[0].id)
        if (hit) {
          result.set(key, { raw_name: raw, exercise_id: hit.id, exercise_name: hit.name, method: "semantic", confidence: cands[0].similarity, created: false })
          matched = true
        }
      }
    } catch (e) {
      console.warn(`[resolve] semantic match failed for "${raw}":`, e)
    }
    if (matched) continue

    // 3. fuzzy
    let best = { id: "", name: "", score: 0 }
    for (const e of library) {
      const score = stringSimilarity(key, normalize(e.name))
      if (score > best.score) best = { id: e.id, name: e.name, score }
    }
    if (best.score >= FUZZY_MIN) {
      result.set(key, { raw_name: raw, exercise_id: best.id, exercise_name: best.name, method: "fuzzy", confidence: best.score, created: false })
      continue
    }

    // 4. create
    try {
      const created = await deps.insertExercise(raw)
      deps.embed(created.id, created.name).catch((err) => console.warn(`[resolve] embed failed for "${raw}":`, err))
      result.set(key, { raw_name: raw, exercise_id: created.id, exercise_name: created.name, method: "created", confidence: 0, created: true })
      // add to in-memory library so a near-duplicate later in the same run can fuzzy-match it
      library.push(created)
      byNorm.set(normalize(created.name), created)
    } catch (e) {
      // last resort: best fuzzy candidate even below threshold, else skip
      if (best.id) {
        result.set(key, { raw_name: raw, exercise_id: best.id, exercise_name: best.name, method: "fuzzy", confidence: best.score, created: false })
      } else {
        console.error(`[resolve] could not resolve or create "${raw}":`, e)
      }
    }
  }

  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/ai/__tests__/resolve-exercise.test.ts; cd ..`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/resolve-exercise.ts functions/src/ai/__tests__/resolve-exercise.test.ts
git commit -m "feat(programs): exercise name resolver (exact/semantic/fuzzy/create)"
```

---

### Task 8: Functions — job handler + trigger wiring

**Files:**
- Create: `functions/src/program-from-excel.ts`
- Modify: `functions/src/index.ts` (add `programFromExcel` trigger)
- Test: `functions/src/__tests__/program-from-excel.test.ts` (create)

**Interfaces:**
- Consumes: `programImportSchema`/`PROGRAM_IMPORT_PROMPT` (Task 6), `resolveExerciseNames` (Task 7), `callAgent`/`MODEL_SONNET` (`./ai/anthropic.js`), `getSupabase`, `bulkAddExercisesToProgram` (`./ai/shared-helpers.js`), `getClientProfile` (`./ai/shared-helpers.js`), `createJobProgressUpdater`/`createCancellationChecker` (`./ai/shared-helpers.js`), `notifyJobCompleted`/`notifyJobFailed` (`./lib/notify-job-done.js`).
- Produces: `export async function handleProgramFromExcel(jobId: string): Promise<void>`; the pure core `export async function buildProgramFromPlan(plan, resolved, options): { programRow, exerciseRows, report }` for testability.

- [ ] **Step 1: Write the failing test**

```ts
// functions/src/__tests__/program-from-excel.test.ts
import { describe, it, expect } from "vitest"
import { buildProgramFromPlan } from "../program-from-excel.js"

const plan = {
  program: { name: "Imported Block", duration_weeks: 2, sessions_per_week: 2, difficulty: "intermediate", category: ["strength"], tier: "premium", split_type: null, periodization: null },
  days: [
    { week_number: 1, day_of_week: 1, exercises: [
      { raw_name: "Back Squat", order_index: 0, sets: 4, reps: "6-8" },
      { raw_name: "Mystery Lift", order_index: 1 },
    ] },
  ],
  gaps_filled: ["assumed 2 weeks"], assumptions: [],
}

const resolved = new Map([
  ["back squat", { raw_name: "Back Squat", exercise_id: "ex-squat", exercise_name: "Barbell Back Squat", method: "semantic" as const, confidence: 0.8, created: false }],
  ["mystery lift", { raw_name: "Mystery Lift", exercise_id: "new-1", exercise_name: "Mystery Lift", method: "created" as const, confidence: 0, created: true }],
])

describe("buildProgramFromPlan", () => {
  it("builds program row, exercise rows with defaults, and a report", () => {
    const { programRow, exerciseRows, report } = buildProgramFromPlan(plan as never, resolved, {
      client_id: null, is_public: false, name_override: null, notify_email: null, requestedBy: "admin-1", fileName: "p.xlsx",
    })
    expect(programRow.name).toBe("Imported Block")
    expect(programRow.is_ai_generated).toBe(true)
    expect(programRow.is_public).toBe(false)
    expect((programRow.ai_generation_params as { source: string }).source).toBe("excel_import")

    expect(exerciseRows).toHaveLength(2)
    // resolved id + defaults for the missing-prescription exercise
    const mystery = exerciseRows.find((r) => r.exercise_id === "new-1")!
    expect(mystery.sets).toBe(3)
    expect(mystery.reps).toBe("8-12")
    expect(mystery.technique).toBe("straight_set")
    expect(mystery.week_number).toBe(1)
    expect(mystery.day_of_week).toBe(1)

    expect(report.created).toHaveLength(1)
    expect(report.matched).toHaveLength(1)
    expect(report.counts.exercises).toBe(2)
  })

  it("uses name_override when provided", () => {
    const { programRow } = buildProgramFromPlan(plan as never, resolved, {
      client_id: null, is_public: false, name_override: "Custom Name", notify_email: null, requestedBy: "a", fileName: "p.xlsx",
    })
    expect(programRow.name).toBe("Custom Name")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/__tests__/program-from-excel.test.ts; cd ..`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `functions/src/program-from-excel.ts`**

Write the module with a **pure** `buildProgramFromPlan` and an orchestrating `handleProgramFromExcel`. Pure core:
```ts
import type { ProgramImportPlan } from "./ai/schemas.js"
import type { ResolvedExercise } from "./ai/resolve-exercise.js"

export interface BuildOptions {
  client_id: string | null; is_public: boolean; name_override: string | null
  notify_email: string | null; requestedBy: string; fileName: string
}
export interface ImportReport {
  source: "excel_import"; file_name: string; client_id: string | null
  matched: { raw_name: string; exercise_id: string; exercise_name: string; method: string; confidence: number }[]
  created: { raw_name: string; exercise_id: string }[]
  gaps_filled: string[]; assumptions: string[]; interpretation_notes?: string | null
  counts: { days: number; exercises: number; weeks: number }
}

const VALID_TECHNIQUES = new Set(["straight_set","superset","dropset","giant_set","circuit","rest_pause","amrap","cluster_set","complex","emom","wave_loading"])
function norm(s: string): string { return s.toLowerCase().replace(/\s+/g, " ").trim() }

export function buildProgramFromPlan(
  plan: ProgramImportPlan,
  resolved: Map<string, ResolvedExercise>,
  options: BuildOptions,
): { programRow: Record<string, unknown>; exerciseRows: Record<string, unknown>[]; report: ImportReport } {
  const exerciseRows: Record<string, unknown>[] = []
  const matched: ImportReport["matched"] = []
  const created: ImportReport["created"] = []
  const seenResolved = new Set<string>()
  const weeks = new Set<number>()

  for (const day of plan.days) {
    weeks.add(day.week_number)
    for (const ex of day.exercises) {
      const r = resolved.get(norm(ex.raw_name))
      if (!r) continue // unresolvable + uncreatable — dropped (logged upstream)
      exerciseRows.push({
        exercise_id: r.exercise_id,
        day_of_week: day.day_of_week,
        week_number: day.week_number,
        order_index: ex.order_index,
        sets: ex.sets ?? 3,
        reps: ex.reps ?? "8-12",
        duration_seconds: null,
        rest_seconds: ex.rest_seconds ?? null,
        notes: ex.notes ?? null,
        rpe_target: ex.rpe_target ?? null,
        intensity_pct: null,
        tempo: ex.tempo ?? null,
        group_tag: ex.group_tag ?? null,
        technique: ex.technique && VALID_TECHNIQUES.has(ex.technique) ? ex.technique : "straight_set",
      })
      if (!seenResolved.has(r.exercise_id)) {
        seenResolved.add(r.exercise_id)
        if (r.created) created.push({ raw_name: r.raw_name, exercise_id: r.exercise_id })
        else matched.push({ raw_name: r.raw_name, exercise_id: r.exercise_id, exercise_name: r.exercise_name, method: r.method, confidence: r.confidence })
      }
    }
  }

  const report: ImportReport = {
    source: "excel_import", file_name: options.fileName, client_id: options.client_id,
    matched, created,
    gaps_filled: plan.gaps_filled ?? [], assumptions: plan.assumptions ?? [],
    interpretation_notes: plan.interpretation_notes ?? null,
    counts: { days: plan.days.length, exercises: exerciseRows.length, weeks: weeks.size },
  }

  const programRow: Record<string, unknown> = {
    name: options.name_override ?? plan.program.name,
    description: plan.program.description ?? null,
    category: plan.program.category?.length ? plan.program.category : ["strength"],
    difficulty: plan.program.difficulty ?? "intermediate",
    tier: plan.program.tier ?? "premium",
    duration_weeks: plan.program.duration_weeks,
    sessions_per_week: plan.program.sessions_per_week,
    split_type: plan.program.split_type ?? null,
    periodization: plan.program.periodization ?? null,
    is_public: options.is_public,
    is_ai_generated: true,
    ai_generation_params: { ...report, token_usage: null },
    is_active: true,
    created_by: options.requestedBy,
    price_cents: null,
  }

  return { programRow, exerciseRows, report }
}
```
Then `handleProgramFromExcel(jobId)` — mirror `handleProgramGeneration` structure exactly (Firestore doc read, `status !== "pending"` guard, cancellation re-read, mark processing in Firestore + RTDB via a local `updateRtdb`, try/catch with notify). Inside the try:
1. `const updateProgress = createJobProgressUpdater(jobId, 4)`; `const checkCancelled = createCancellationChecker(jobId)`.
2. `await updateProgress("parsing", 1)` (already parsed upstream — this just reflects the step); read `input = { parsedSheet, options, fileName, requestedBy, logId, notify_email }`.
3. Render the parsed grid to text: for each sheet, `"## " + name + "\n" + rows.map(r => r.join(" | ")).join("\n")`. If `options.client_id`, `const profile = await getClientProfile(options.client_id)` and append a compact `Client profile:` block.
4. `await updateProgress("interpreting", 2)`; `if (await checkCancelled()) return`; `const { content: plan, tokens_used } = await callAgent(PROGRAM_IMPORT_PROMPT, renderedText, programImportSchema, { model: MODEL_SONNET, cacheSystemPrompt: true })`.
5. `await updateProgress("matching", 3)`; `if (await checkCancelled()) return`; gather unique `raw_name`s across `plan.days`; `const resolved = await resolveExerciseNames(rawNames)`.
6. `const { programRow, exerciseRows, report } = buildProgramFromPlan(plan, resolved, { ...options, requestedBy: input.requestedBy, fileName: input.fileName })`; set `(programRow.ai_generation_params as any).token_usage = { total: tokens_used }`.
7. `await updateProgress("building", 4)`; insert program: `const supabase = getSupabase(); const { data: program, error } = await supabase.from("programs").insert(programRow).select().single(); if (error) throw ...`. Then `const rows = exerciseRows.map(r => ({ ...r, program_id: program.id }))`; `try { await bulkAddExercisesToProgram(rows) } catch (e) { await supabase.from("programs").update({ is_active: false }).eq("id", program.id); throw e }`.
8. Update `ai_generation_log` (if `input.logId`) to completed with `program_id`, `output_summary: report`, `tokens_used`. (Use a direct supabase update — mirror how the orchestrator finalizes the log, or `supabase.from("ai_generation_log").update({...}).eq("id", input.logId)`.)
9. `resultPayload = { program_id: program.id, report }`; write completed to Firestore + RTDB; `notifyJobCompleted({ notify_email: input.notify_email, programId: program.id, jobLabel: "Excel import", summary: \`Imported ${report.counts.exercises} exercises across ${report.counts.weeks} week(s).\`, details: [{ label: "Matched", value: String(report.matched.length) }, { label: "New exercises", value: String(report.created.length) }] })`.
Catch → failed in Firestore + RTDB + `notifyJobFailed`.

- [ ] **Step 4: Wire the trigger in `functions/src/index.ts`**

After the `programChat` export, add (mirror `programGeneration`):
```ts
export const programFromExcel = onDocumentCreated(
  {
    document: "ai_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "us-central1",
    secrets: allSecrets,
  },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.type !== "program_from_excel") return
    const { handleProgramFromExcel } = await import("./program-from-excel.js")
    await handleProgramFromExcel(event.params.jobId)
  },
)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd functions && npx vitest run src/__tests__/program-from-excel.test.ts; cd ..`
Expected: PASS (both).

- [ ] **Step 6: Typecheck the functions project**

Run: `cd functions && npx tsc --noEmit; cd ..`
Expected: no errors in `program-from-excel.ts`, `resolve-exercise.ts`, `schemas.ts`, `prompts.ts`, `index.ts` (pre-existing errors elsewhere, if any, are out of scope — grep the filenames).

- [ ] **Step 7: Commit**

```bash
git add functions/src/program-from-excel.ts functions/src/index.ts functions/src/__tests__/program-from-excel.test.ts
git commit -m "feat(programs): excel import job handler + firebase trigger"
```

---

### Task 9: Import wizard dialog + wire into ProgramList

**Files:**
- Create: `components/admin/ExcelImportDialog.tsx`
- Modify: `components/admin/ProgramList.tsx` (both render sites: empty-state block ~lines 158-175 and main toolbar ~lines 182-202, plus their dialog mounts)
- Test: `__tests__/excel-import-dialog.test.tsx` (create; light render test)

**Interfaces:**
- Consumes: import route (`POST /api/admin/programs/import-excel`), template route (`GET /api/admin/programs/import-excel/template`), cancel route (`POST /api/admin/programs/generate/cancel`), `useAiJobsDock`, `rtdb` + `ref/onValue/off` from `firebase/database`, `clients` prop (same clients array `ProgramList` already holds for `AiGenerateDialog`).
- Produces: `export function ExcelImportDialog({ open, onOpenChange, clients }: { open: boolean; onOpenChange: (v: boolean) => void; clients: {...}[] })`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/excel-import-dialog.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
vi.mock("@/lib/firebase", () => ({ rtdb: {} }))
vi.mock("firebase/database", () => ({ ref: vi.fn(), onValue: vi.fn(), off: vi.fn() }))
vi.mock("@/hooks/use-ai-jobs-dock", () => ({ useAiJobsDock: () => ({ addJob: vi.fn(), markResolved: vi.fn() }) }))
import { ExcelImportDialog } from "@/components/admin/ExcelImportDialog"

describe("ExcelImportDialog", () => {
  it("renders the upload step with a template download link", () => {
    render(<ExcelImportDialog open={true} onOpenChange={() => {}} clients={[]} />)
    expect(screen.getByText(/import from excel/i)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /template/i })).toHaveAttribute(
      "href", "/api/admin/programs/import-excel/template",
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/excel-import-dialog.test.tsx`
Expected: FAIL (component not found).

- [ ] **Step 3: Implement `ExcelImportDialog.tsx`**

Model it closely on `components/admin/AiGenerateDialog.tsx` but simpler:
- Uses shadcn `Dialog`, `Button`, `Select` (client picker: "No client (generic program)" + `clients`), a checkbox for `is_public`, an optional name override input, an optional notify email input, and a **template download link**: `<a href="/api/admin/programs/import-excel/template" ...>Download the template</a>`.
- File input `<input type="file" accept=".xlsx,.xls" />`.
- On submit: build `FormData` (`file`, `client_id`, `is_public`, `name_override`, `notify_email`), `fetch("/api/admin/programs/import-excel", { method: "POST", body: fd })`. On `202`, store `jobId`, `addJob({ jobId, kind: "excel_import", label: "Excel import" })`, start the RTDB `onValue` listener with the SAME `mapProgressToStep` approach but with these steps: `[{ key: "parsing" }, { key: "interpreting" }, { key: "matching" }, { key: "building" }]`. On `completed`, read `result.report`, show a success card (matched/created/gaps counts) + **View Program** (`/admin/programs/${result.program_id}`) and **Assign to Clients** (reuse `AssignProgramDialog` like AiGenerateDialog does). On `failed`, show the error. Cancel calls `/api/admin/programs/generate/cancel` with `{ jobId }`.
- Reuse `off`/cleanup pattern from AiGenerateDialog (`stopListening`).

Keep the component focused; if it grows past ~300 lines, that's acceptable parity with AiGenerateDialog, but prefer extracting the steps array + `mapProgressToStep` to small local helpers.

- [ ] **Step 4: Wire into `ProgramList.tsx`**

- Add `const [importDialogOpen, setImportDialogOpen] = useState(false)`.
- Import `ExcelImportDialog`.
- In BOTH button groups (empty-state ~158-175 and main toolbar ~182-202) add, next to "AI Generate":
```tsx
<Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)}>
  <FileSpreadsheet className="size-4" />
  <span className="hidden sm:inline">Import Excel</span>
  <span className="sm:hidden">Excel</span>
</Button>
```
(Import `FileSpreadsheet` from `lucide-react`.)
- In BOTH dialog-mount groups add: `<ExcelImportDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} clients={clients} />` (use the same `clients` variable already passed to `AiGenerateDialog`).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run -- __tests__/excel-import-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ExcelImportDialog|ProgramList" || echo "clean"`
Expected: `clean`.

- [ ] **Step 7: Commit**

```bash
git add components/admin/ExcelImportDialog.tsx components/admin/ProgramList.tsx __tests__/excel-import-dialog.test.tsx
git commit -m "feat(programs): Excel import wizard dialog + toolbar button"
```

---

### Task 10: Import report card on the program detail page

**Files:**
- Create: `components/admin/ImportReportCard.tsx`
- Modify: `app/(admin)/admin/programs/[id]/page.tsx` (render when `ai_generation_params.source === "excel_import"`)
- Test: `__tests__/import-report-card.test.tsx`

**Interfaces:**
- Produces: `export function ImportReportCard({ params }: { params: Record<string, unknown> })` — renders nothing unless `params.source === "excel_import"`. Shows counts (weeks/days/exercises), matched count, a highlighted "New exercises added to your library — review these" list (from `params.created`), and collapsible `gaps_filled` / `assumptions` / `interpretation_notes`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/import-report-card.test.tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ImportReportCard } from "@/components/admin/ImportReportCard"

const params = {
  source: "excel_import", file_name: "block.xlsx", client_id: null,
  matched: [{ raw_name: "Squat", exercise_id: "e1", exercise_name: "Back Squat", method: "semantic", confidence: 0.8 }],
  created: [{ raw_name: "Sled Push", exercise_id: "e2" }],
  gaps_filled: ["assumed 4 weeks"], assumptions: [], interpretation_notes: null,
  counts: { days: 3, exercises: 12, weeks: 4 },
}

describe("ImportReportCard", () => {
  it("renders import counts and the created-exercises callout", () => {
    render(<ImportReportCard params={params} />)
    expect(screen.getByText(/imported from excel/i)).toBeInTheDocument()
    expect(screen.getByText(/Sled Push/)).toBeInTheDocument()
    expect(screen.getByText(/12/)).toBeInTheDocument()
  })
  it("renders nothing for non-import params", () => {
    const { container } = render(<ImportReportCard params={{ validation: {} }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/import-report-card.test.tsx`
Expected: FAIL (component not found).

- [ ] **Step 3: Implement `ImportReportCard.tsx`**

A server-safe presentational component (no hooks) styled like `AiGenerationSummary` (white rounded card, `FileSpreadsheet` header "Imported from Excel"). Guard `if (params.source !== "excel_import") return null`. Cast `params.counts`, `params.matched`, `params.created`, `params.gaps_filled`, `params.assumptions`, `params.interpretation_notes` defensively (all optional). Render a badge row (weeks/days/exercises/matched), a callout box listing `created` (raw_name → exercise_name) with copy "Added to your library — review their category/equipment," and a `<details>` for gaps/assumptions/notes.

- [ ] **Step 4: Render it in the program detail page**

In `app/(admin)/admin/programs/[id]/page.tsx`, import `ImportReportCard` and add right after the existing `AiGenerationSummary` block:
```tsx
{program.ai_generation_params && (
  <ImportReportCard params={program.ai_generation_params as Record<string, unknown>} />
)}
```
(The card self-guards on `source`, so this is safe for all programs.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run -- __tests__/import-report-card.test.tsx`
Expected: PASS (both).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ImportReportCard|programs/\[id\]/page" || echo "clean"`
Expected: `clean`.

- [ ] **Step 7: Commit**

```bash
git add components/admin/ImportReportCard.tsx "app/(admin)/admin/programs/[id]/page.tsx" __tests__/import-report-card.test.tsx
git commit -m "feat(programs): import report card on program detail page"
```

---

### Task 11: Whole-feature verification

**Files:** none (verification only).

- [ ] **Step 1: Run all new tests together**

Run:
```bash
npm run test:run -- __tests__/feature-flag-catalog.test.ts __tests__/excel-program-template.test.ts __tests__/parse-program-sheet.test.ts __tests__/program-import-validator.test.ts __tests__/import-excel-route.test.ts __tests__/excel-import-dialog.test.tsx __tests__/import-report-card.test.tsx
cd functions && npx vitest run src/ai/__tests__/program-import-schema.test.ts src/ai/__tests__/resolve-exercise.test.ts src/__tests__/program-from-excel.test.ts; cd ..
```
Expected: all PASS.

- [ ] **Step 2: Typecheck both projects, scoped to changed files**

Run:
```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "import-excel|parse-program-sheet|program-import|ExcelImportDialog|ImportReportCard|excel-templates|feature-flag|ai-jobs|use-ai-jobs-dock" || echo "app clean"
cd functions && npx tsc --noEmit 2>&1 | grep -E "program-from-excel|resolve-exercise|schemas|prompts|index" || echo "functions clean"; cd ..
```
Expected: `app clean` and `functions clean`.

- [ ] **Step 3: Confirm the baseline was not regressed**

Run the pre-existing-red baseline check per memory `test_baseline_not_green`: stash the working tree is NOT needed since work is committed — instead confirm no NEW failures by running the broader suite once and comparing against the known ~8-9 pre-existing reds. Document any delta.

- [ ] **Step 4: Update this plan's checkboxes and the design spec status; commit**

```bash
git add docs/superpowers/plans/2026-07-09-excel-program-import.md
git commit -m "docs(programs): mark excel import plan complete"
```

---

## Self-Review (completed by author)

**Spec coverage:** Upload+parse (T3, T5) ✓; messy/partial interpretation (T6 prompt+schema) ✓; client-specific vs generic (T5 options, T8 profile context) ✓; template (T2) ✓; exercise match-or-create (T7) ✓; gap-filling defaults (T8 `buildProgramFromPlan`) ✓; import report (T8 report + T10 card) ✓; background job + progress + notify (T5 enqueue, T8 handler, T9 dialog) ✓; feature flag (T1) ✓; audit (T1 action + T5 `withAudit`) ✓; no-auto-assign / private (T8 programRow) ✓; blank-week repeat (no code — relies on existing `sourceWeekForDisplay`, documented) ✓.

**Placeholder scan:** No TBD/TODO; every code step has concrete code or an exact mirror-this-file reference with the target snippet in the plan header material.

**Type consistency:** `ParsedSheet` shape identical in T3, T4, T5, T6. `ResolvedExercise` produced in T7, consumed in T8. `ProgramImportPlan` produced in T6, consumed in T8. `import_report`/`ImportReport` shape produced in T8, consumed in T10. `AiJobKind` extended in T1, used in T9. Flag key string identical in T1 and T5. Job type string identical across T1 (both unions), T5 (route), T8 (trigger guard).

**Known cross-runtime caveat:** `functions/` cannot import `lib/` — all functions files import only from `functions/src/**`. Confirmed for every functions task.
