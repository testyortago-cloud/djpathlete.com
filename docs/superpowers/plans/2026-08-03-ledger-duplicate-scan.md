# Ledger Duplicate Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Find duplicates" toolbar button on `/admin/books` that heuristically pairs same-amount ledger entries, has Claude Sonnet judge which pairs are real duplicates, and opens a review dialog with per-pair Delete / Not-a-duplicate actions.

**Architecture:** Pure candidate-pair module (zero IO, mirrors `statement-dedupe.ts`) → admin API route that recomputes candidates server-side, filters dismissed fingerprints BEFORE the AI call, and degrades honestly on AI failure → review dialog wired into BooksClient reusing the existing audited entry-delete and dismissal routes. No migration, no `functions/` changes, no feature flag.

**Tech Stack:** Next.js 16 App Router route handler, Zod, `callAgent` (`lib/ai/anthropic.ts`, jsonTool mode), shadcn Dialog, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-03-ledger-duplicate-scan-design.md` — read it first.

## Global Constraints

- Windows PowerShell environment; test runner is Vitest: `npx vitest run <path>`.
- The scan itself never mutates. Deletes go ONLY through existing `DELETE /api/admin/bookkeeping/entries/[id]`; dismissals ONLY through existing `POST /api/admin/bookkeeping/insights/dismissals`.
- Model-omitted verdict ⇒ pair kept with `verdict: null` (never dropped, never guessed).
- AI failure ⇒ `ai: "unavailable"` + all candidate pairs, never a 500 for the AI leg.
- `ai_generation_log` insert must NOT include a `generation_trigger` key (column doesn't exist in this project; PGRST204 kills the whole insert). Feature marker goes in `input_params.feature`.
- Ledger reads must defeat the PostgREST ~1000-row cap: use `fetchAllRows` from `@/lib/db/paginate`.
- No hardcoded hex colors; semantic Tailwind classes only. Amber banner uses `--warning` conventions (`text-warning` etc. — check globals.css usage before inventing classes; existing dialogs use `text-muted-foreground`, `text-error` patterns).
- Commit after each task; commit messages `feat(bookkeeping): …` / `test(bookkeeping): …`. NEVER `cd` out of the project root. Do NOT push.
- Do NOT stage `JOURNAL.md`, `Untitled`, CSVs, or any other untracked junk — stage only the files each task names.

---

### Task 1: Fingerprint extension + pure duplicate-scan module

**Files:**
- Modify: `lib/bookkeeping/finding-fingerprint.ts`
- Create: `lib/bookkeeping/duplicate-scan.ts`
- Test: `__tests__/lib/bookkeeping/duplicate-scan.test.ts`

**Interfaces:**
- Consumes: `normalizeDescription(desc: string): string` from `@/lib/bookkeeping/statement-parse`; `findingFingerprint` from `./finding-fingerprint`.
- Produces (later tasks rely on these EXACT names):
  - `FinderKind` union gains `"duplicate"`.
  - `duplicatePairFingerprint(idA: string, idB: string): string` in `finding-fingerprint.ts` → `"duplicate:<sortedA>|<sortedB>"`.
  - In `duplicate-scan.ts`: `DuplicateScanEntry`, `MemoSimilarity`, `CandidatePair`, `pairId(idA, idB): string`, `findCandidatePairs(entries, dismissedFingerprints, opts?): { pairs: CandidatePair[]; truncated: boolean }`.

- [ ] **Step 1: Write the failing tests**

`__tests__/lib/bookkeeping/duplicate-scan.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { duplicatePairFingerprint } from "@/lib/bookkeeping/finding-fingerprint"
import {
  findCandidatePairs,
  pairId,
  type DuplicateScanEntry,
} from "@/lib/bookkeeping/duplicate-scan"

// Distinct amounts/dates per case so a mutated window or amount check FAILS
// loudly (tests_that_cannot_fail).
let seq = 0
function entry(over: Partial<DuplicateScanEntry>): DuplicateScanEntry {
  seq += 1
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    occurred_on: "2026-07-01",
    amount_cents: 5000,
    direction: "expense",
    memo: null,
    counterparty: null,
    source: "manual",
    account_id: null,
    ...over,
  }
}
const NONE = new Set<string>()

describe("duplicatePairFingerprint", () => {
  it("is order-independent and prefixed with the finder", () => {
    const f1 = duplicatePairFingerprint("bbb", "aaa")
    const f2 = duplicatePairFingerprint("aaa", "bbb")
    expect(f1).toBe(f2)
    expect(f1).toBe("duplicate:aaa|bbb")
  })
})

describe("findCandidatePairs", () => {
  it("pairs same direction + exact amount within 7 days", () => {
    const a = entry({ occurred_on: "2026-07-01", amount_cents: 4321 })
    const b = entry({ occurred_on: "2026-07-08", amount_cents: 4321 })
    const { pairs, truncated } = findCandidatePairs([a, b], NONE)
    expect(pairs).toHaveLength(1)
    expect(truncated).toBe(false)
    expect(pairs[0].pair_id).toBe(pairId(a.id, b.id))
    expect(pairs[0].day_gap).toBe(7)
  })

  it("rejects a pair 8 days apart", () => {
    const a = entry({ occurred_on: "2026-07-01", amount_cents: 4321 })
    const b = entry({ occurred_on: "2026-07-09", amount_cents: 4321 })
    expect(findCandidatePairs([a, b], NONE).pairs).toHaveLength(0)
  })

  it("rejects cross-direction and cross-amount pairs", () => {
    const a = entry({ amount_cents: 4321, direction: "expense" })
    const b = entry({ amount_cents: 4321, direction: "income" })
    const c = entry({ amount_cents: 4322, direction: "expense" })
    expect(findCandidatePairs([a, b, c], NONE).pairs).toHaveLength(0)
  })

  it("pairs income too (double-counted income matters)", () => {
    const a = entry({ direction: "income", amount_cents: 9999 })
    const b = entry({ direction: "income", amount_cents: 9999, occurred_on: "2026-07-03" })
    expect(findCandidatePairs([a, b], NONE).pairs).toHaveLength(1)
  })

  it("allows overlapping pairs (A-B and A-C)", () => {
    const a = entry({ occurred_on: "2026-07-02", amount_cents: 777 })
    const b = entry({ occurred_on: "2026-07-03", amount_cents: 777 })
    const c = entry({ occurred_on: "2026-07-04", amount_cents: 777 })
    const { pairs } = findCandidatePairs([a, b, c], NONE)
    expect(pairs).toHaveLength(3) // A-B, A-C, B-C
  })

  it("filters pairs whose fingerprint is dismissed BEFORE returning", () => {
    const a = entry({ amount_cents: 606 })
    const b = entry({ amount_cents: 606, occurred_on: "2026-07-02" })
    const dismissed = new Set([duplicatePairFingerprint(a.id, b.id)])
    expect(findCandidatePairs([a, b], dismissed).pairs).toHaveLength(0)
  })

  it("orders deterministically and caps at maxPairs with truncated=true", () => {
    // 10 same-amount entries on one day = 45 raw pairs
    const entries = Array.from({ length: 10 }, () => entry({ amount_cents: 123 }))
    const { pairs, truncated } = findCandidatePairs(entries, NONE, { maxPairs: 40 })
    expect(pairs).toHaveLength(40)
    expect(truncated).toBe(true)
    const again = findCandidatePairs(entries, NONE, { maxPairs: 40 })
    expect(again.pairs.map((p) => p.pair_id)).toEqual(pairs.map((p) => p.pair_id))
  })

  it("annotates memo similarity from counterparty+memo text", () => {
    const exactA = entry({ amount_cents: 1111, counterparty: "Rogue Fitness", memo: "bands" })
    const exactB = entry({ amount_cents: 1111, counterparty: "Rogue Fitness", memo: "bands", occurred_on: "2026-07-02" })
    expect(findCandidatePairs([exactA, exactB], NONE).pairs[0].memo_similarity).toBe("exact")

    const subA = entry({ amount_cents: 2222, memo: "ROGUE FITNESS ORDER 4417" })
    const subB = entry({ amount_cents: 2222, memo: "rogue fitness", occurred_on: "2026-07-02" })
    expect(findCandidatePairs([subA, subB], NONE).pairs[0].memo_similarity).toBe("similar")

    const difA = entry({ amount_cents: 3333, memo: "starbucks coffee" })
    const difB = entry({ amount_cents: 3333, memo: "shell gasoline fuel", occurred_on: "2026-07-02" })
    expect(findCandidatePairs([difA, difB], NONE).pairs[0].memo_similarity).toBe("different")

    const misA = entry({ amount_cents: 4444 })
    const misB = entry({ amount_cents: 4444, occurred_on: "2026-07-02" })
    expect(findCandidatePairs([misA, misB], NONE).pairs[0].memo_similarity).toBe("missing")
  })

  it("flags same_source pairs (double import) and cross-source pairs alike", () => {
    const a = entry({ amount_cents: 8181, source: "statement_import" })
    const b = entry({ amount_cents: 8181, source: "statement_import", occurred_on: "2026-07-02" })
    const c = entry({ amount_cents: 8181, source: "receipt", occurred_on: "2026-07-03" })
    const { pairs } = findCandidatePairs([a, b, c], NONE)
    expect(pairs).toHaveLength(3)
    const ab = pairs.find((p) => p.pair_id === pairId(a.id, b.id))
    const ac = pairs.find((p) => p.pair_id === pairId(a.id, c.id))
    expect(ab?.same_source).toBe(true)
    expect(ac?.same_source).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run __tests__/lib/bookkeeping/duplicate-scan.test.ts`
Expected: FAIL — module `lib/bookkeeping/duplicate-scan.ts` does not exist; `duplicatePairFingerprint` not exported.

- [ ] **Step 3: Implement**

`lib/bookkeeping/finding-fingerprint.ts` — add `"duplicate"` to the `FinderKind` union, extend the keys-per-finder head comment with `duplicate → sorted entry uuid pair`, and append:

```ts
/** Pair fingerprint for the ledger duplicate scan — order-independent, identity only. */
export function duplicatePairFingerprint(idA: string, idB: string): string {
  return findingFingerprint("duplicate", [idA, idB].sort().join("|"))
}
```

`lib/bookkeeping/duplicate-scan.ts` (new, pure, zero IO):

```ts
// Pure candidate-pair generator for the post-hoc ledger duplicate scan
// (design: docs/superpowers/specs/2026-08-03-ledger-duplicate-scan-design.md).
// Pairs entries with the same direction + exact amount within a 7-day window;
// the AI route judges, this module only pairs. Dismissed fingerprints are
// filtered HERE so dismissals gate both display and AI spend. Zero IO.
import type { LedgerDirection, LedgerSource } from "@/types/database"
import { duplicatePairFingerprint } from "./finding-fingerprint"
import { normalizeDescription } from "./statement-parse"

export interface DuplicateScanEntry {
  id: string
  occurred_on: string
  amount_cents: number
  direction: LedgerDirection
  memo: string | null
  counterparty: string | null
  source: LedgerSource
  account_id: string | null
}

export type MemoSimilarity = "exact" | "similar" | "different" | "missing"

export interface CandidatePair {
  pair_id: string
  fingerprint: string
  a: DuplicateScanEntry
  b: DuplicateScanEntry
  day_gap: number
  same_source: boolean
  memo_similarity: MemoSimilarity
}

const DEFAULT_WINDOW_DAYS = 7
const DEFAULT_MAX_PAIRS = 40

/** `YYYY-MM-DD` → whole UTC days since epoch (statement-dedupe precedent — never local Date math). */
function toUtcDays(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** Stable pair id for AI round-tripping — sorted uuid join, same key as the fingerprint. */
export function pairId(idA: string, idB: string): string {
  return [idA, idB].sort().join("|")
}

function descriptor(e: DuplicateScanEntry): string {
  return [e.counterparty, e.memo].filter(Boolean).join(" ")
}

function memoSimilarity(a: DuplicateScanEntry, b: DuplicateScanEntry): MemoSimilarity {
  const na = normalizeDescription(descriptor(a))
  const nb = normalizeDescription(descriptor(b))
  if (!na || !nb) return "missing"
  if (na === nb) return "exact"
  if (na.includes(nb) || nb.includes(na)) return "similar"
  const aTokens = new Set(na.split(/\s+/).filter(Boolean))
  const bTokens = new Set(nb.split(/\s+/).filter(Boolean))
  const union = new Set([...aTokens, ...bTokens])
  if (union.size === 0) return "missing"
  let hit = 0
  for (const t of aTokens) if (bTokens.has(t)) hit++
  return hit / union.size >= 0.5 ? "similar" : "different"
}

/**
 * Same direction + exact amount + gap <= windowDays. Overlapping pairs allowed
 * (A can appear in A-B and A-C — deleting A clears both in the UI). Output is
 * deterministic: entries sorted (occurred_on, id), pairs sorted by earliest
 * member, capped at maxPairs with `truncated` set.
 */
export function findCandidatePairs(
  entries: DuplicateScanEntry[],
  dismissedFingerprints: ReadonlySet<string>,
  opts?: { windowDays?: number; maxPairs?: number },
): { pairs: CandidatePair[]; truncated: boolean } {
  const windowDays = opts?.windowDays ?? DEFAULT_WINDOW_DAYS
  const maxPairs = opts?.maxPairs ?? DEFAULT_MAX_PAIRS

  const sorted = [...entries].sort(
    (x, y) => x.occurred_on.localeCompare(y.occurred_on) || x.id.localeCompare(y.id),
  )
  const groups = new Map<string, DuplicateScanEntry[]>()
  for (const e of sorted) {
    const key = `${e.direction}:${e.amount_cents}`
    const g = groups.get(key)
    if (g) g.push(e)
    else groups.set(key, [e])
  }

  const all: CandidatePair[] = []
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const gap = toUtcDays(group[j].occurred_on) - toUtcDays(group[i].occurred_on)
        if (gap > windowDays) break // group is date-sorted — later j only grows the gap
        const fingerprint = duplicatePairFingerprint(group[i].id, group[j].id)
        if (dismissedFingerprints.has(fingerprint)) continue
        all.push({
          pair_id: pairId(group[i].id, group[j].id),
          fingerprint,
          a: group[i],
          b: group[j],
          day_gap: gap,
          same_source: group[i].source === group[j].source,
          memo_similarity: memoSimilarity(group[i], group[j]),
        })
      }
    }
  }

  all.sort(
    (p, q) =>
      p.a.occurred_on.localeCompare(q.a.occurred_on) ||
      p.a.id.localeCompare(q.a.id) ||
      p.b.id.localeCompare(q.b.id),
  )
  const truncated = all.length > maxPairs
  return { pairs: truncated ? all.slice(0, maxPairs) : all, truncated }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run __tests__/lib/bookkeeping/duplicate-scan.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```powershell
git add lib/bookkeeping/finding-fingerprint.ts lib/bookkeeping/duplicate-scan.ts __tests__/lib/bookkeeping/duplicate-scan.test.ts
git commit -m "feat(bookkeeping): pure duplicate-scan pair generator + duplicate fingerprint"
```

---

### Task 2: DAL reader + AI scan route

**Files:**
- Modify: `lib/db/bookkeeping.ts` (append near `listPostedForDedupe`, ~line 359)
- Create: `app/api/admin/bookkeeping/duplicates/scan/route.ts`
- Test: `__tests__/api/admin/bookkeeping/duplicates-scan.test.ts`

**Interfaces:**
- Consumes: `findCandidatePairs`, `CandidatePair`, `DuplicateScanEntry` from Task 1; `callAgent`/`MODEL_SONNET` from `@/lib/ai/anthropic`; `withTimeout` from `@/lib/with-timeout`; `listDismissedFingerprints` (exists) from `@/lib/db/bookkeeping`; `createGenerationLog`/`updateGenerationLog` from `@/lib/db/ai-generation-log`; `fetchAllRows` from `@/lib/db/paginate`.
- Produces:
  - DAL: `listEntriesForDuplicateScan(bookId: string): Promise<DuplicateScanEntry[]>`.
  - Route `POST /api/admin/bookkeeping/duplicates/scan`, body `{ book_id: uuid }`, response
    `{ pairs: ScanResponsePair[], ai: "ok" | "skipped" | "unavailable", truncated: boolean }` where
    `ScanResponsePair = CandidatePair & { verdict: { is_duplicate: boolean; confidence: "low" | "medium" | "high"; reason: string } | null }`.
    Task 3's dialog consumes exactly this shape.

- [ ] **Step 1: Write the failing tests**

`__tests__/api/admin/bookkeeping/duplicates-scan.test.ts` (mock style copied from `insights-narrative.test.ts` — real `findCandidatePairs`, mocked IO):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const listEntriesForDuplicateScanMock = vi.fn()
const listDismissedFingerprintsMock = vi.fn()
const createGenerationLogMock = vi.fn()
const updateGenerationLogMock = vi.fn()
const callAgentMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listEntriesForDuplicateScan: (...a: unknown[]) => listEntriesForDuplicateScanMock(...a),
  listDismissedFingerprints: (...a: unknown[]) => listDismissedFingerprintsMock(...a),
}))
vi.mock("@/lib/db/ai-generation-log", () => ({
  createGenerationLog: (...a: unknown[]) => createGenerationLogMock(...a),
  updateGenerationLog: (...a: unknown[]) => updateGenerationLogMock(...a),
}))
vi.mock("@/lib/ai/anthropic", () => ({
  callAgent: (...a: unknown[]) => callAgentMock(...a),
  MODEL_SONNET: "sonnet",
}))

import { POST } from "@/app/api/admin/bookkeeping/duplicates/scan/route"
import { pairId } from "@/lib/bookkeeping/duplicate-scan"

const BOOK_ID = "b0000000-0000-4000-8000-000000000001"
const ID_A = "e0000000-0000-4000-8000-000000000001"
const ID_B = "e0000000-0000-4000-8000-000000000002"
const ID_C = "e0000000-0000-4000-8000-000000000003"
const ID_D = "e0000000-0000-4000-8000-000000000004"

function scanEntry(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    occurred_on: "2026-07-01",
    amount_cents: 5000,
    direction: "expense",
    memo: "rogue fitness",
    counterparty: null,
    source: "statement_import",
    account_id: null,
    ...over,
  }
}

function req(body: unknown) {
  return new Request("http://test/api/admin/bookkeeping/duplicates/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  listDismissedFingerprintsMock.mockResolvedValue([])
  createGenerationLogMock.mockResolvedValue({ id: "log-1" })
  updateGenerationLogMock.mockResolvedValue({})
})

describe("POST /api/admin/bookkeeping/duplicates/scan", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req({ book_id: BOOK_ID }))
    expect(res.status).toBe(403)
  })

  it("400s a bad body", async () => {
    const res = await POST(req({ book_id: "not-a-uuid" }))
    expect(res.status).toBe(400)
  })

  it("short-circuits with ai:'skipped' and NO AI call when there are no candidates", async () => {
    listEntriesForDuplicateScanMock.mockResolvedValue([
      scanEntry(ID_A, { amount_cents: 100 }),
      scanEntry(ID_B, { amount_cents: 200 }),
    ])
    const res = await POST(req({ book_id: BOOK_ID }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ pairs: [], ai: "skipped", truncated: false })
    expect(callAgentMock).not.toHaveBeenCalled()
    expect(createGenerationLogMock).not.toHaveBeenCalled()
  })

  it("keeps AI-confirmed pairs, drops cleared pairs, keeps model-omitted pairs with verdict null", async () => {
    // Three candidate pairs from two amount-groups: (A,B) confirmed, (C,D) cleared,
    // (A2,B2)… use a third group omitted by the model.
    const ID_E = "e0000000-0000-4000-8000-000000000005"
    const ID_F = "e0000000-0000-4000-8000-000000000006"
    listEntriesForDuplicateScanMock.mockResolvedValue([
      scanEntry(ID_A),
      scanEntry(ID_B, { occurred_on: "2026-07-02", source: "receipt" }),
      scanEntry(ID_C, { amount_cents: 7000 }),
      scanEntry(ID_D, { amount_cents: 7000, occurred_on: "2026-07-03" }),
      scanEntry(ID_E, { amount_cents: 9000 }),
      scanEntry(ID_F, { amount_cents: 9000, occurred_on: "2026-07-04" }),
    ])
    callAgentMock.mockResolvedValue({
      content: {
        verdicts: [
          { pair_id: pairId(ID_A, ID_B), is_duplicate: true, confidence: "high", reason: "same memo, day apart, receipt vs statement" },
          { pair_id: pairId(ID_C, ID_D), is_duplicate: false, confidence: "medium", reason: "recurring subscription" },
          { pair_id: "unknown|pair", is_duplicate: true, confidence: "low", reason: "ignore me" },
        ],
      },
      tokens_used: 100,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    })
    const res = await POST(req({ book_id: BOOK_ID }))
    const body = await res.json()
    expect(body.ai).toBe("ok")
    expect(body.pairs).toHaveLength(2)
    const confirmed = body.pairs.find((p: { pair_id: string }) => p.pair_id === pairId(ID_A, ID_B))
    const omitted = body.pairs.find((p: { pair_id: string }) => p.pair_id === pairId(ID_E, ID_F))
    expect(confirmed.verdict).toEqual({ is_duplicate: true, confidence: "high", reason: "same memo, day apart, receipt vs statement" })
    expect(omitted.verdict).toBeNull()
    expect(updateGenerationLogMock).toHaveBeenCalledWith("log-1", expect.objectContaining({ status: "completed" }))
  })

  it("passes dismissed fingerprints into candidate generation (dismissed pair never reaches the AI)", async () => {
    const { duplicatePairFingerprint } = await import("@/lib/bookkeeping/finding-fingerprint")
    listEntriesForDuplicateScanMock.mockResolvedValue([
      scanEntry(ID_A),
      scanEntry(ID_B, { occurred_on: "2026-07-02" }),
    ])
    listDismissedFingerprintsMock.mockResolvedValue([duplicatePairFingerprint(ID_A, ID_B)])
    const res = await POST(req({ book_id: BOOK_ID }))
    const body = await res.json()
    expect(body).toEqual({ pairs: [], ai: "skipped", truncated: false })
    expect(callAgentMock).not.toHaveBeenCalled()
  })

  it("returns ai:'unavailable' with ALL candidate pairs (verdict null) when the AI leg throws", async () => {
    listEntriesForDuplicateScanMock.mockResolvedValue([
      scanEntry(ID_A),
      scanEntry(ID_B, { occurred_on: "2026-07-02" }),
    ])
    callAgentMock.mockRejectedValue(new Error("model down"))
    const res = await POST(req({ book_id: BOOK_ID }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ai).toBe("unavailable")
    expect(body.pairs).toHaveLength(1)
    expect(body.pairs[0].verdict).toBeNull()
    expect(updateGenerationLogMock).toHaveBeenCalledWith("log-1", expect.objectContaining({ status: "failed" }))
  })

  it("never sends a generation_trigger key to ai_generation_log", async () => {
    listEntriesForDuplicateScanMock.mockResolvedValue([
      scanEntry(ID_A),
      scanEntry(ID_B, { occurred_on: "2026-07-02" }),
    ])
    callAgentMock.mockResolvedValue({ content: { verdicts: [] }, tokens_used: 1, cache_creation_tokens: 0, cache_read_tokens: 0 })
    await POST(req({ book_id: BOOK_ID }))
    expect(createGenerationLogMock).toHaveBeenCalledTimes(1)
    const arg = createGenerationLogMock.mock.calls[0][0] as Record<string, unknown>
    expect("generation_trigger" in arg).toBe(false)
    expect((arg.input_params as Record<string, unknown>).feature).toBe("bookkeeping_duplicate_scan")
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run __tests__/api/admin/bookkeeping/duplicates-scan.test.ts`
Expected: FAIL — route module and `listEntriesForDuplicateScan` don't exist.

- [ ] **Step 3: Implement DAL + route**

`lib/db/bookkeeping.ts` — append after `listPostedForDedupe` (keep the file's `as never` fetchAllRows cast idiom):

```ts
/** Whole-book slim read for the post-hoc duplicate scan (fetchAllRows: 1000-row cap). */
export async function listEntriesForDuplicateScan(bookId: string): Promise<DuplicateScanEntry[]> {
  return fetchAllRows<DuplicateScanEntry>((f, t) =>
    db().from("bookkeeping_ledger_entries")
      .select("id,occurred_on,amount_cents,direction,memo,counterparty,source,account_id")
      .eq("book_id", bookId)
      .order("occurred_on", { ascending: true }).order("id", { ascending: true })
      .range(f, t) as never)
}
```

with `import type { DuplicateScanEntry } from "@/lib/bookkeeping/duplicate-scan"` added to the imports.

`app/api/admin/bookkeeping/duplicates/scan/route.ts`:

```ts
// Post-hoc AI duplicate scan (design: 2026-08-03-ledger-duplicate-scan-design.md).
// Read-only compute: candidates recomputed server-side, dismissals filtered BEFORE
// the AI call (they gate display AND spend), zero candidates = zero spend. The AI
// leg never 500s — timeout/failure degrades to heuristic-only pairs the dialog
// badges honestly. Deletes/dismissals happen through the existing audited routes,
// never here. Admin self-gated (/api/* is NOT in the middleware matcher).
import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { MODEL_SONNET, callAgent } from "@/lib/ai/anthropic"
import { findCandidatePairs, type CandidatePair } from "@/lib/bookkeeping/duplicate-scan"
import { createGenerationLog, updateGenerationLog } from "@/lib/db/ai-generation-log"
import { listDismissedFingerprints, listEntriesForDuplicateScan } from "@/lib/db/bookkeeping"
import { withTimeout } from "@/lib/with-timeout"

export const maxDuration = 45

const bodySchema = z.object({ book_id: z.string().uuid() })

const verdictSchema = z.object({
  verdicts: z.array(
    z.object({
      pair_id: z.string(),
      is_duplicate: z.boolean(),
      confidence: z.enum(["low", "medium", "high"]),
      reason: z.string(),
    }),
  ),
})

export interface ScanVerdict {
  is_duplicate: boolean
  confidence: "low" | "medium" | "high"
  reason: string
}
export type ScanResponsePair = CandidatePair & { verdict: ScanVerdict | null }

const SYSTEM_PROMPT = [
  "You judge suspected duplicate entries in a solo athletic-performance coach's bookkeeping ledger.",
  "Each candidate pair has the same direction and exact same amount, a few days apart; all amounts are integer cents.",
  "Two entries are duplicates ONLY if they plausibly record the SAME real-world transaction twice",
  "(classic case: a scanned receipt AND a bank-statement import of the same purchase; or the same statement imported twice).",
  "Recurring same-amount charges like subscriptions or weekly sessions, several days apart with matching memos, are usually NOT duplicates.",
  "Missing memos mean you rely on source, dates and amount; be conservative — is_duplicate true only when a double-record is the best explanation.",
  "Return a verdict for EVERY pair_id you are given, echoing the pair_id exactly.",
  "Your reasons are shown to the coach, labeled AI-generated. Keep each under 25 words.",
].join(" ")

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    }
    const { book_id } = parsed.data

    const [entries, dismissed] = await Promise.all([
      listEntriesForDuplicateScan(book_id),
      listDismissedFingerprints(book_id),
    ])
    const { pairs, truncated } = findCandidatePairs(entries, new Set(dismissed))
    if (pairs.length === 0) {
      return NextResponse.json({ pairs: [], ai: "skipped", truncated })
    }

    const startTime = Date.now()
    let logId: string | null = null
    try {
      const log = await createGenerationLog({
        program_id: null,
        client_id: null,
        requested_by: session.user.id,
        status: "pending",
        input_params: { feature: "bookkeeping_duplicate_scan", book_id, candidate_pairs: pairs.length },
        output_summary: null,
        error_message: null,
        model_used: MODEL_SONNET,
        tokens_used: null,
        cache_creation_tokens: null,
        cache_read_tokens: null,
        duration_ms: null,
        completed_at: null,
        current_step: 0,
        total_steps: 1,
        // NO generation_trigger — the live ai_generation_log has no such column
        // and PostgREST rejects the whole insert on an unknown key (PGRST204).
      })
      logId = log.id

      const payload = pairs.map((p) => ({
        pair_id: p.pair_id,
        day_gap: p.day_gap,
        same_source: p.same_source,
        memo_similarity: p.memo_similarity,
        a: { date: p.a.occurred_on, amount_cents: p.a.amount_cents, memo: p.a.memo, counterparty: p.a.counterparty, source: p.a.source },
        b: { date: p.b.occurred_on, amount_cents: p.b.amount_cents, memo: p.b.memo, counterparty: p.b.counterparty, source: p.b.source },
      }))

      const { content, tokens_used, cache_creation_tokens, cache_read_tokens } = await withTimeout(
        callAgent(SYSTEM_PROMPT, JSON.stringify({ pairs: payload }), verdictSchema, {
          model: MODEL_SONNET,
          maxTokens: 4000,
        }),
        25_000,
        "Duplicate scan AI verdict timed out",
      )

      const byPairId = new Map(content.verdicts.map((v) => [v.pair_id, v]))
      // Cleared pairs drop; model-omitted pairs stay with verdict null — an
      // omission is "needs human review", never a silent pass.
      const result: ScanResponsePair[] = pairs.flatMap((p) => {
        const v = byPairId.get(p.pair_id)
        if (v && !v.is_duplicate) return []
        return [{ ...p, verdict: v ? { is_duplicate: v.is_duplicate, confidence: v.confidence, reason: v.reason } : null }]
      })

      await updateGenerationLog(logId, {
        status: "completed",
        output_summary: { candidate_pairs: pairs.length, flagged: result.length },
        tokens_used,
        cache_creation_tokens: cache_creation_tokens ?? null,
        cache_read_tokens: cache_read_tokens ?? null,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
      })

      return NextResponse.json({ pairs: result, ai: "ok", truncated })
    } catch (err) {
      console.error("bookkeeping duplicate scan — continuing without AI:", err)
      if (logId) {
        await updateGenerationLog(logId, {
          status: "failed",
          error_message: err instanceof Error ? err.message : "Unknown error",
          duration_ms: Date.now() - startTime,
          completed_at: new Date().toISOString(),
        }).catch(() => {})
      }
      const fallback: ScanResponsePair[] = pairs.map((p) => ({ ...p, verdict: null }))
      return NextResponse.json({ pairs: fallback, ai: "unavailable", truncated })
    }
  } catch (error) {
    console.error("bookkeeping duplicate scan:", error)
    return NextResponse.json({ error: "Failed to scan for duplicates" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run __tests__/api/admin/bookkeeping/duplicates-scan.test.ts __tests__/lib/bookkeeping/duplicate-scan.test.ts`
Expected: PASS. If the route test flakes on jsdom fetch/Request, add `// @vitest-environment node` at the top of the test file (multipart-route precedent).

- [ ] **Step 5: Commit**

```powershell
git add lib/db/bookkeeping.ts "app/api/admin/bookkeeping/duplicates/scan/route.ts" __tests__/api/admin/bookkeeping/duplicates-scan.test.ts
git commit -m "feat(bookkeeping): AI duplicate-scan route - dismissal-aware, honest AI fallback"
```

---

### Task 3: Review dialog + BooksClient wiring

**Files:**
- Create: `components/admin/bookkeeping/DuplicateScanDialog.tsx`
- Modify: `components/admin/bookkeeping/BooksClient.tsx` (imports ~line 8-16, state ~line 98, toolbar after the Amazon button ~line 405-408, mount after `<AmazonImportDialog>` ~line 594-600)
- Test: `__tests__/components/admin/bookkeeping/DuplicateScanDialog.test.tsx`

**Interfaces:**
- Consumes: `ScanResponsePair` shape from Task 2 (import the type from the route is NOT allowed in a client component — declare a local `ScanPair` interface matching it); `formatCents` from `@/lib/bookkeeping/money`; existing routes `POST /api/admin/bookkeeping/duplicates/scan`, `DELETE /api/admin/bookkeeping/entries/[id]`, `POST /api/admin/bookkeeping/insights/dismissals`.
- Produces: `DuplicateScanDialog` with props `{ bookId: string; accounts: BookkeepingAccount[]; open: boolean; onOpenChange: (o: boolean) => void; onEntriesChanged: () => void }`.

- [ ] **Step 1: Write the failing tests**

`__tests__/components/admin/bookkeeping/DuplicateScanDialog.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { toast } from "sonner"
import { DuplicateScanDialog } from "@/components/admin/bookkeeping/DuplicateScanDialog"
import { duplicatePairFingerprint } from "@/lib/bookkeeping/finding-fingerprint"
import { pairId } from "@/lib/bookkeeping/duplicate-scan"
import type { BookkeepingAccount } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const BOOK_ID = "b0000000-0000-4000-8000-000000000001"
const ID_A = "e0000000-0000-4000-8000-000000000001"
const ID_B = "e0000000-0000-4000-8000-000000000002"
const ID_C = "e0000000-0000-4000-8000-000000000003"

const ACCOUNTS = [
  { id: "acc-1", name: "Equipment" } as BookkeepingAccount,
]

function scanEntry(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    occurred_on: "2026-07-01",
    amount_cents: 5000,
    direction: "expense",
    memo: "rogue fitness",
    counterparty: null,
    source: "statement_import",
    account_id: "acc-1",
    ...over,
  }
}

function pair(a: ReturnType<typeof scanEntry>, b: ReturnType<typeof scanEntry>, over: Record<string, unknown> = {}) {
  return {
    pair_id: pairId(a.id as string, b.id as string),
    fingerprint: duplicatePairFingerprint(a.id as string, b.id as string),
    a,
    b,
    day_gap: 1,
    same_source: false,
    memo_similarity: "similar",
    verdict: { is_duplicate: true, confidence: "high", reason: "same purchase twice" },
    ...over,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
})

function mockScan(pairs: unknown[], ai = "ok", truncated = false) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/duplicates/scan")) {
      return new Response(JSON.stringify({ pairs, ai, truncated }), { status: 200 })
    }
    throw new Error(`unexpected fetch ${url} ${init?.method}`)
  })
}

function renderDialog(onEntriesChanged = vi.fn()) {
  render(
    <DuplicateScanDialog
      bookId={BOOK_ID}
      accounts={ACCOUNTS}
      open
      onOpenChange={() => {}}
      onEntriesChanged={onEntriesChanged}
    />,
  )
  return onEntriesChanged
}

describe("<DuplicateScanDialog>", () => {
  it("scans on open and renders the pair with AI reason and account name", async () => {
    mockScan([pair(scanEntry(ID_A), scanEntry(ID_B, { occurred_on: "2026-07-02", source: "receipt" }))])
    renderDialog()
    expect(await screen.findByText(/same purchase twice/)).toBeInTheDocument()
    expect(screen.getAllByText("$50.00")).toHaveLength(2)
    expect(screen.getAllByText("Equipment").length).toBeGreaterThan(0)
  })

  it("shows the empty state when the scan finds nothing", async () => {
    mockScan([], "skipped")
    renderDialog()
    expect(await screen.findByText(/No duplicate candidates found/)).toBeInTheDocument()
  })

  it("shows the heuristic-only banner when ai is unavailable", async () => {
    mockScan([pair(scanEntry(ID_A), scanEntry(ID_B), { verdict: null })], "unavailable")
    renderDialog()
    expect(await screen.findByText(/AI unavailable/)).toBeInTheDocument()
  })

  it("delete removes EVERY pair containing that entry and refreshes the ledger", async () => {
    const p1 = pair(scanEntry(ID_A), scanEntry(ID_B, { occurred_on: "2026-07-02" }))
    const p2 = pair(scanEntry(ID_A), scanEntry(ID_C, { occurred_on: "2026-07-03" }))
    mockScan([p1, p2])
    const onEntriesChanged = renderDialog()
    await screen.findAllByText(/same purchase twice/)

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes(`/entries/${ID_A}`) && init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    const user = userEvent.setup()
    // First Delete button belongs to entry A of the first pair; confirm step re-labels it.
    await user.click(screen.getAllByRole("button", { name: /^Delete$/ })[0])
    await user.click(screen.getByRole("button", { name: /Confirm delete/ }))

    await waitFor(() => {
      expect(screen.queryAllByText(/same purchase twice/)).toHaveLength(0)
    })
    expect(onEntriesChanged).toHaveBeenCalled()
  })

  it("surfaces the closed-period 409 as an error toast and keeps the pair", async () => {
    mockScan([pair(scanEntry(ID_A), scanEntry(ID_B, { occurred_on: "2026-07-02" }))])
    renderDialog()
    await screen.findByText(/same purchase twice/)

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ error: "That month is closed." }), { status: 409 })
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    const user = userEvent.setup()
    await user.click(screen.getAllByRole("button", { name: /^Delete$/ })[0])
    await user.click(screen.getByRole("button", { name: /Confirm delete/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That month is closed."))
    expect(screen.getByText(/same purchase twice/)).toBeInTheDocument()
  })

  it("'Not a duplicate' posts the pair fingerprint to the dismissals route and removes only that pair", async () => {
    const p1 = pair(scanEntry(ID_A), scanEntry(ID_B, { occurred_on: "2026-07-02" }))
    mockScan([p1])
    renderDialog()
    await screen.findByText(/same purchase twice/)

    let dismissBody: unknown = null
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/insights/dismissals") && init?.method === "POST") {
        dismissBody = JSON.parse(String(init.body))
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: /Not a duplicate/ }))

    await waitFor(() => expect(screen.queryByText(/same purchase twice/)).not.toBeInTheDocument())
    expect(dismissBody).toEqual({ book_id: BOOK_ID, fingerprint: duplicatePairFingerprint(ID_A, ID_B) })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run __tests__/components/admin/bookkeeping/DuplicateScanDialog.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the dialog**

`components/admin/bookkeeping/DuplicateScanDialog.tsx`:

```tsx
"use client"

// Review UI for the post-hoc AI duplicate scan. The dialog owns NO mutation
// logic of its own: deletes go through the existing audited entries route
// (closed-period 409 surfaces as a toast), "not a duplicate" persists a pair
// fingerprint through the existing dismissals route. Deleting an entry clears
// every pair containing it; dismissing clears only that pair.
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatCents } from "@/lib/bookkeeping/money"
import type { DuplicateScanEntry, MemoSimilarity } from "@/lib/bookkeeping/duplicate-scan"
import type { BookkeepingAccount } from "@/types/database"

interface ScanVerdict {
  is_duplicate: boolean
  confidence: "low" | "medium" | "high"
  reason: string
}
interface ScanPair {
  pair_id: string
  fingerprint: string
  a: DuplicateScanEntry
  b: DuplicateScanEntry
  day_gap: number
  same_source: boolean
  memo_similarity: MemoSimilarity
  verdict: ScanVerdict | null
}
type AiStatus = "ok" | "skipped" | "unavailable"

const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }
const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  platform_import: "Platform",
  statement_import: "Statement",
  receipt: "Receipt",
}

export function DuplicateScanDialog({
  bookId,
  accounts,
  open,
  onOpenChange,
  onEntriesChanged,
}: {
  bookId: string
  accounts: BookkeepingAccount[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onEntriesChanged: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [pairs, setPairs] = useState<ScanPair[]>([])
  const [ai, setAi] = useState<AiStatus>("ok")
  const [truncated, setTruncated] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null) // `${pair_id}:${entry_id}`

  const scan = useCallback(async () => {
    setLoading(true)
    setScanned(false)
    setConfirming(null)
    try {
      const res = await fetch("/api/admin/bookkeeping/duplicates/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Scan failed")
        return
      }
      const sorted = [...(data.pairs as ScanPair[])].sort(
        (p, q) =>
          (p.verdict ? CONFIDENCE_RANK[p.verdict.confidence] : 3) -
            (q.verdict ? CONFIDENCE_RANK[q.verdict.confidence] : 3) ||
          p.a.occurred_on.localeCompare(q.a.occurred_on),
      )
      setPairs(sorted)
      setAi(data.ai as AiStatus)
      setTruncated(Boolean(data.truncated))
      setScanned(true)
    } catch {
      toast.error("Scan failed")
    } finally {
      setLoading(false)
    }
  }, [bookId])

  useEffect(() => {
    if (open && bookId) void scan()
  }, [open, bookId, scan])

  function accountName(id: string | null): string | null {
    if (!id) return null
    return accounts.find((a) => a.id === id)?.name ?? null
  }

  async function deleteEntry(entryId: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/bookkeeping/entries/${entryId}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Failed to delete entry")
        return
      }
      setPairs((ps) => ps.filter((p) => p.a.id !== entryId && p.b.id !== entryId))
      toast.success("Entry deleted")
      onEntriesChanged()
    } catch {
      toast.error("Failed to delete entry")
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  async function dismissPair(p: ScanPair) {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/insights/dismissals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, fingerprint: p.fingerprint }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Failed to save")
        return
      }
      setPairs((ps) => ps.filter((x) => x.pair_id !== p.pair_id))
      toast.success("Marked as not a duplicate — it won't be flagged again")
    } catch {
      toast.error("Failed to save")
    } finally {
      setBusy(false)
    }
  }

  function EntryCard({ pair, entry }: { pair: ScanPair; entry: DuplicateScanEntry }) {
    const key = `${pair.pair_id}:${entry.id}`
    const account = accountName(entry.account_id)
    return (
      <div className="rounded-md border border-border bg-background p-3 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm font-semibold">{formatCents(entry.amount_cents)}</span>
          <Badge variant="outline">{SOURCE_LABELS[entry.source] ?? entry.source}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{entry.occurred_on}</p>
        {(entry.counterparty || entry.memo) && (
          <p className="text-sm text-foreground break-words">
            {[entry.counterparty, entry.memo].filter(Boolean).join(" — ")}
          </p>
        )}
        {account && <p className="text-xs text-muted-foreground">{account}</p>}
        {confirming === key ? (
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void deleteEntry(entry.id)}>
              Confirm delete
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(null)}>
              Keep
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(key)}>
            Delete
          </Button>
        )}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Duplicate scan</DialogTitle>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Scanning the ledger — AI is reviewing candidate pairs…</p>}

        {!loading && scanned && (
          <div className="space-y-4">
            {ai === "unavailable" && (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
                AI unavailable — showing raw heuristic matches (same amount, same direction, within 7 days). Review with extra care.
              </p>
            )}
            {truncated && (
              <p className="text-sm text-muted-foreground">
                Showing the first 40 candidate pairs — resolve these, then scan again for the rest.
              </p>
            )}

            {pairs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No duplicate candidates found. Your ledger looks clean.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {pairs.length} suspected duplicate {pairs.length === 1 ? "pair" : "pairs"}. Deleting an entry removes it from the
                  ledger; “Not a duplicate” hides the pair from every future scan.
                </p>
                <ul className="space-y-3">
                  {pairs.map((p) => (
                    <li key={p.pair_id} className="rounded-lg border border-border bg-card p-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {p.verdict ? (
                          <>
                            <Badge>{p.verdict.confidence} confidence</Badge>
                            <span className="text-sm text-foreground">{p.verdict.reason}</span>
                            <span className="text-xs text-muted-foreground">(AI-generated)</span>
                          </>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            Heuristic match — same amount, {p.day_gap === 0 ? "same day" : `${p.day_gap} day${p.day_gap === 1 ? "" : "s"} apart`}
                          </span>
                        )}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <EntryCard pair={p} entry={p.a} />
                        <EntryCard pair={p} entry={p.b} />
                      </div>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void dismissPair(p)}>
                        Not a duplicate
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => void scan()} disabled={loading}>
            Scan again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

Check `components/ui/badge.tsx` exists before using `Badge` (it's used elsewhere in admin components); if the `variant="destructive"` button or `border-warning` classes don't exist in this design system, match the closest existing convention (grep `text-error`, `bg-error`, `variant="destructive"` in `components/` and reuse what's there).

- [ ] **Step 4: Wire into BooksClient**

In `components/admin/bookkeeping/BooksClient.tsx`:

1. Add import: `import { DuplicateScanDialog } from "@/components/admin/bookkeeping/DuplicateScanDialog"` (with the other dialog imports, ~line 16) and add `ScanSearch` to the existing `lucide-react` import.
2. Add state next to `amazonOpen` (~line 98): `const [dupScanOpen, setDupScanOpen] = useState(false)`.
3. Toolbar — after the Import Amazon button (~line 408):

```tsx
<Button size="sm" variant="outline" onClick={() => setDupScanOpen(true)}>
  <ScanSearch className="size-4" />
  Find duplicates
</Button>
```

4. Mount — after `<AmazonImportDialog … />` (~line 600):

```tsx
<DuplicateScanDialog
  bookId={bookId}
  accounts={accounts}
  open={dupScanOpen}
  onOpenChange={setDupScanOpen}
  onEntriesChanged={fetchEntries}
/>
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run __tests__/components/admin/bookkeeping/DuplicateScanDialog.test.tsx __tests__/components/admin/bookkeeping/BooksClient-hydration.test.tsx`
Expected: PASS (dialog tests green; hydration test still green after the wiring).

- [ ] **Step 6: Commit**

```powershell
git add components/admin/bookkeeping/DuplicateScanDialog.tsx components/admin/bookkeeping/BooksClient.tsx __tests__/components/admin/bookkeeping/DuplicateScanDialog.test.tsx
git commit -m "feat(bookkeeping): duplicate-scan review dialog + Find duplicates toolbar button"
```

---

### Task 4: Verification gate

- [ ] **Step 1: Targeted suites**

Run: `npx vitest run __tests__/lib/bookkeeping/duplicate-scan.test.ts __tests__/api/admin/bookkeeping/duplicates-scan.test.ts __tests__/components/admin/bookkeeping/DuplicateScanDialog.test.tsx __tests__/components/admin/bookkeeping/BooksClient-hydration.test.tsx __tests__/components/admin/bookkeeping/InsightsClient-dismissals.test.tsx`
Expected: all PASS. (Do NOT run the full suite — known-red load flakes exist; targeted only.)

- [ ] **Step 2: Build gate**

Run: `npm run build` and grep its output for `duplicate` / the new files' paths.
Expected: compiles; the new route appears in the route manifest. No root-side import into `functions/src` was added, so the Vercel-condition build trick is NOT needed.

- [ ] **Step 3: Commit anything the build fixed, if applicable**

Only files this feature owns.
