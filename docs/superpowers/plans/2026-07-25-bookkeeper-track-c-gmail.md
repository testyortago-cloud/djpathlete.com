# Track C — 3b Gmail Receipt Poller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll a Gmail label for receipt attachments, land them in the private bucket as bookkeeping_documents, reuse the shipped receipt_scan vision job, and review/commit them through the existing receipt flow.

**Architecture:** The poller reuses the already-shipped Gmail OAuth connection (platform_connections row "gmail"), runs strictly read-only, and is idempotent via a nullable UNIQUE external_ref used check-then-insert (never an onConflict target). The upload-route recipe is extracted into a shared ingest helper so photo upload and email ingest share one implementation. Scan results persist on the document so a durable review surface can exist. Ships doubly inert: flag OFF, and a degraded success-skip when Gmail is not connected.

**Tech Stack:** Next.js 16 App Router (no src/), TypeScript strict, Supabase PostgreSQL (service-role DAL in `lib/db/`), Zod validators, Vitest + Testing Library, Firebase Functions (`onSchedule` delegators), Stripe SDK 20.3.1, Anthropic via `lib/ai/anthropic.ts`.

## Global Constraints

- **Design doc:** `docs/superpowers/specs/2026-07-25-bookkeeper-completion-design.md` (committed `c445a4d1`) — every decision + rationale lives there. Deviating from it requires recording a new decision.
- **Solo-dev convention:** commit directly on `main` as each task lands. **NEVER push** — the owner holds the push.
- **Money math is integer cents end-to-end.** Stripe `balanceTransactions` amounts are already cents; no float conversion anywhere. Every pinned number needs a mutation-discriminating fixture (the 12.555 house style — a value where round, trunc, sum-of-rounds and round-of-sum all differ).
- **Migrations** apply live via `mcp__supabase__apply_migration` (the Supabase CLI is not linked). Write the identical SQL to `supabase/migrations/<n>_<name>.sql` as well. Additive, reversible, inert without code.
- **PostgREST:** every growth-table read uses `fetchAllRows` (`lib/db/paginate.ts`) — a bare `.select()` silently caps at ~1000 rows. Upsert `onConflict` keys must be PLAIN unique constraints, never expression indexes.
- **Never edit** `app/api/stripe/webhook/route.ts`. Reconcile-by-read on a schedule instead.
- **functions/ ↔ lib/ boundary:** `functions/` cannot import from `lib/`; root code must never import from `functions/src` (it breaks the Vercel deploy). Helpers needed in both runtimes are twin copies.
- **Cron discipline:** three-way byte-identical name contract (functions POST path ↔ route directory ↔ the `cron_runs`/`EXPECTED_CRONS` name). The ROUTE is the single `cron_runs` owner; the functions delegator never logs. Delegator secrets are `[internalCronToken, appUrl]` ONLY. Success-skip (HTTP 200) when the flag is OFF or there is nothing to do.
- **Auth:** `/api/*` self-gates via `auth()` → 403 (middleware does not cover `/api`). Internal cron routes use the Bearer triple-clause. JSON screen-reads stay unaudited; mutations and downloads are audited with slugs registered in `lib/audit/actions.ts`.
- **Feature flags** are DB-backed rows in `system_settings`, never env vars; new crons arrive with their flag seeded `false`.
- **Tests:** pure fns → `__tests__/lib/bookkeeping/` (zero-mock); routes → `__tests__/api/admin/...` or `__tests__/app/api/admin/...` matching siblings; functions-side → `functions/src/__tests__/`; RFC-4122 fixture UUIDs; multipart route tests need `// @vitest-environment node`.
- **Gates run by the orchestrator between tracks, not inside tasks:** the full suite against the known-red baseline (the Stripe-webhook pair wall-clock-flakes under load — stash-isolate before blaming a change), then `npm run build` as its OWN command, never `&&`-chained behind tests.
- **Commit messages:** conventional commits; multi-line messages go through a scratchpad file + `git commit -F <file>` (PowerShell here-strings get mangled by this harness).
- **Task count:** 6.

---

### Task C1: Migration 00193 — `external_ref` + `scan_result` on bookkeeping_documents, poller flag + label seeds

**Files:**
- Create: `supabase/migrations/00193_bookkeeping_gmail_receipts.sql`
- Create: `__tests__/migrations/00193_bookkeeping_gmail_receipts.test.ts`
- Modify: `types/database.ts` (BookkeepingDocument interface ~:594-612, NewDocument ~:613-616)

**Interfaces:**
- Produces (DB): `bookkeeping_documents.external_ref text UNIQUE` (nullable, NULLs-distinct), `bookkeeping_documents.scan_result jsonb`; `system_settings` seeds `cron_bookkeeping_gmail_receipts_enabled = false`, `bookkeeping_gmail_receipt_label = "DJP Receipts"`.
- Produces (types): `BookkeepingDocument.external_ref: string | null`, `BookkeepingDocument.scan_result: Record<string, unknown> | null`, `NewDocument` gains optional `external_ref?: string | null` (intersection, NOT added to the Pick — existing `createDocument` callers in `app/api/admin/bookkeeping/receipts/upload/route.ts:113-124` and the statement/Amazon routes don't pass it and must keep compiling).
- Consumes: seed style of `supabase/migrations/00190_bookkeeping_income_sync.sql` (verified: `insert into system_settings (key, value, description) values (...) on conflict (key) do nothing`).

Steps:

- [ ] Write the failing migration-content test at `__tests__/migrations/00193_bookkeeping_gmail_receipts.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("00193_bookkeeping_gmail_receipts.sql", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/00193_bookkeeping_gmail_receipts.sql"),
    "utf8",
  )

  it("adds external_ref as a plain UNIQUE text column + scan_result jsonb", () => {
    expect(sql).toMatch(/alter table bookkeeping_documents add column external_ref text unique/i)
    expect(sql).toMatch(/alter table bookkeeping_documents add column scan_result jsonb/i)
  })

  it("documents the check-then-insert-only discipline for external_ref", () => {
    // Nullable + NULLS-distinct makes this unusable as a PostgREST upsert key
    // (memory: postgrest_onconflict_plain_unique) — the comment must survive
    // in the SQL so a future upsert refactor trips over it.
    expect(sql.toLowerCase()).toContain("check-then-insert")
    expect(sql.toLowerCase()).toContain("onconflict")
  })

  it("seeds the poller flag OFF and the label setting, idempotently", () => {
    expect(sql).toContain("'cron_bookkeeping_gmail_receipts_enabled', 'false'::jsonb")
    expect(sql).toContain(`'bookkeeping_gmail_receipt_label', '"DJP Receipts"'::jsonb`)
    expect(sql).toContain("on conflict (key) do nothing")
  })
})
```

- [ ] Run it: `npx vitest run __tests__/migrations/00193_bookkeeping_gmail_receipts.test.ts` — expected failure: `ENOENT: no such file or directory ... 00193_bookkeeping_gmail_receipts.sql`.
- [ ] Write `supabase/migrations/00193_bookkeeping_gmail_receipts.sql` with exactly this SQL:

```sql
-- 00193_bookkeeping_gmail_receipts.sql
-- Track C (Phase 3b): Gmail receipt poller data model.
--
-- external_ref holds the poller idempotency key 'gmail:<messageId>:<attachmentIndex>'.
-- CONSTRAINT DISCIPLINE: this column is check-then-insert only (the poller skips a
-- message when any document matches external_ref LIKE 'gmail:<id>:%'). It must NEVER
-- become a PostgREST onConflict target — it is nullable and Postgres treats NULLs as
-- distinct, so an upsert keyed on it can never dedupe (every existing photo/statement
-- row has external_ref NULL). The UNIQUE below is the belt behind the skip check, not
-- an upsert seam.
--
-- scan_result is the durable home for the coalesced vision result (the functions
-- receipt-scan handler writes it; the photo flow's RTDB/browser-memory path is
-- unchanged).
alter table bookkeeping_documents add column external_ref text unique;
alter table bookkeeping_documents add column scan_result jsonb;

insert into system_settings (key, value, description) values
  ('cron_bookkeeping_gmail_receipts_enabled', 'false'::jsonb, 'Enable the hourly Gmail receipt-label poller (ingests labeled attachments as receipt scans)'),
  ('bookkeeping_gmail_receipt_label', '"DJP Receipts"'::jsonb, 'Gmail label name the receipt poller watches')
on conflict (key) do nothing;
```

- [ ] Run again: `npx vitest run __tests__/migrations/00193_bookkeeping_gmail_receipts.test.ts` — expected pass (3 tests).
- [ ] Apply live: call the MCP tool `mcp__supabase__apply_migration` with `name: "00193_bookkeeping_gmail_receipts"` and the exact SQL above (CLI not linked — no `db push`). Additive and inert: flag is OFF, no code reads the columns yet.
- [ ] Update `types/database.ts`. In `BookkeepingDocument` (after `period_end: string | null`, before `created_at`), add:

```ts
  /** Poller idempotency key 'gmail:<messageId>:<attachmentIndex>'.
   *  Check-then-insert only — never a PostgREST onConflict target (00193). */
  external_ref: string | null
  /** Durable coalesced vision result, written by functions/src/receipt-scan.ts. */
  scan_result: Record<string, unknown> | null
```

  and change `NewDocument` to:

```ts
export type NewDocument = Pick<
  BookkeepingDocument,
  "book_id" | "kind" | "original_filename" | "storage_path" | "mime_type" | "file_size_bytes" | "sha256" | "retain_until" | "uploaded_by" | "row_count"
> & { external_ref?: string | null }
```

- [ ] Run adjacent tests to prove no type fallout in the DAL consumers: `npx vitest run __tests__/api/admin/bookkeeping/documents.test.ts __tests__/app/api/admin/bookkeeping/receipts-upload.test.ts` — expected pass, unchanged.
- [ ] Commit. Write the message file via Bash:

```bash
cat > "/c/Users/tayaw/AppData/Local/Temp/claude/c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete/09812efa-7e7c-44fc-b449-2a6d8f09a5aa/scratchpad/c1-msg.txt" <<'EOF'
feat(bookkeeping): migration 00193 gmail-receipt columns + poller flag/label seeds

external_ref (plain UNIQUE, check-then-insert only — never an onConflict
target) + scan_result jsonb on bookkeeping_documents; seeds
cron_bookkeeping_gmail_receipts_enabled=false and
bookkeeping_gmail_receipt_label="DJP Receipts". Applied live via MCP.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
```

  then `git add supabase/migrations/00193_bookkeeping_gmail_receipts.sql __tests__/migrations/00193_bookkeeping_gmail_receipts.test.ts types/database.ts` and `git commit -F "/c/Users/tayaw/AppData/Local/Temp/claude/c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete/09812efa-7e7c-44fc-b449-2a6d8f09a5aa/scratchpad/c1-msg.txt"`.

---

### Task C2: Gmail client helpers — listLabels / listMessages / getMessage / getAttachment

**Files:**
- Modify: `lib/gmail/client.ts` (append after `getMessageMetadata`, :179-195; mirror the raw-fetch style of `listThreads` :153-168 and `getThread` :170-177; base64url handling mirrors `base64UrlDecode` :278-282)
- Create: `__tests__/lib/gmail/client.test.ts` (no `__tests__/lib/gmail/` exists today — verified; these helpers get direct fetch-stub tests here, and the C5 route tests cover them at the seam)

**Interfaces:**
- Produces (all exported from `lib/gmail/client.ts`):
  - `interface GmailLabel { id: string; name: string; type?: string }`
  - `listLabels(accessToken: string): Promise<GmailLabel[]>`
  - `interface GmailMessageListItem { id: string; threadId: string }`
  - `interface ListMessagesResponse { messages?: GmailMessageListItem[]; nextPageToken?: string; resultSizeEstimate?: number }`
  - `listMessages(accessToken: string, opts?: { labelIds?: string[]; pageToken?: string; maxResults?: number; q?: string }): Promise<ListMessagesResponse>`
  - `getMessage(accessToken: string, messageId: string): Promise<GmailMessage>` (**format=full** — the existing `getMessageMetadata` is format=metadata and returns no payload parts/attachment ids)
  - `getAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<Buffer>` (base64url → Buffer)
- Consumes: private `gmailFetch` (`lib/gmail/client.ts:128-142`), existing `GmailMessage` type (:26-33).

Steps:

- [ ] Write the failing test at `__tests__/lib/gmail/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// client.ts imports these at module top — stub so importing it is side-effect free.
vi.mock("@/lib/db/platform-connections", () => ({
  getPlatformConnection: vi.fn(), connectPlatform: vi.fn(), setConnectionError: vi.fn(),
}))
vi.mock("@/lib/gmail/oauth", () => ({ refreshAccessToken: vi.fn() }))

import { listLabels, listMessages, getMessage, getAttachment } from "@/lib/gmail/client"

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) }
}

beforeEach(() => fetchMock.mockReset())

describe("listLabels", () => {
  it("GETs /labels and returns the labels array ([] when absent)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ labels: [{ id: "L1", name: "DJP Receipts" }] }))
    expect(await listLabels("tok")).toEqual([{ id: "L1", name: "DJP Receipts" }])
    expect(fetchMock.mock.calls[0][0]).toBe("https://gmail.googleapis.com/gmail/v1/users/me/labels")
    fetchMock.mockResolvedValue(jsonResponse({}))
    expect(await listLabels("tok")).toEqual([])
  })
  it("throws with status on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "x" }, false, 500))
    await expect(listLabels("tok")).rejects.toThrow(/listLabels failed: HTTP 500/)
  })
})

describe("listMessages", () => {
  it("builds labelIds + pageToken params on /messages", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "p2" }))
    const out = await listMessages("tok", { labelIds: ["L1"], pageToken: "abc" })
    expect(out.messages).toEqual([{ id: "m1", threadId: "t1" }])
    expect(out.nextPageToken).toBe("p2")
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("/messages?")
    expect(url).toContain("labelIds=L1")
    expect(url).toContain("pageToken=abc")
  })
})

describe("getMessage", () => {
  it("fetches format=full so payload parts / attachment ids are present", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "m1", threadId: "t1", payload: { mimeType: "multipart/mixed" } }))
    const msg = await getMessage("tok", "m1")
    expect(msg.payload?.mimeType).toBe("multipart/mixed")
    expect(fetchMock.mock.calls[0][0]).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/m1?format=full")
  })
})

describe("getAttachment", () => {
  it("decodes base64url (unpadded, -/_ alphabet) to the original bytes", async () => {
    const bytes = Buffer.from([0xfb, 0xff, 0xef, 0x01, 0x3e])
    const b64url = bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
    fetchMock.mockResolvedValue(jsonResponse({ size: bytes.length, data: b64url }))
    const out = await getAttachment("tok", "m1", "att1")
    expect(out.equals(bytes)).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/attachments/att1",
    )
  })
  it("throws with status on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 404))
    await expect(getAttachment("tok", "m1", "att1")).rejects.toThrow(/getAttachment failed: HTTP 404/)
  })
})
```

- [ ] Run it: `npx vitest run __tests__/lib/gmail/client.test.ts` — expected failure: `listLabels` / `listMessages` / `getMessage` / `getAttachment` are not exported.
- [ ] Append to `lib/gmail/client.ts` (directly after `getMessageMetadata`, before `modifyThreadLabels`), mirroring the `listThreads`/`getThread` raw-fetch + error style:

```ts
// ─── Receipt-poller helpers (Track C) ─────────────────────────────────────

export interface GmailLabel {
  id: string
  name: string
  type?: string
}

export async function listLabels(accessToken: string): Promise<GmailLabel[]> {
  const res = await gmailFetch(accessToken, "/labels")
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Gmail listLabels failed: HTTP ${res.status} ${text}`)
  }
  const json = (await res.json()) as { labels?: GmailLabel[] }
  return json.labels ?? []
}

export interface GmailMessageListItem {
  id: string
  threadId: string
}

export interface ListMessagesResponse {
  messages?: GmailMessageListItem[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

export async function listMessages(
  accessToken: string,
  opts: { labelIds?: string[]; pageToken?: string; maxResults?: number; q?: string } = {},
): Promise<ListMessagesResponse> {
  const params = new URLSearchParams()
  if (opts.q) params.set("q", opts.q)
  if (opts.pageToken) params.set("pageToken", opts.pageToken)
  params.set("maxResults", String(opts.maxResults ?? 25))
  for (const id of opts.labelIds ?? []) params.append("labelIds", id)
  const res = await gmailFetch(accessToken, `/messages?${params.toString()}`)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Gmail listMessages failed: HTTP ${res.status} ${text}`)
  }
  return (await res.json()) as ListMessagesResponse
}

/** Full-format single message — payload parts + attachment ids included.
 *  (getMessageMetadata above is format=metadata and has neither.) */
export async function getMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
  const res = await gmailFetch(accessToken, `/messages/${encodeURIComponent(messageId)}?format=full`)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Gmail getMessage failed: HTTP ${res.status} ${text}`)
  }
  return (await res.json()) as GmailMessage
}

/** users.messages.attachments.get — Gmail returns base64url body data. */
export async function getAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const res = await gmailFetch(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  )
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Gmail getAttachment failed: HTTP ${res.status} ${text}`)
  }
  const json = (await res.json()) as { size?: number; data?: string }
  const data = json.data ?? ""
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=")
  return Buffer.from(padded, "base64")
}
```

- [ ] Run again: `npx vitest run __tests__/lib/gmail/client.test.ts` — expected pass (7 tests).
- [ ] Commit:

```bash
cat > "/c/Users/tayaw/AppData/Local/Temp/claude/c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete/09812efa-7e7c-44fc-b449-2a6d8f09a5aa/scratchpad/c2-msg.txt" <<'EOF'
feat(gmail): listLabels/listMessages/getMessage/getAttachment client helpers

Raw-fetch style matching listThreads/getThread; getMessage is format=full
(getMessageMetadata has no payload parts); getAttachment decodes Gmail's
base64url to a Buffer. Needed by the Track C receipt poller.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
git add lib/gmail/client.ts __tests__/lib/gmail/client.test.ts
git commit -F "/c/Users/tayaw/AppData/Local/Temp/claude/c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete/09812efa-7e7c-44fc-b449-2a6d8f09a5aa/scratchpad/c2-msg.txt"
```

---

### Task C3: Extract `ingestReceiptDocument` — one implementation of the receipt-ingest recipe

**Files:**
- Create: `lib/bookkeeping/receipt-ingest.ts`
- Modify: `app/api/admin/bookkeeping/receipts/upload/route.ts` (delegate the block at :96-182 minus the sha-hint/book lookups; drop now-unused imports)
- Create: `__tests__/lib/bookkeeping/receipt-ingest.test.ts`

**Interfaces:**
- Produces (`lib/bookkeeping/receipt-ingest.ts`):
  - `interface ReceiptScanJobInput { storagePath: string; mimeType: string; accounts: { name: string; account_type: "income" | "expense" }[]; bookName: string; bookKind: "business" | "household"; documentId: string; logId?: string; requestedBy: string }` (moved here from the route — still the Next.js half of the twin re-declared at `functions/src/receipt-scan.ts:36-45`; functions/ cannot import lib/)
  - `interface IngestReceiptArgs { bookId: string; buffer: Buffer; mimeType: string; originalFilename: string; uploadedBy: string | null; externalRef?: string | null; accounts: { name: string; account_type: "income" | "expense" }[]; bookName: string; bookKind: "business" | "household" }`
  - `interface IngestReceiptResult { documentId: string; jobId: string; logId: string; sha256: string }`
  - `ingestReceiptDocument(args: IngestReceiptArgs): Promise<IngestReceiptResult>`
- Consumes: `createDocument` (`lib/db/bookkeeping.ts:325`), `createGenerationLog` (`lib/db/ai-generation-log.ts` — `requested_by?: string` is optional, DB column is nullable uuid per `00037_fix_user_delete_cascades.sql:31`), `safeStatementName`/`storeStatementFile` (`lib/bookkeeping/documents.ts:3-10`), `getAdminFirestore`/`getAdminRtdb` (`lib/firebase-admin.ts`), `FieldValue` (firebase-admin/firestore), `NewDocument.external_ref` (C1).

**BEHAVIOR-DIFF REQUIREMENT:** `__tests__/app/api/admin/bookkeeping/receipts-upload.test.ts` (5 tests) must pass **unchanged** — its `vi.mock`s of `@/lib/db/bookkeeping`, `@/lib/bookkeeping/documents`, `@/lib/db/ai-generation-log`, `@/lib/firebase-admin`, and `firebase-admin/firestore` apply equally to the extracted module, so the route's observable behavior (202 shape, `kind:"receipt"` document, `receipt_scan` job payload, mime/size/uuid gates) is pinned before and after.

Steps:

- [ ] Write the failing test at `__tests__/lib/bookkeeping/receipt-ingest.test.ts` (mock shape mirrors `__tests__/app/api/admin/bookkeeping/receipts-upload.test.ts`, incl. its `vi.hoisted` jobSet trick):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/bookkeeping", () => ({ createDocument: vi.fn().mockResolvedValue({ id: "d1" }) }))
vi.mock("@/lib/bookkeeping/documents", () => ({ storeStatementFile: vi.fn(), safeStatementName: (n: string) => n }))
vi.mock("@/lib/db/ai-generation-log", () => ({ createGenerationLog: vi.fn().mockResolvedValue({ id: "log1" }) }))
const { jobSet, rtdbSet } = vi.hoisted(() => ({ jobSet: vi.fn(), rtdbSet: vi.fn() }))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ id: "job1", set: jobSet }) }) }),
  getAdminRtdb: () => ({ ref: () => ({ set: rtdbSet }) }),
}))
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "ts" } }))

import { createDocument } from "@/lib/db/bookkeeping"
import { createGenerationLog } from "@/lib/db/ai-generation-log"
import { storeStatementFile } from "@/lib/bookkeeping/documents"
import { ingestReceiptDocument } from "@/lib/bookkeeping/receipt-ingest"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ADMIN = "11111111-2222-4333-8444-555555555555"
const baseArgs = {
  bookId: BOOK,
  buffer: Buffer.from("PDFDATA"),
  mimeType: "application/pdf",
  originalFilename: "receipt.pdf",
  uploadedBy: ADMIN as string | null,
  accounts: [{ name: "Equipment", account_type: "expense" as const }],
  bookName: "Darren — DJP Athlete",
  bookKind: "business" as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(createDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "d1" })
  ;(createGenerationLog as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "log1" })
})

describe("ingestReceiptDocument", () => {
  it("stores under bookkeeping/receipts/<bookId>/<uuid>/<safeName> and creates a receipt document", async () => {
    const out = await ingestReceiptDocument(baseArgs)
    expect(out).toMatchObject({ documentId: "d1", jobId: "job1", logId: "log1" })
    const [path, buf, mime] = (storeStatementFile as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(path).toMatch(new RegExp(`^bookkeeping/receipts/${BOOK}/[0-9a-f-]{36}/receipt\\.pdf$`))
    expect((buf as Buffer).equals(Buffer.from("PDFDATA"))).toBe(true)
    expect(mime).toBe("application/pdf")
    expect((createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      book_id: BOOK, kind: "receipt", external_ref: null, uploaded_by: ADMIN,
      row_count: 1, file_size_bytes: 7, mime_type: "application/pdf",
    })
    // Job payload is the exact upload-route recipe
    const jobPayload = jobSet.mock.calls[0][0]
    expect(jobPayload.type).toBe("receipt_scan")
    expect(jobPayload.status).toBe("pending")
    expect(jobPayload.input).toMatchObject({
      mimeType: "application/pdf", documentId: "d1", logId: "log1",
      accounts: [{ name: "Equipment", account_type: "expense" }],
      bookName: "Darren — DJP Athlete", bookKind: "business", requestedBy: ADMIN,
    })
  })

  it("passes externalRef through to the document row (poller idempotency key)", async () => {
    await ingestReceiptDocument({ ...baseArgs, externalRef: "gmail:m1:0" })
    expect((createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      external_ref: "gmail:m1:0",
    })
  })

  it("null uploadedBy (cron) → uploaded_by null, requested_by omitted, system requestedBy on the job", async () => {
    await ingestReceiptDocument({ ...baseArgs, uploadedBy: null, externalRef: "gmail:m1:0" })
    expect((createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ uploaded_by: null })
    expect((createGenerationLog as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toHaveProperty("requested_by")
    expect(jobSet.mock.calls[0][0].input.requestedBy).toBe("bookkeepingGmailReceiptsCron")
    expect(jobSet.mock.calls[0][0].userId).toBe("bookkeepingGmailReceiptsCron")
  })

  it("survives an RTDB seed failure (best-effort, same as the route's try/catch)", async () => {
    rtdbSet.mockRejectedValueOnce(new Error("rtdb down"))
    await expect(ingestReceiptDocument(baseArgs)).resolves.toMatchObject({ jobId: "job1" })
  })
})
```

- [ ] Run it: `npx vitest run __tests__/lib/bookkeeping/receipt-ingest.test.ts` — expected failure: `Cannot find module '@/lib/bookkeeping/receipt-ingest'`.
- [ ] Create `lib/bookkeeping/receipt-ingest.ts`:

```ts
// lib/bookkeeping/receipt-ingest.ts
// The receipt-ingest recipe (private-bucket store → bookkeeping_documents row
// → ai_generation_log → Firestore receipt_scan job → best-effort RTDB seed),
// extracted verbatim from app/api/admin/bookkeeping/receipts/upload/route.ts
// so the Gmail poller (Track C) and the photo upload route share ONE
// implementation. externalRef ('gmail:<messageId>:<attachmentIndex>') is the
// poller's idempotency key — check-then-insert only, never an onConflict
// target (migration 00193 comment).
import { createHash, randomUUID } from "node:crypto"
import { createDocument } from "@/lib/db/bookkeeping"
import { createGenerationLog } from "@/lib/db/ai-generation-log"
import { safeStatementName, storeStatementFile } from "@/lib/bookkeeping/documents"
import { getAdminFirestore, getAdminRtdb } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"

const TOTAL_STEPS = 2

// Next.js-side half of the job-input twin. functions/src/receipt-scan.ts
// re-declares this shape field-for-field (functions/ cannot import lib/).
export interface ReceiptScanJobInput {
  storagePath: string
  mimeType: string
  accounts: { name: string; account_type: "income" | "expense" }[]
  bookName: string
  bookKind: "business" | "household"
  documentId: string
  logId?: string
  requestedBy: string
}

export interface IngestReceiptArgs {
  bookId: string
  buffer: Buffer
  mimeType: string
  originalFilename: string
  /** null for cron ingestion — uploaded_by / requested_by stay NULL in the DB. */
  uploadedBy: string | null
  externalRef?: string | null
  accounts: { name: string; account_type: "income" | "expense" }[]
  bookName: string
  bookKind: "business" | "household"
}

export interface IngestReceiptResult {
  documentId: string
  jobId: string
  logId: string
  sha256: string
}

export async function ingestReceiptDocument(args: IngestReceiptArgs): Promise<IngestReceiptResult> {
  const sha256 = createHash("sha256").update(args.buffer).digest("hex")
  const storageId = randomUUID()
  const storagePath = `bookkeeping/receipts/${args.bookId}/${storageId}/${safeStatementName(args.originalFilename)}`
  await storeStatementFile(storagePath, args.buffer, args.mimeType)

  const retainUntil = `${new Date().getUTCFullYear() + 7}-12-31`

  const doc = await createDocument({
    book_id: args.bookId,
    kind: "receipt",
    original_filename: args.originalFilename,
    storage_path: storagePath,
    mime_type: args.mimeType,
    file_size_bytes: args.buffer.length,
    sha256,
    retain_until: retainUntil,
    uploaded_by: args.uploadedBy,
    row_count: 1,
    external_ref: args.externalRef ?? null,
  })

  const log = await createGenerationLog({
    program_id: null,
    client_id: null,
    ...(args.uploadedBy ? { requested_by: args.uploadedBy } : {}),
    status: "pending",
    input_params: { source: "receipt_scan", document_id: doc.id },
    output_summary: null,
    error_message: null,
    model_used: "sonnet",
    tokens_used: null,
    cache_creation_tokens: null,
    cache_read_tokens: null,
    duration_ms: null,
    completed_at: null,
    current_step: 0,
    total_steps: TOTAL_STEPS,
  })

  const firestoreDb = getAdminFirestore()
  const jobRef = firestoreDb.collection("ai_jobs").doc()

  const jobInput: ReceiptScanJobInput = {
    storagePath,
    mimeType: args.mimeType,
    accounts: args.accounts,
    bookName: args.bookName,
    bookKind: args.bookKind,
    documentId: doc.id,
    logId: log.id,
    requestedBy: args.uploadedBy ?? "bookkeepingGmailReceiptsCron",
  }

  await jobRef.set({
    type: "receipt_scan",
    status: "pending",
    input: jobInput,
    result: null,
    error: null,
    userId: args.uploadedBy ?? "bookkeepingGmailReceiptsCron",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  // Seed RTDB node so the client listener gets immediate data (best-effort)
  try {
    const rtdb = getAdminRtdb()
    await rtdb.ref(`ai_jobs/${jobRef.id}`).set({
      status: "pending",
      progress: { status: "queued", current_step: 0, total_steps: TOTAL_STEPS },
      result: null,
      error: null,
      updatedAt: Date.now(),
    })
  } catch (rtdbErr) {
    console.warn("[receipt-ingest] Failed to seed RTDB node:", rtdbErr)
  }

  return { documentId: doc.id, jobId: jobRef.id, logId: log.id, sha256 }
}
```

- [ ] Run again: `npx vitest run __tests__/lib/bookkeeping/receipt-ingest.test.ts` — expected pass (4 tests).
- [ ] Refactor `app/api/admin/bookkeeping/receipts/upload/route.ts` to delegate. The route keeps: admin self-gate, `FIREBASE_PRIVATE_BUCKET` friendly-500, all form/mime/size/uuid validation (:63-94), the sha256 dup **hint** (`findDocumentBySha256`), the book/accounts lookups + 404, the audit call, and the 202 response shape. It loses the inlined recipe (:107-182) and the local `ReceiptScanJobInput`/`TOTAL_STEPS`. Full replacement body from the buffer line down:

```ts
    const buffer = Buffer.from(await file.arrayBuffer())
    const sha256 = createHash("sha256").update(buffer).digest("hex")
    const dup = await findDocumentBySha256(bookId, sha256)

    const [accountRows, book] = await Promise.all([listAccounts(bookId), getBook(bookId)])
    if (!book) {
      return NextResponse.json({ error: "book not found" }, { status: 404 })
    }
    const accounts = accountRows.map((a) => ({ name: a.name, account_type: a.account_type }))

    const mimeType = resolveImageMime(file)
    const { documentId, jobId, logId } = await ingestReceiptDocument({
      bookId,
      buffer,
      mimeType,
      originalFilename: file.name,
      uploadedBy: session.user.id,
      accounts,
      bookName: book.name,
      bookKind: book.book_kind,
    })

    void recordAudit({
      action: "bookkeeping.receipt_uploaded",
      category: "commerce",
      outcome: "success",
      target: { type: "bookkeeping_document", id: documentId },
      metadata: { book_id: bookId, kind: "receipt" },
      request,
    })

    return NextResponse.json(
      {
        jobId,
        documentId,
        log_id: logId,
        duplicateUploadHint: dup ? dup.created_at : null,
      },
      { status: 202 },
    )
```

  Imports become: drop `randomUUID`, `createDocument`, `storeStatementFile`/`safeStatementName`, `createGenerationLog`, `getAdminFirestore`/`getAdminRtdb`, `FieldValue`; add `import { ingestReceiptDocument } from "@/lib/bookkeeping/receipt-ingest"`; keep `createHash`, `z`, `auth`, `findDocumentBySha256`, `getBook`, `listAccounts`, `recordAudit`.
- [ ] Behavior-diff gate: `npx vitest run __tests__/app/api/admin/bookkeeping/receipts-upload.test.ts` — expected pass, **file untouched** (5 tests: 403 non-admin, non-image 400, bad book_id 400, 202 happy path incl. job payload, plus its remaining case).
- [ ] Commit:

```bash
cat > "/c/Users/tayaw/AppData/Local/Temp/claude/c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete/09812efa-7e7c-44fc-b449-2a6d8f09a5aa/scratchpad/c3-msg.txt" <<'EOF'
refactor(bookkeeping): extract ingestReceiptDocument from the receipt upload route

One implementation of the store→document→log→job→RTDB recipe, now with an
optional externalRef pass-through for the Gmail poller. Upload route
delegates; its existing tests pass unchanged (behavior diff).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
git add lib/bookkeeping/receipt-ingest.ts app/api/admin/bookkeeping/receipts/upload/route.ts __tests__/lib/bookkeeping/receipt-ingest.test.ts
git commit -F "/c/Users/tayaw/AppData/Local/Temp/claude/c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete/09812efa-7e7c-44fc-b449-2a6d8f09a5aa/scratchpad/c3-msg.txt"
```

---

### Task C4: Persist the coalesced scan result to `bookkeeping_documents.scan_result`

**Files:**
- Modify: `functions/src/receipt-scan.ts` (pure helper after `coalesceReceiptResult` :61-72; back-fill update at :158-166)
- Modify: `functions/src/__tests__/receipt-scan.test.ts` (append a describe; update the import line)

**Interfaces:**
- Produces: `documentBackfillPayload(result: ReceiptScanResult): { period_start: string | null; period_end: string | null; row_count: number; scan_result: ReceiptScanResult }` (exported from `functions/src/receipt-scan.ts`).
- Consumes: `ReceiptScanResult` (`functions/src/ai/receipt-schema.ts`), the same `getSupabase()` client already used for the period back-fill at `functions/src/receipt-scan.ts:159-163`. Photo flow unaffected: RTDB/Firestore writes unchanged; the extra jsonb column is invisible to the photo review path.

Steps:

- [ ] Append the failing test to `functions/src/__tests__/receipt-scan.test.ts` and extend its import to `import { resizeReceiptForVision, coalesceReceiptResult, documentBackfillPayload } from "../receipt-scan.js"`:

```ts
describe("documentBackfillPayload", () => {
  it("stamps occurred_on on both period bounds and persists the coalesced scan_result", () => {
    const result = coalesceReceiptResult({
      vendor: "Home Depot", amount_cents: 12555, occurred_on: "2026-07-20", confidence: "high",
    } as never)
    expect(documentBackfillPayload(result)).toEqual({
      period_start: "2026-07-20",
      period_end: "2026-07-20",
      row_count: 1,
      scan_result: result,
    })
    // The stored object is the coalesced shape — every field explicit,
    // never undefined leaves (RTDB discipline carried into the jsonb column).
    expect(documentBackfillPayload(result).scan_result).toMatchObject({
      suggested_category: null, business_purpose_hint: null, currency: null, warnings: [],
    })
  })

  it("null occurred_on (blurry read) → null period bounds, scan_result still stored", () => {
    const result = coalesceReceiptResult(null)
    expect(documentBackfillPayload(result)).toMatchObject({
      period_start: null, period_end: null, row_count: 1, scan_result: result,
    })
  })
})
```

- [ ] Run it: `cd functions && npx vitest run src/__tests__/receipt-scan.test.ts` — expected failure: `documentBackfillPayload` is not exported.
- [ ] Implement in `functions/src/receipt-scan.ts`. Add after `coalesceReceiptResult` (:72):

```ts
/** Update payload for the post-scan bookkeeping_documents back-fill: period
 *  bounds from occurred_on (as before) + the coalesced result persisted to
 *  scan_result (00193) so the email-receipts review surface can rehydrate it
 *  after the RTDB/browser session is gone. */
export function documentBackfillPayload(result: ReceiptScanResult): {
  period_start: string | null
  period_end: string | null
  row_count: number
  scan_result: ReceiptScanResult
} {
  return {
    period_start: result.occurred_on,
    period_end: result.occurred_on,
    row_count: 1,
    scan_result: result,
  }
}
```

  and replace the update at :160-163 (same supabase client, same warn-only error handling):

```ts
    const { error: docError } = await supabase
      .from("bookkeeping_documents")
      .update(documentBackfillPayload(result))
      .eq("id", input.documentId)
```

- [ ] Run again: `cd functions && npx vitest run src/__tests__/receipt-scan.test.ts` — expected pass (4 tests).
- [ ] Verify the functions build compiles: `cd functions && npm run build` — expected clean.
- [ ] Commit:

```bash
cat > "/c/Users/tayaw/AppData/Local/Temp/claude/c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete/09812efa-7e7c-44fc-b449-2a6d8f09a5aa/scratchpad/c4-msg.txt" <<'EOF'
feat(bookkeeping): persist coalesced receipt scan_result on bookkeeping_documents

documentBackfillPayload extends the existing period back-fill (same supabase
client, warn-only) with the scan_result jsonb write. Photo flow's RTDB path
unchanged.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
git add functions/src/receipt-scan.ts functions/src/__tests__/receipt-scan.test.ts
git commit -F "/c/Users/tayaw/AppData/Local/Temp/claude/c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete/09812efa-7e7c-44fc-b449-2a6d8f09a5aa/scratchpad/c4-msg.txt"
```

---

### Task C5: Poller internal route + delegator cron + health registration + audit slug

**Files:**
- Create: `lib/bookkeeping/receipt-attachments.ts` (pure — separate module so route tests can leave it REAL while mocking `lib/gmail/client`)
- Create: `__tests__/lib/bookkeeping/receipt-attachments.test.ts` (zero-mock)
- Modify: `lib/db/bookkeeping.ts` (add `hasDocumentsForExternalRefPrefix` after `linkDocumentBatch` :345-350)
- Create: `app/api/admin/internal/bookkeeping-gmail-receipts/route.ts`
- Create: `__tests__/api/admin/internal/bookkeeping-gmail-receipts.test.ts` (mirrors `__tests__/api/admin/internal/bookkeeping-income-sync.test.ts` — read it first; same `vi.mock` factories + `makeRequest` + `mock.calls` assertion style)
- Modify: `functions/src/index.ts` (append delegator after the `bookkeepingIncomeSyncCron` block at :2009-2024)
- Modify: `lib/automation/automation-health-scanner.ts` (:34, after the `bookkeepingIncomeSyncCron` row)
- Modify: `lib/audit/actions.ts` (:260, after `bookkeeping.income_synced`)

**Interfaces:**
- Produces:
  - `lib/bookkeeping/receipt-attachments.ts`: `MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024`; `interface ReceiptAttachmentRef { filename: string; mimeType: string; attachmentId: string; size: number }`; `isReceiptMime(mime: string): boolean`; `collectReceiptAttachments(payload: GmailMessagePart | undefined): ReceiptAttachmentRef[]`
  - `lib/db/bookkeeping.ts`: `hasDocumentsForExternalRefPrefix(prefix: string): Promise<boolean>` (`count: "exact", head: true` + `.like` — check-then-insert side of the 00193 discipline; never an upsert)
  - Route: `POST` handler + `export const MAX_MESSAGES_PER_RUN = 25`, `runtime = "nodejs"`, `maxDuration = 300`
  - `functions/src/index.ts`: `export const bookkeepingGmailReceiptsCron` (`onSchedule "20 * * * *"`, secrets `[internalCronToken, appUrl]` only — gscSyncCron shape, :1320-1349: all Gmail creds stay Vercel-side)
- Consumes: `isCronSkipped`/`getSetting` (`lib/db/system-settings.ts:13,52`), `logCronStart`/`logCronEnd` (`lib/db/cron-runs.ts`), `createServiceRoleClient` (`lib/supabase.ts`), `listBooks`/`listAccounts` (`lib/db/bookkeeping.ts`), `getAccessTokenForConnection`/`GmailNotConnectedError` (`lib/gmail/client.ts:90-126`), `listLabels`/`listMessages`/`getMessage`/`getAttachment` (C2), `ingestReceiptDocument` (C3), `recordAudit` (`lib/audit/record.ts`). Degraded pattern mirrors `lib/db/inbox-sla.ts:13-32` + `app/api/admin/internal/inbox-sla/route.ts` — a missing integration is a **successful run** with `fetch_status: 'degraded'`, never a cron failure.

Steps:

- [ ] Write the failing zero-mock test `__tests__/lib/bookkeeping/receipt-attachments.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { collectReceiptAttachments, isReceiptMime, MAX_ATTACHMENT_BYTES } from "@/lib/bookkeeping/receipt-attachments"

describe("isReceiptMime", () => {
  it("accepts image/* and application/pdf only", () => {
    expect(isReceiptMime("image/jpeg")).toBe(true)
    expect(isReceiptMime("image/png")).toBe(true)
    expect(isReceiptMime("application/pdf")).toBe(true)
    expect(isReceiptMime("text/calendar")).toBe(false)
    expect(isReceiptMime("application/octet-stream")).toBe(false)
  })
})

describe("collectReceiptAttachments", () => {
  it("walks nested multipart parts, keeps receipt mimes with attachmentIds, skips inline bodies", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { size: 10, data: "aGk" } },
            { mimeType: "text/html", body: { size: 20, data: "aGk" } },
          ],
        },
        { mimeType: "application/pdf", filename: "invoice.pdf", body: { size: 2048, attachmentId: "a1" } },
        { mimeType: "image/png", filename: "", body: { size: 100, attachmentId: "a2" } },
        { mimeType: "text/calendar", filename: "invite.ics", body: { size: 100, attachmentId: "a3" } },
      ],
    }
    expect(collectReceiptAttachments(payload)).toEqual([
      { filename: "invoice.pdf", mimeType: "application/pdf", attachmentId: "a1", size: 2048 },
      { filename: "receipt", mimeType: "image/png", attachmentId: "a2", size: 100 },
    ])
  })

  it("drops oversized (>10MB) and zero-size attachments; undefined payload → []", () => {
    expect(
      collectReceiptAttachments({
        mimeType: "multipart/mixed",
        parts: [
          { mimeType: "application/pdf", filename: "huge.pdf", body: { size: MAX_ATTACHMENT_BYTES + 1, attachmentId: "big" } },
          { mimeType: "image/jpeg", filename: "empty.jpg", body: { size: 0, attachmentId: "zero" } },
        ],
      }),
    ).toEqual([])
    expect(collectReceiptAttachments(undefined)).toEqual([])
  })
})
```

- [ ] Run it: `npx vitest run __tests__/lib/bookkeeping/receipt-attachments.test.ts` — expected failure: module not found.
- [ ] Create `lib/bookkeeping/receipt-attachments.ts`:

```ts
// Pure Gmail-payload → receipt-attachment selection (Track C). Zero IO —
// separate from lib/gmail/client.ts so poller route tests keep this REAL
// while mocking the Gmail client seam.
import type { GmailMessagePart } from "@/lib/gmail/client"

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 // matches the photo upload cap

export interface ReceiptAttachmentRef {
  filename: string
  mimeType: string
  attachmentId: string
  size: number
}

export function isReceiptMime(mime: string): boolean {
  return mime.startsWith("image/") || mime === "application/pdf"
}

/** Depth-first walk of a format=full payload tree. Keeps parts that have a
 *  real attachmentId (inline text/html bodies have data, not attachmentId),
 *  a receipt mime, and 0 < size <= 10MB. Attachment index in the RETURNED
 *  array is the <attachmentIndex> used in external_ref. */
export function collectReceiptAttachments(payload: GmailMessagePart | undefined): ReceiptAttachmentRef[] {
  const out: ReceiptAttachmentRef[] = []
  const walk = (part: GmailMessagePart | undefined) => {
    if (!part) return
    const attachmentId = part.body?.attachmentId
    const size = part.body?.size ?? 0
    const mime = part.mimeType ?? ""
    if (attachmentId && isReceiptMime(mime) && size > 0 && size <= MAX_ATTACHMENT_BYTES) {
      out.push({ filename: part.filename || "receipt", mimeType: mime, attachmentId, size })
    }
    for (const child of part.parts ?? []) walk(child)
  }
  walk(payload)
  return out
}
```

- [ ] Run again: `npx vitest run __tests__/lib/bookkeeping/receipt-attachments.test.ts` — expected pass (3 tests).
- [ ] Add the DAL check to `lib/db/bookkeeping.ts`, directly after `linkDocumentBatch` (:350):

```ts
/** True when any document carries external_ref starting with `prefix`
 *  (poller skip check, e.g. 'gmail:<messageId>:'). Check-then-insert side of
 *  the 00193 discipline — external_ref is NEVER an onConflict target. */
export async function hasDocumentsForExternalRefPrefix(prefix: string): Promise<boolean> {
  const { count, error } = await db()
    .from("bookkeeping_documents")
    .select("id", { count: "exact", head: true })
    .like("external_ref", `${prefix}%`)
  if (error) throw error
  return (count ?? 0) > 0
}
```

- [ ] Write the failing route test `__tests__/api/admin/internal/bookkeeping-gmail-receipts.test.ts` (mirrored from `bookkeeping-income-sync.test.ts` — same file layout, RFC-4122 fixture UUIDs, byte-identical cron-name assertion):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: vi.fn(), getSetting: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: vi.fn(), logCronEnd: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listBooks: vi.fn(), listAccounts: vi.fn(), hasDocumentsForExternalRefPrefix: vi.fn(),
}))
vi.mock("@/lib/gmail/client", () => {
  class GmailNotConnectedError extends Error {
    constructor() { super("Gmail is not connected"); this.name = "GmailNotConnectedError" }
  }
  return {
    GmailNotConnectedError,
    getAccessTokenForConnection: vi.fn(),
    listLabels: vi.fn(),
    listMessages: vi.fn(),
    getMessage: vi.fn(),
    getAttachment: vi.fn(),
  }
})
vi.mock("@/lib/bookkeeping/receipt-ingest", () => ({ ingestReceiptDocument: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { isCronSkipped, getSetting } from "@/lib/db/system-settings"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { listBooks, listAccounts, hasDocumentsForExternalRefPrefix } from "@/lib/db/bookkeeping"
import {
  GmailNotConnectedError, getAccessTokenForConnection, listLabels, listMessages, getMessage, getAttachment,
} from "@/lib/gmail/client"
import { ingestReceiptDocument } from "@/lib/bookkeeping/receipt-ingest"
import { recordAudit } from "@/lib/audit/record"
import { POST, MAX_MESSAGES_PER_RUN } from "@/app/api/admin/internal/bookkeeping-gmail-receipts/route"

const TOKEN = "test-cron-token"
const AUTH = `Bearer ${TOKEN}`
const BOOK = "b0000000-0000-4000-8000-000000000001"

const books = [
  { id: "b0000000-0000-4000-8000-000000000003", name: "Household & Personal", book_kind: "household", is_primary: false, owner_label: "Shared", sort_order: 2, archived_at: null },
  { id: BOOK, name: "Darren — DJP Athlete", book_kind: "business", is_primary: true, owner_label: "Darren", sort_order: 0, archived_at: null },
]

// format=full payload: inline text part (no attachmentId), a real PDF
// attachment, and a calendar invite the mime filter must drop.
// collectReceiptAttachments is REAL in this suite (separate pure module).
const fullMessage = (id: string) => ({
  id,
  threadId: `t-${id}`,
  payload: {
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "text/plain", body: { size: 20, data: "aGk" } },
      { mimeType: "application/pdf", filename: "invoice.pdf", body: { size: 4096, attachmentId: `att-${id}-pdf` } },
      { mimeType: "text/calendar", filename: "invite.ics", body: { size: 512, attachmentId: `att-${id}-ics` } },
    ],
  },
})

function makeRequest(authHeader = AUTH): Request {
  return new Request("http://localhost/api/admin/internal/bookkeeping-gmail-receipts", {
    method: "POST",
    headers: { authorization: authHeader },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = TOKEN
  ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: false })
  ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue("DJP Receipts")
  ;(logCronStart as ReturnType<typeof vi.fn>).mockResolvedValue("run-1")
  ;(logCronEnd as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(listBooks as ReturnType<typeof vi.fn>).mockResolvedValue(books)
  ;(listAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "a0000000-0000-4000-8000-000000000001", book_id: BOOK, name: "Equipment", account_type: "expense" },
  ])
  ;(getAccessTokenForConnection as ReturnType<typeof vi.fn>).mockResolvedValue({ accessToken: "tok", emailAddress: "darren@darrenjpaul.com" })
  ;(listLabels as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "INBOX", name: "INBOX" },
    { id: "L1", name: "DJP Receipts" },
  ])
  ;(listMessages as ReturnType<typeof vi.fn>).mockResolvedValue({ messages: [{ id: "m1", threadId: "t1" }] })
  ;(getMessage as ReturnType<typeof vi.fn>).mockImplementation(async (_tok: string, id: string) => fullMessage(id))
  ;(getAttachment as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("PDFDATA"))
  ;(hasDocumentsForExternalRefPrefix as ReturnType<typeof vi.fn>).mockResolvedValue(false)
  ;(ingestReceiptDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ documentId: "d1", jobId: "j1", logId: "l1", sha256: "x" })
})

describe("POST /api/admin/internal/bookkeeping-gmail-receipts", () => {
  it("401 with a missing bearer token", async () => {
    expect((await POST(makeRequest("") as never)).status).toBe(401)
    expect(isCronSkipped).not.toHaveBeenCalled()
  })

  it("401 with a wrong bearer token", async () => {
    expect((await POST(makeRequest("Bearer wrong") as never)).status).toBe(401)
  })

  it("200 {skipped} with no logCronStart when the flag is off", async () => {
    ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: true, reason: "disabled" })
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect((await res.json()).skipped).toBe("disabled")
    expect(logCronStart).not.toHaveBeenCalled()
  })

  it("Gmail not connected → SUCCESSFUL degraded run, no listing, no cron failure", async () => {
    ;(getAccessTokenForConnection as ReturnType<typeof vi.fn>).mockRejectedValue(new GmailNotConnectedError())
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, fetch_status: "degraded", fetch_detail: "gmail_not_connected" })
    expect(listLabels).not.toHaveBeenCalled()
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ fetch_status: "degraded" }),
    )
  })

  it("configured label missing from the mailbox → degraded success naming the label", async () => {
    ;(listLabels as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "INBOX", name: "INBOX" }])
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true, fetch_status: "degraded", fetch_detail: "label_not_found", label: "DJP Receipts",
    })
    expect(listMessages).not.toHaveBeenCalled()
  })

  it("happy path: label-only listing, PDF ingested as gmail:<id>:0, ics filtered, audit recorded", async () => {
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, fetch_status: "ok", processed: 1, ingested: 1, more_pending: false })
    expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "bookkeepingGmailReceiptsCron")
    expect((listMessages as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ labelIds: ["L1"] })
    expect(getAttachment).toHaveBeenCalledWith("tok", "m1", "att-m1-pdf")
    expect(ingestReceiptDocument).toHaveBeenCalledTimes(1)
    expect((ingestReceiptDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      bookId: BOOK, externalRef: "gmail:m1:0", uploadedBy: null,
      mimeType: "application/pdf", originalFilename: "invoice.pdf",
      bookName: "Darren — DJP Athlete", bookKind: "business",
      accounts: [{ name: "Equipment", account_type: "expense" }],
    })
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.gmail_receipt_ingested", category: "commerce", outcome: "success",
      actor: expect.objectContaining({ role: "system" }),
    }))
  })

  it("follows nextPageToken across listMessages pages", async () => {
    ;(listMessages as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "p2" })
      .mockResolvedValueOnce({ messages: [{ id: "m2", threadId: "t2" }] })
    const res = await POST(makeRequest() as never)
    expect((await res.json()).processed).toBe(2)
    expect((listMessages as ReturnType<typeof vi.fn>).mock.calls[1][1]).toMatchObject({ pageToken: "p2" })
  })

  it("already-ingested message (external_ref prefix hit) → skipped without a full fetch, no audit", async () => {
    ;(hasDocumentsForExternalRefPrefix as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    const res = await POST(makeRequest() as never)
    expect(await res.json()).toMatchObject({ ok: true, skipped: 1, ingested: 0 })
    expect(hasDocumentsForExternalRefPrefix).toHaveBeenCalledWith("gmail:m1:")
    expect(getMessage).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("caps at MAX_MESSAGES_PER_RUN new messages and reports more_pending", async () => {
    const many = Array.from({ length: MAX_MESSAGES_PER_RUN + 1 }, (_, i) => ({ id: `m${i}`, threadId: `t${i}` }))
    ;(listMessages as ReturnType<typeof vi.fn>).mockResolvedValue({ messages: many })
    const res = await POST(makeRequest() as never)
    const json = await res.json()
    expect(json.processed).toBe(MAX_MESSAGES_PER_RUN)
    expect(json.more_pending).toBe(true)
    expect(getMessage).toHaveBeenCalledTimes(MAX_MESSAGES_PER_RUN)
  })

  it("a non-connection Gmail failure (listLabels rejects) → 500 + logCronEnd failed", async () => {
    ;(listLabels as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Gmail listLabels failed: HTTP 500"))
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(500)
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "failed",
      expect.objectContaining({ message: expect.stringContaining("listLabels") }),
    )
  })
})
```

- [ ] Run it: `npx vitest run __tests__/api/admin/internal/bookkeeping-gmail-receipts.test.ts` — expected failure: route module not found.
- [ ] Create `app/api/admin/internal/bookkeeping-gmail-receipts/route.ts`:

```ts
// Called by functions bookkeepingGmailReceiptsCron (hourly :20). Reads the
// coach's Gmail via the SHIPPED /admin/inbox OAuth connection
// (platform_connections row "gmail" — no Firebase secrets), lists messages
// under the configured receipt label, and ingests image/PDF attachments
// through the same recipe as photo upload (ingestReceiptDocument).
//
// STRICTLY READ-ONLY on the mailbox (Decision C-3): never marks read, never
// touches labels — idempotency is entirely external_ref check-then-insert
// ('gmail:<messageId>:<attachmentIndex>', 00193; NEVER an onConflict target).
// Gmail-not-connected / label-missing are SUCCESSFUL degraded runs
// (inbox-SLA precedent, lib/db/inbox-sla.ts) — a missing integration must
// never page. SINGLE cron_runs owner "bookkeepingGmailReceiptsCron".
import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped, getSetting } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { listBooks, listAccounts, hasDocumentsForExternalRefPrefix } from "@/lib/db/bookkeeping"
import {
  getAccessTokenForConnection, listLabels, listMessages, getMessage, getAttachment, GmailNotConnectedError,
} from "@/lib/gmail/client"
import { collectReceiptAttachments } from "@/lib/bookkeeping/receipt-attachments"
import { ingestReceiptDocument } from "@/lib/bookkeeping/receipt-ingest"
import { recordAudit } from "@/lib/audit/record"

export const runtime = "nodejs"
export const maxDuration = 300

/** Cap on NEW (not-yet-ingested) messages fully fetched per run — bounds
 *  Gmail getMessage calls; the remainder is picked up next hour
 *  (more_pending in detail). Backlog labeling Just Works (Decision C-8). */
export const MAX_MESSAGES_PER_RUN = 25
const DEFAULT_LABEL = "DJP Receipts"

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const authHeader = request.headers.get("authorization") ?? ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_bookkeeping_gmail_receipts_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "bookkeepingGmailReceiptsCron")
  try {
    const labelName = await getSetting<string>("bookkeeping_gmail_receipt_label", DEFAULT_LABEL)

    let accessToken: string
    try {
      ;({ accessToken } = await getAccessTokenForConnection())
    } catch (err) {
      if (err instanceof GmailNotConnectedError) {
        const detail = { fetch_status: "degraded", fetch_detail: "gmail_not_connected", label: labelName }
        await logCronEnd(supabase, runId, "success", detail)
        return NextResponse.json({ ok: true, ...detail })
      }
      throw err
    }

    const labels = await listLabels(accessToken)
    const label = labels.find((l) => l.name === labelName)
    if (!label) {
      const detail = { fetch_status: "degraded", fetch_detail: "label_not_found", label: labelName }
      await logCronEnd(supabase, runId, "success", detail)
      return NextResponse.json({ ok: true, ...detail })
    }

    const books = await listBooks()
    const book = books.find((b) => b.is_primary && b.book_kind === "business")
    if (!book) throw new Error("No primary business book found")
    const accountRows = await listAccounts(book.id)
    const accounts = accountRows.map((a) => ({ name: a.name, account_type: a.account_type }))

    // Label-only listing, no date bound (Decision C-8) — the label is the
    // coach's explicit opt-in set; per-message skip keeps re-polls cheap.
    const messageIds: string[] = []
    let pageToken: string | undefined
    do {
      const page = await listMessages(accessToken, { labelIds: [label.id], pageToken })
      for (const m of page.messages ?? []) messageIds.push(m.id)
      pageToken = page.nextPageToken
    } while (pageToken)

    let processed = 0
    let skipped = 0
    let ingested = 0
    let attachmentless = 0
    let more_pending = false

    for (const messageId of messageIds) {
      if (processed >= MAX_MESSAGES_PER_RUN) {
        more_pending = true
        break
      }
      if (await hasDocumentsForExternalRefPrefix(`gmail:${messageId}:`)) {
        skipped++
        continue
      }
      processed++
      const full = await getMessage(accessToken, messageId)
      const attachments = collectReceiptAttachments(full.payload)
      if (attachments.length === 0) {
        // Body-only email — produces nothing, v1 by design (Decision C-7);
        // cheaply re-listed each poll.
        attachmentless++
        continue
      }
      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i]
        const buffer = await getAttachment(accessToken, messageId, att.attachmentId)
        await ingestReceiptDocument({
          bookId: book.id,
          buffer,
          mimeType: att.mimeType,
          originalFilename: att.filename,
          uploadedBy: null,
          externalRef: `gmail:${messageId}:${i}`,
          accounts,
          bookName: book.name,
          bookKind: book.book_kind,
        })
        ingested++
      }
    }

    const detail = {
      fetch_status: "ok", label: labelName,
      listed: messageIds.length, processed, skipped, attachmentless, ingested, more_pending,
    }
    if (ingested > 0) {
      void recordAudit({
        action: "bookkeeping.gmail_receipt_ingested",
        category: "commerce",
        outcome: "success",
        actor: { id: null, email: "bookkeepingGmailReceiptsCron", role: "system" },
        target: { type: "bookkeeping_book", id: book.id },
        metadata: detail,
      })
    }
    await logCronEnd(supabase, runId, "success", detail)
    return NextResponse.json({ ok: true, ...detail })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[bookkeeping-gmail-receipts] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] Run again: `npx vitest run __tests__/api/admin/internal/bookkeeping-gmail-receipts.test.ts` — expected pass (10 tests).
- [ ] Register the audit slug in `lib/audit/actions.ts` — insert after the `bookkeeping.income_synced` row (:260):

```ts
  { slug: "bookkeeping.gmail_receipt_ingested", category: "commerce", description: "Hourly Gmail poller ingested labeled receipt attachments" },
```

- [ ] Register in the health watchdog — `lib/automation/automation-health-scanner.ts`, insert after the `bookkeepingIncomeSyncCron` row (:34):

```ts
  { name: "bookkeepingGmailReceiptsCron", sla_hours: 6 }, // hourly :20 — delay-tolerant, a Gmail blip must not page (C-2)
```

  Then confirm the scanner suite still passes (its cases are generic over the list): `npx vitest run __tests__/lib/automation/automation-health-scanner.test.ts` — expected pass.
- [ ] Append the delegator to `functions/src/index.ts` directly after the `bookkeepingIncomeSyncCron` block (:2009-2024), same thin-POST shape as `gscSyncCron` (:1320-1349) — secrets `[internalCronToken, appUrl]` ONLY (all Gmail creds stay Vercel-side in `platform_connections`; `GMAIL_*` is deliberately absent from the functions `defineSecret` list):

```ts
// ─── Bookkeeping Gmail Receipt Poller (hourly :20) ───────────────────────────
// Thin delegator (gscSyncCron shape): the route owns the cron_runs row + the
// cron_bookkeeping_gmail_receipts_enabled gate (default OFF) and degrades to
// a successful no-op while Gmail is unconnected. Zero new Firebase secrets —
// the Gmail refresh token lives in platform_connections, read Vercel-side.
export const bookkeepingGmailReceiptsCron = onSchedule(
  {
    schedule: "20 * * * *",
    timeZone: "Etc/UTC",
    timeoutSeconds: 330,
    memory: "256MiB",
    region: "us-central1",
    secrets: [internalCronToken, appUrl],
  },
  async () => {
    const baseUrl = process.env.APP_URL
    const token = process.env.INTERNAL_CRON_TOKEN
    if (!baseUrl || !token) {
      console.error("[bookkeepingGmailReceiptsCron] APP_URL or INTERNAL_CRON_TOKEN missing — abort")
      return
    }
    try {
      const res = await fetch(`${baseUrl}/api/admin/internal/bookkeeping-gmail-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error("[bookkeepingGmailReceiptsCron]", res.status, body)
        return
      }
      console.log("[bookkeepingGmailReceiptsCron]", res.status, body)
    } catch (err) {
      console.error("[bookkeepingGmailReceiptsCron] failed:", err)
    }
  },
)
```

- [ ] Verify the functions build compiles: `cd functions && npm run build` — expected clean.
- [ ] Commit:

```bash
cat > "/c/Users/tayaw/AppData/Local/Temp/claude/c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete/09812efa-7e7c-44fc-b449-2a6d8f09a5aa/scratchpad/c5-msg.txt" <<'EOF'
feat(bookkeeping): hourly Gmail receipt poller route + delegator + health registration

Read-only label poller: Bearer triple-clause, flag gate (default OFF), single
cron_runs owner, degraded success on not-connected/label-missing, external_ref
check-then-insert idempotency, 25-new-message cap, image/PDF <=10MB ->
ingestReceiptDocument. Delegator "20 * * * *" with [internalCronToken, appUrl]
only; EXPECTED_CRONS sla 6h; audit slug bookkeeping.gmail_receipt_ingested.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
git add lib/bookkeeping/receipt-attachments.ts __tests__/lib/bookkeeping/receipt-attachments.test.ts lib/db/bookkeeping.ts app/api/admin/internal/bookkeeping-gmail-receipts/route.ts __tests__/api/admin/internal/bookkeeping-gmail-receipts.test.ts functions/src/index.ts lib/automation/automation-health-scanner.ts lib/audit/actions.ts
git commit -F "/c/Users/tayaw/AppData/Local/Temp/claude/c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete/09812efa-7e7c-44fc-b449-2a6d8f09a5aa/scratchpad/c5-msg.txt"
```

---

### Task C6: Email-receipts review surface — DAL + GET route + `/admin/books/email-receipts` page

**Files:**
- Modify: `lib/db/bookkeeping.ts` (add `listPendingEmailReceiptDocuments` after `listDocuments` :341-344)
- Create: `lib/bookkeeping/email-receipts.ts` (pure row adapter)
- Create: `__tests__/lib/bookkeeping/email-receipts.test.ts` (zero-mock)
- Create: `app/api/admin/bookkeeping/email-receipts/route.ts`
- Create: `__tests__/api/admin/bookkeeping/email-receipts.test.ts` (mirrors `__tests__/api/admin/bookkeeping/documents.test.ts` — read it first; same `const fnMock = vi.fn()` + factory-arrow mock style)
- Create: `app/(admin)/admin/books/email-receipts/page.tsx` (server component, mirrors `app/(admin)/admin/books/insights/page.tsx`)
- Create: `components/admin/bookkeeping/EmailReceiptsClient.tsx`
- Modify: `components/admin/bookkeeping/BooksClient.tsx` (header link row :239-267; add `Mail` to its existing `lucide-react` import)

**Interfaces:**
- Produces:
  - `listPendingEmailReceiptDocuments(): Promise<BookkeepingDocument[]>` — `kind='receipt' AND external_ref LIKE 'gmail:%' AND (posted_count IS NULL OR posted_count = 0)`, `fetchAllRows`-paginated. The IS-NULL arm is load-bearing: `posted_count` has no default and is only ever written by `linkDocumentBatch` (`lib/db/bookkeeping.ts:345-350`) after a commit — a bare `= 0` filter would match nothing, permanently emptying the page.
  - `rowFromEmailDocument(doc: BookkeepingDocument, accounts: BookkeepingAccount[]): ReceiptBatchRow` (from `lib/bookkeeping/email-receipts.ts`)
  - `GET` handler returning `{ documents: BookkeepingDocument[] }` (scan_result rides along — it's a column, `select("*")`)
  - `EmailReceiptsClient({ documents, accounts, gmailConnected, label })`
- Consumes: `newReceiptRow`/`applyScanResult`/`parseAmountCents`/`rowValidationError`/`ReceiptBatchRow` (`lib/bookkeeping/receipt-batch.ts:101,124,95`), `receiptSourceRef` (`lib/bookkeeping/receipts.ts:15-17`), `ReceiptRowEditor` + its props (`components/admin/bookkeeping/ReceiptRowEditor.tsx:18-26`), the **existing** commit route `app/api/admin/bookkeeping/receipts/commit/route.ts` (close guard + business-purpose gates ride along free; `source_ref receipt:<documentId>` convention unchanged), `getPlatformConnection` (`lib/db/platform-connections.ts:16`), `getSetting` (`lib/db/system-settings.ts:13`), `fetchAllRows` (`lib/db/paginate.ts`).

Steps:

- [ ] Write the failing zero-mock adapter test `__tests__/lib/bookkeeping/email-receipts.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { rowFromEmailDocument } from "@/lib/bookkeeping/email-receipts"
import type { BookkeepingAccount, BookkeepingDocument } from "@/types/database"

const ACCOUNTS = [
  { id: "a0000000-0000-4000-8000-000000000001", book_id: "b0000000-0000-4000-8000-000000000001", name: "Equipment", account_type: "expense" } as BookkeepingAccount,
]
const DOC = {
  id: "d0000000-0000-4000-8000-000000000002",
  book_id: "b0000000-0000-4000-8000-000000000001",
  kind: "receipt",
  original_filename: "invoice.pdf",
  external_ref: "gmail:m1:0",
  posted_count: null,
  scan_result: {
    vendor: "Home Depot", amount_cents: 12555, occurred_on: "2026-07-20",
    suggested_category: "Equipment", business_purpose_hint: "Rack parts",
    currency: "USD", confidence: "high", warnings: [],
  },
} as unknown as BookkeepingDocument

describe("rowFromEmailDocument", () => {
  it("folds scan_result into editable fields exactly like the photo flow (12.555 discriminator)", () => {
    const row = rowFromEmailDocument(DOC, ACCOUNTS)
    expect(row).toMatchObject({
      clientId: DOC.id,
      documentId: DOC.id,
      status: "scanned",
      included: true,
      counterparty: "Home Depot",
      amount: "125.55",
      occurredOn: "2026-07-20",
      accountId: "a0000000-0000-4000-8000-000000000001",
      businessPurpose: "Rack parts",
    })
    expect(row.result?.confidence).toBe("high")
  })

  it("no scan_result yet (vision job pending/failed) → editable blank row defaulting to today", () => {
    const row = rowFromEmailDocument({ ...DOC, scan_result: null } as BookkeepingDocument, ACCOUNTS)
    expect(row).toMatchObject({ status: "scanned", included: true, amount: "", counterparty: "", accountId: "" })
    expect(row.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
```

- [ ] Run it: `npx vitest run __tests__/lib/bookkeeping/email-receipts.test.ts` — expected failure: module not found.
- [ ] Create `lib/bookkeeping/email-receipts.ts`:

```ts
// Pure adapter: polled Gmail receipt document → editable ReceiptBatchRow.
// scan_result present → the SAME fold-in the photo flow uses (applyScanResult
// over the RTDB-shaped result); absent (vision job still running or failed)
// → an editable blank row so the coach can post manually.
import { applyScanResult, newReceiptRow, type ReceiptBatchRow } from "@/lib/bookkeeping/receipt-batch"
import type { BookkeepingAccount, BookkeepingDocument } from "@/types/database"

export function rowFromEmailDocument(
  doc: BookkeepingDocument,
  accounts: BookkeepingAccount[],
): ReceiptBatchRow {
  const base: ReceiptBatchRow = {
    ...newReceiptRow(doc.id, doc.original_filename ?? "Email receipt", null),
    documentId: doc.id,
    status: "scanned",
    included: true,
  }
  if (!doc.scan_result) return base
  return { ...applyScanResult(base, doc.scan_result, accounts), included: true }
}
```

- [ ] Run again: `npx vitest run __tests__/lib/bookkeeping/email-receipts.test.ts` — expected pass (2 tests).
- [ ] Add the DAL read to `lib/db/bookkeeping.ts` after `listDocuments` (:344):

```ts
/** Pending email receipts for /admin/books/email-receipts: polled Gmail docs
 *  not yet posted. posted_count is NULL until linkDocumentBatch runs after a
 *  commit — the IS NULL arm is required (a bare = 0 would match nothing). */
export async function listPendingEmailReceiptDocuments(): Promise<BookkeepingDocument[]> {
  return fetchAllRows<BookkeepingDocument>((f, t) =>
    db().from("bookkeeping_documents").select("*")
      .eq("kind", "receipt")
      .like("external_ref", "gmail:%")
      .or("posted_count.is.null,posted_count.eq.0")
      .order("created_at", { ascending: false })
      .range(f, t) as never)
}
```

- [ ] Write the failing route test `__tests__/api/admin/bookkeeping/email-receipts.test.ts` (mirrored from `documents.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const listPendingMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listPendingEmailReceiptDocuments: (...a: unknown[]) => listPendingMock(...a),
}))

import { GET } from "@/app/api/admin/bookkeeping/email-receipts/route"

const DOC = {
  id: "d0000000-0000-4000-8000-000000000002",
  book_id: "b0000000-0000-4000-8000-000000000001",
  kind: "receipt",
  external_ref: "gmail:m1:0",
  posted_count: null,
  scan_result: {
    vendor: "Home Depot", amount_cents: 12555, occurred_on: "2026-07-20",
    suggested_category: "Equipment", business_purpose_hint: null,
    currency: "USD", confidence: "high", warnings: [],
  },
}

beforeEach(() => {
  authMock.mockReset()
  listPendingMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
})

describe("GET /api/admin/bookkeeping/email-receipts", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await GET()).status).toBe(403)
    expect(listPendingMock).not.toHaveBeenCalled()
  })

  it("returns pending gmail receipt documents with their scan_result", async () => {
    listPendingMock.mockResolvedValue([DOC])
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).documents).toEqual([DOC])
  })

  it("500s when the DAL throws", async () => {
    listPendingMock.mockRejectedValue(new Error("boom"))
    expect((await GET()).status).toBe(500)
  })
})
```

- [ ] Run it: `npx vitest run __tests__/api/admin/bookkeeping/email-receipts.test.ts` — expected failure: route module not found.
- [ ] Create `app/api/admin/bookkeeping/email-receipts/route.ts`:

```ts
// Pending Gmail-polled receipts for the /admin/books/email-receipts surface.
// Read-only list; posting goes through the EXISTING receipts/commit route
// (source_ref receipt:<documentId>, close guard + business-purpose gates).
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listPendingEmailReceiptDocuments } from "@/lib/db/bookkeeping"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const documents = await listPendingEmailReceiptDocuments()
    return NextResponse.json({ documents })
  } catch (error) {
    console.error("[email-receipts] list failed:", error)
    return NextResponse.json({ error: "Failed to load email receipts" }, { status: 500 })
  }
}
```

- [ ] Run again: `npx vitest run __tests__/api/admin/bookkeeping/email-receipts.test.ts` — expected pass (3 tests).
- [ ] Create the page `app/(admin)/admin/books/email-receipts/page.tsx` (server component, `insights/page.tsx` shape — DAL direct on the server, client component for interaction):

```tsx
import { EmailReceiptsClient } from "@/components/admin/bookkeeping/EmailReceiptsClient"
import { listAccounts, listBooks, listPendingEmailReceiptDocuments } from "@/lib/db/bookkeeping"
import { getPlatformConnection } from "@/lib/db/platform-connections"
import { getSetting } from "@/lib/db/system-settings"

export const metadata = { title: "Email Receipts — Accounting — Admin" }

export default async function EmailReceiptsPage() {
  const [books, documents, conn, label] = await Promise.all([
    listBooks(),
    listPendingEmailReceiptDocuments(),
    getPlatformConnection("gmail"),
    getSetting<string>("bookkeeping_gmail_receipt_label", "DJP Receipts"),
  ])
  // The poller always ingests into the primary business book.
  const book = books.find((b) => b.is_primary && b.book_kind === "business") ?? null
  const accounts = book ? await listAccounts(book.id) : []
  return (
    <EmailReceiptsClient
      documents={documents}
      accounts={accounts}
      gmailConnected={conn?.status === "connected"}
      label={label}
    />
  )
}
```

- [ ] Create `components/admin/bookkeeping/EmailReceiptsClient.tsx`:

```tsx
"use client"

// Durable review surface for Gmail-polled receipts (Decision C-5). The photo
// flow's review state is browser-memory tied to the uploading session, so
// cron output needs this durable list — but the row editor and the commit
// route ARE the existing flow's (deviation from "existing review flow" is
// documented in the Track C design §3.4).
import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Inbox, Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ReceiptRowEditor } from "@/components/admin/bookkeeping/ReceiptRowEditor"
import { rowFromEmailDocument } from "@/lib/bookkeeping/email-receipts"
import { parseAmountCents, rowValidationError, type ReceiptBatchRow } from "@/lib/bookkeeping/receipt-batch"
import { receiptSourceRef } from "@/lib/bookkeeping/receipts"
import type { BookkeepingAccount, BookkeepingDocument } from "@/types/database"

interface EmailReceiptsClientProps {
  documents: BookkeepingDocument[]
  accounts: BookkeepingAccount[]
  gmailConnected: boolean
  label: string
}

export function EmailReceiptsClient({ documents, accounts, gmailConnected, label }: EmailReceiptsClientProps) {
  const [rows, setRows] = useState<ReceiptBatchRow[]>(() =>
    documents.map((d) => rowFromEmailDocument(d, accounts)),
  )
  const docById = new Map(documents.map((d) => [d.id, d]))

  const patchRow = (clientId: string, patch: Partial<ReceiptBatchRow>) =>
    setRows((prev) => prev.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)))

  const postRow = async (row: ReceiptBatchRow) => {
    const doc = docById.get(row.clientId)
    if (!doc) return
    const invalid = rowValidationError(row, accounts)
    if (invalid) {
      toast.error(invalid)
      return
    }
    patchRow(row.clientId, { status: "posting", error: null })
    try {
      const res = await fetch("/api/admin/bookkeeping/receipts/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: doc.book_id,
          document_id: doc.id,
          account_id: row.accountId || null,
          amount_cents: parseAmountCents(row.amount),
          occurred_on: row.occurredOn,
          counterparty: row.counterparty || null,
          business_purpose: row.businessPurpose || null,
          memo: null,
          source_ref: receiptSourceRef(doc.id),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "Failed to post receipt")
      setRows((prev) => prev.filter((r) => r.clientId !== row.clientId))
      toast.success(json.inserted === 0 ? "Already posted — removed from the queue" : "Receipt posted")
    } catch (error) {
      patchRow(row.clientId, { status: "post_failed", error: (error as Error).message })
      toast.error((error as Error).message)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading text-primary">Email Receipts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Receipts pulled hourly from Gmail messages labeled &lsquo;{label}&rsquo;. Review each one and post it to the
          ledger.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Inbox className="size-6 mx-auto text-muted-foreground" />
            {!gmailConnected ? (
              <p className="text-sm text-muted-foreground">
                Connect Gmail in{" "}
                <Link href="/admin/inbox" className="underline text-primary">
                  Admin → Inbox
                </Link>
                , then apply the &lsquo;{label}&rsquo; label to receipt emails.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                No email receipts pending. Label a receipt email with an attached PDF or image &lsquo;{label}&rsquo; and
                it appears within the hour. Body-only emails (no attachment) aren&apos;t imported — forward them to
                yourself with the receipt attached, or use photo upload.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        rows.map((row) => (
          <Card key={row.clientId}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base font-heading">{row.fileName}</CardTitle>
              <Button size="sm" disabled={row.status === "posting"} onClick={() => postRow(row)}>
                {row.status === "posting" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Post
              </Button>
            </CardHeader>
            <CardContent>
              {row.error && <p className="text-xs text-error mb-2">{row.error}</p>}
              <ReceiptRowEditor
                row={row}
                accounts={accounts}
                disabled={row.status === "posting"}
                onEdit={(patch) => patchRow(row.clientId, patch)}
                onPreviewLoaded={(url) => patchRow(row.clientId, { previewUrl: url })}
              />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
```

  Component behavior notes (verify by reading, no RTL suite — the logic lives in the tested pure adapter + tested commit route):
  - `ReceiptRowEditor` fetches its own signed preview via `row.documentId` (`ReceiptRowEditor.tsx:31-53`) — `rowFromEmailDocument` sets `documentId`, so previews work with `previewUrl` cached by `onPreviewLoaded`.
  - Posting reuses `receipts/commit` verbatim: `PERIOD_CLOSED` → 409 message surfaces in the toast; `business_purpose required` → 422 surfaces; `inserted: 0` (already posted, source_ref idempotency) removes the row honestly.
  - Empty-state copy is the design §3.4 text VERBATIM (connect-Gmail hint when unconnected; body-only-emails honesty copy when connected but empty).
- [ ] Link it from `components/admin/bookkeeping/BooksClient.tsx`: add `Mail` to the existing `lucide-react` import, and insert as the FIRST link in the header link row (before the Reports `<Link>` at :239), same classes as its siblings:

```tsx
            <Link
              href="/admin/books/email-receipts"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-accent hover:text-accent"
            >
              <Mail className="size-4" />
              Email Receipts
            </Link>
```

- [ ] Run the task's full adjacent set: `npx vitest run __tests__/lib/bookkeeping/email-receipts.test.ts __tests__/api/admin/bookkeeping/email-receipts.test.ts __tests__/api/admin/bookkeeping/documents.test.ts __tests__/hooks/use-receipt-batch.test.tsx` — expected all pass (documents + use-receipt-batch prove the shared modules didn't regress).
- [ ] Commit:

```bash
cat > "/c/Users/tayaw/AppData/Local/Temp/claude/c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete/09812efa-7e7c-44fc-b449-2a6d8f09a5aa/scratchpad/c6-msg.txt" <<'EOF'
feat(bookkeeping): /admin/books/email-receipts review surface for polled receipts

Pending list = kind receipt + external_ref gmail:% + (posted_count IS NULL OR
0); rowFromEmailDocument rehydrates scan_result into the existing
ReceiptRowEditor; per-row post through the existing receipts/commit route.
Spec-verbatim empty states (connect-Gmail hint / body-only honesty copy);
linked from BooksClient.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
git add lib/db/bookkeeping.ts lib/bookkeeping/email-receipts.ts __tests__/lib/bookkeeping/email-receipts.test.ts app/api/admin/bookkeeping/email-receipts/route.ts __tests__/api/admin/bookkeeping/email-receipts.test.ts "app/(admin)/admin/books/email-receipts/page.tsx" components/admin/bookkeeping/EmailReceiptsClient.tsx components/admin/bookkeeping/BooksClient.tsx
git commit -F "/c/Users/tayaw/AppData/Local/Temp/claude/c--Users-tayaw-Desktop-Darren-Paul-Projects-djpathlete/09812efa-7e7c-44fc-b449-2a6d8f09a5aa/scratchpad/c6-msg.txt"
```

**Track C notes for the orchestrator (not task steps):** full-suite + `npm run build` (own command, never `&&`-chained behind tests) run between tracks per §6; functions were touched in C4 + C5 so the functions build/suite gate applies; live-proof after C lands = sentinel document row with `external_ref 'gmail:sentinel:0'` → poller-skip check via `hasDocumentsForExternalRefPrefix` + row visible in the email-receipts pending list → delete. Ships doubly dark: `cron_bookkeeping_gmail_receipts_enabled` OFF and Gmail possibly unconnected (degraded success path covers the second independently). Owner actions (§7): connect Gmail in `/admin/inbox`, apply the "DJP Receipts" label, flip the flag; body-only receipt emails don't import — attach or photo-upload.