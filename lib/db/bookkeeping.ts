import { createServiceRoleClient } from "@/lib/supabase"
import { fetchAllRows } from "@/lib/db/paginate"
import { deleteStatementFile } from "@/lib/bookkeeping/documents"
import { collectEnrichmentIds, stampIncomeEnrichment, type EnrichmentUser } from "@/lib/bookkeeping/income-enrich"
import type {
  BookkeepingBook, BookkeepingAccount, BookkeepingLedgerEntry,
  LedgerDirection, LedgerSource, BookkeepingDocument, NewDocument,
  BookkeepingPeriodClose, BookkeepingAsset, NewBookkeepingAsset,
  BookkeepingPayout, NewBookkeepingPayout, NewBookkeepingPayoutLine, BookkeepingPayoutStatus,
} from "@/types/database"
import type { IncomeSourceRows, LedgerEntryDraft } from "@/lib/bookkeeping/types"
import type { ReportEntry, ReportAccount } from "@/lib/bookkeeping/reports"
import type { InsightEntry, InsightAccount } from "@/lib/bookkeeping/insight-types"
import {
  PeriodClosedError,
  assertPeriodOpen,
  partitionByClosedPeriods,
  type RejectedClosedRow,
} from "@/lib/bookkeeping/period-close"

function db() {
  return createServiceRoleClient()
}

// ── Books ────────────────────────────────────────────────────────────────
export async function listBooks(): Promise<BookkeepingBook[]> {
  const { data, error } = await db()
    .from("bookkeeping_books").select("*").is("archived_at", null)
    .order("sort_order", { ascending: true })
  if (error) throw error
  return (data ?? []) as BookkeepingBook[]
}

export async function getBook(id: string): Promise<BookkeepingBook | null> {
  const { data, error } = await db().from("bookkeeping_books").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as BookkeepingBook) ?? null
}

// ── Accounts ─────────────────────────────────────────────────────────────
export async function listAccounts(bookId: string): Promise<BookkeepingAccount[]> {
  const { data, error } = await db()
    .from("bookkeeping_accounts").select("*").eq("book_id", bookId).is("archived_at", null)
    .order("sort_order", { ascending: true })
  if (error) throw error
  return (data ?? []) as BookkeepingAccount[]
}

export async function createAccount(input: {
  book_id: string; name: string; account_type: "income" | "expense"
  service_line?: string | null; is_deductible_candidate?: boolean; tax_category?: string | null
}): Promise<BookkeepingAccount> {
  const { data, error } = await db().from("bookkeeping_accounts").insert(input).select().single()
  if (error) throw error
  return data as BookkeepingAccount
}

export async function updateAccount(
  id: string,
  updates: Partial<{ name: string; service_line: string | null; is_deductible_candidate: boolean; tax_category: string | null; archived_at: string | null }>,
): Promise<BookkeepingAccount> {
  const { data, error } = await db().from("bookkeeping_accounts").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as BookkeepingAccount
}

// ── Finding dismissals (5b) ──────────────────────────────────────────────
// Identity fingerprints ("<finder>:<key>", lib/bookkeeping/finding-fingerprint.ts).
// Dismissals gate DISPLAY only — the insight recompute (D4) never reads them.
export async function listDismissedFingerprints(bookId: string): Promise<string[]> {
  const rows = await fetchAllRows<{ fingerprint: string }>(
    (from, to) =>
      db().from("bookkeeping_finding_dismissals").select("fingerprint")
        .eq("book_id", bookId).order("dismissed_at", { ascending: true })
        // unique tiebreaker: dismissed_at ties across a .range() page boundary
        // would otherwise duplicate or skip rows.
        .order("id", { ascending: true })
        .range(from, to) as never,
  )
  return rows.map((r) => r.fingerprint)
}

export async function insertDismissal(input: { book_id: string; fingerprint: string; dismissed_by: string | null }): Promise<void> {
  // Idempotent: re-dismissing is a no-op. onConflict targets the PLAIN unique
  // constraint (book_id, fingerprint) from 00192 — never an expression index.
  const { error } = await db().from("bookkeeping_finding_dismissals")
    .upsert(input, { onConflict: "book_id,fingerprint", ignoreDuplicates: true })
  if (error) throw error
}

export async function deleteDismissal(bookId: string, fingerprint: string): Promise<void> {
  const { error } = await db().from("bookkeeping_finding_dismissals")
    .delete().eq("book_id", bookId).eq("fingerprint", fingerprint)
  if (error) throw error
}

// ── Ledger entries ───────────────────────────────────────────────────────
export interface ListEntriesParams {
  bookId: string; from?: string; to?: string; direction?: LedgerDirection
  /** A uuid, OR the literal `"none"` sentinel meaning "uncategorized" (account_id IS NULL).
   *  Only `applyEntryFilters` understands `"none"` — never pass it to an FK lookup
   *  (e.g. `assertAccountInBook`), Postgres would reject it as an invalid uuid (22P02). */
  accountId?: string | "none"
  source?: LedgerSource; search?: string; page: number; perPage: number
}

/** Exported for the builder-recorder test (bookkeeping-entries-filters.test.ts). */
export function applyEntryFilters<Q extends { eq: (c: string, v: unknown) => Q; gte: (c: string, v: unknown) => Q; lte: (c: string, v: unknown) => Q; or: (s: string) => Q; is: (c: string, v: unknown) => Q }>(
  q: Q, p: ListEntriesParams,
): Q {
  let out = q.eq("book_id", p.bookId)
  if (p.from) out = out.gte("occurred_on", p.from)
  if (p.to) out = out.lte("occurred_on", p.to)
  if (p.direction) out = out.eq("direction", p.direction)
  // "none" sentinel (design B-3): uncategorized entries have account_id NULL,
  // which eq() can never match — deep-links from the insights page need it.
  if (p.accountId === "none") out = out.is("account_id", null)
  else if (p.accountId) out = out.eq("account_id", p.accountId)
  if (p.source) out = out.eq("source", p.source)
  if (p.search) {
    const esc = p.search.replace(/[%_]/g, (m) => `\\${m}`).replace(/[,().]/g, " ")
    out = out.or(`memo.ilike.%${esc}%,counterparty.ilike.%${esc}%`)
  }
  return out
}

export async function listEntries(p: ListEntriesParams): Promise<{ rows: BookkeepingLedgerEntry[]; total: number }> {
  // select("*") is wildcard, not an explicit column list — document_id (added by
  // migration 00186) already comes through, which is what LedgerTable's 📎
  // receipt-indicator button (Phase 3, Task 17) relies on.
  const base = db().from("bookkeeping_ledger_entries").select("*", { count: "exact" })
  const q = applyEntryFilters(base as any, p) // eslint-disable-line @typescript-eslint/no-explicit-any -- Supabase builder generics fight applyEntryFilters<Q>; `never` collapses the chained return, `any` keeps it chainable
    .order("occurred_on", { ascending: false })
    .range((p.page - 1) * p.perPage, p.page * p.perPage - 1)
  const { data, error, count } = await (q as never as Promise<{ data: unknown; error: unknown; count: number | null }>)
  if (error) throw error
  return { rows: (data ?? []) as BookkeepingLedgerEntry[], total: count ?? 0 }
}

export async function entryTotals(p: Omit<ListEntriesParams, "page" | "perPage">): Promise<{ income_cents: number; expense_cents: number }> {
  const rows = await fetchAllRows<{ direction: LedgerDirection; amount_cents: number }>(
    (from, to) => {
      const base = db().from("bookkeeping_ledger_entries").select("direction,amount_cents")
      return applyEntryFilters(base as any, { ...p, page: 1, perPage: 1 }) // eslint-disable-line @typescript-eslint/no-explicit-any -- see listEntries above
        .range(from, to) as never
    },
  )
  let income = 0, expense = 0
  for (const r of rows) {
    if (r.direction === "income") income += r.amount_cents
    else expense += r.amount_cents
  }
  return { income_cents: income, expense_cents: expense }
}

export async function createEntry(input: Omit<BookkeepingLedgerEntry, "id" | "created_at" | "updated_at">): Promise<BookkeepingLedgerEntry> {
  const closed = new Set(await listClosedPeriods(input.book_id))
  assertPeriodOpen(closed, input.book_id, input.occurred_on)
  const { data, error } = await db().from("bookkeeping_ledger_entries").insert(input).select().single()
  if (error) throw error
  return data as BookkeepingLedgerEntry
}

export async function updateEntry(id: string, updates: Partial<Omit<BookkeepingLedgerEntry, "id" | "created_at">>): Promise<BookkeepingLedgerEntry> {
  // UNCONDITIONAL old-row fetch (spec §3.3 row 2): the route only fetches when
  // account_id is in the payload, so an occurred_on-only edit would otherwise
  // bypass the guard. Book comes from the row — book_id can't change by route.
  const existing = await getEntry(id)
  if (existing) {
    const closed = new Set(await listClosedPeriods(existing.book_id))
    assertPeriodOpen(closed, existing.book_id, existing.occurred_on)
    if (updates.occurred_on) assertPeriodOpen(closed, existing.book_id, updates.occurred_on)
  }
  const { data, error } = await db().from("bookkeeping_ledger_entries").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as BookkeepingLedgerEntry
}

export async function deleteEntry(id: string): Promise<void> {
  // Fetch-first (today it never fetches): a closed-period row must not vanish.
  // A missing row keeps today's silent no-op delete behavior.
  const existing = await getEntry(id)
  if (existing) {
    const closed = new Set(await listClosedPeriods(existing.book_id))
    assertPeriodOpen(closed, existing.book_id, existing.occurred_on)
  }
  const { error } = await db().from("bookkeeping_ledger_entries").delete().eq("id", id)
  if (error) throw error
}

export async function insertImportedEntries(
  bookId: string, importBatchId: string, drafts: Array<LedgerEntryDraft & { account_id?: string | null }>,
): Promise<{ inserted: number; rejected_closed: number; rejected_closed_rows: RejectedClosedRow[]; skipped_alt_ref: number }> {
  if (drafts.length === 0) return { inserted: 0, rejected_closed: 0, rejected_closed_rows: [], skipped_alt_ref: 0 }
  // Partition BEFORE the upsert (D-4): closed-period rows must never ride the
  // silent duplicate-skip, or the dialogs' "already imported" arithmetic lies.
  const closed = new Set(await listClosedPeriods(bookId))
  const { open, rejected_closed, rejected_closed_rows } = partitionByClosedPeriods(drafts, closed)
  if (open.length === 0) return { inserted: 0, rejected_closed, rejected_closed_rows, skipped_alt_ref: 0 }

  // Cross-run dedupe (F1): a draft's alt_ref names the OTHER source_ref form
  // this exact sale could have posted under (mirror payments ref for a
  // source-table draft, or the deleted source-table ref for an orphan-mirror
  // draft). If that alt form was already posted, this draft is the SAME sale
  // seen through a different pairing outcome (e.g. the source row existed on
  // the first import and got deleted before a re-import) — drop it, or the
  // plain (book_id,source,source_ref) uniqueness constraint won't catch the
  // duplicate since the two refs differ.
  const altRefs = open.map((d) => d.alt_ref).filter((r): r is string => typeof r === "string" && r.length > 0)
  let skippedAlt = 0
  let insertable = open
  if (altRefs.length > 0) {
    const existing = new Set<string>()
    for (let i = 0; i < altRefs.length; i += 200) {
      const { data, error } = await db().from("bookkeeping_ledger_entries")
        .select("source_ref").eq("book_id", bookId).eq("source", "platform_import").in("source_ref", altRefs.slice(i, i + 200))
      if (error) throw error
      for (const r of (data ?? []) as Array<{ source_ref: string | null }>) if (r.source_ref) existing.add(r.source_ref)
    }
    insertable = open.filter((d) => !(d.alt_ref && existing.has(d.alt_ref)))
    skippedAlt = open.length - insertable.length
  }

  const rows = insertable.map((d) => ({
    book_id: bookId, account_id: d.account_id ?? null, direction: d.direction,
    amount_cents: d.amount_cents, occurred_on: d.occurred_on, memo: d.memo,
    counterparty: d.counterparty, source: d.source, source_ref: d.source_ref,
    import_batch_id: importBatchId,
  }))
  const { data, error } = await db()
    .from("bookkeeping_ledger_entries")
    .upsert(rows, { onConflict: "book_id,source,source_ref", ignoreDuplicates: true })
    .select("id")
  if (error) throw error
  return { inserted: (data ?? []).length, rejected_closed, rejected_closed_rows, skipped_alt_ref: skippedAlt }
}

/** Latest occurred_on among the book's posted platform-import entries —
 *  the income-sync cron's watermark (spec D2). Null when none exist. */
export async function latestPlatformImportDate(bookId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("bookkeeping_ledger_entries")
    .select("occurred_on")
    .eq("book_id", bookId)
    .eq("source", "platform_import")
    .order("occurred_on", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as { occurred_on: string } | null)?.occurred_on ?? null
}

// ── Platform income reads (each paginated; missing table → [] + noop, unless
//    strict — see listPlatformIncome's opts.strict) ────────────────────────
async function safeAll<T>(builder: (from: number, to: number) => unknown, strict = false): Promise<T[]> {
  try {
    return await fetchAllRows<T>(builder as never)
  } catch (err) {
    if (strict) throw err
    console.warn("[bookkeeping] platform-income source read failed (skipped):", (err as Error).message)
    return []
  }
}

async function lookupUsers(ids: string[]): Promise<Map<string, EnrichmentUser>> {
  const map = new Map<string, EnrichmentUser>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    try {
      const { data, error } = await db().from("users").select("id, first_name, last_name, email").in("id", chunk)
      if (error) throw error
      for (const u of (data ?? []) as Array<{ id: string } & EnrichmentUser>) map.set(u.id, u)
    } catch (err) {
      console.warn("[bookkeeping] user lookup failed (names omitted):", (err as Error).message)
    }
  }
  return map
}

async function lookupProgramNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    try {
      const { data, error } = await db().from("programs").select("id, name").in("id", chunk)
      if (error) throw error
      for (const p of (data ?? []) as Array<{ id: string; name: string }>) map.set(p.id, p.name)
    } catch (err) {
      console.warn("[bookkeeping] program lookup failed (names omitted):", (err as Error).message)
    }
  }
  return map
}

export async function listPlatformIncome(
  from: string,
  to: string,
  opts?: { strict?: boolean },
): Promise<IncomeSourceRows> {
  const fromTs = `${from}T00:00:00Z`
  const toTs = `${to}T23:59:59Z`
  const strict = opts?.strict ?? false
  const [payments, shopOrders, clientPackages, eventSignups, memberships] = await Promise.all([
    safeAll<IncomeSourceRows["payments"][number]>((f, t) =>
      db().from("payments").select("*").gte("created_at", fromTs).lte("created_at", toTs).range(f, t), strict),
    safeAll<IncomeSourceRows["shopOrders"][number]>((f, t) =>
      db().from("shop_orders").select("*").gte("created_at", fromTs).lte("created_at", toTs).range(f, t), strict),
    // .or() widens the window to also catch offline packs (Venmo/cash) whose
    // pending→paid flip happens well after purchased_at — set_updated_at bumps
    // updated_at on that flip (DB trigger), so a late paid-flip is still caught
    // once updated_at falls in-window, even though purchased_at is stale.
    safeAll<IncomeSourceRows["clientPackages"][number]>((f, t) =>
      db().from("client_packages").select("*, session_pack_products(name)")
        .lte("purchased_at", toTs).or(`purchased_at.gte.${fromTs},updated_at.gte.${fromTs}`).range(f, t), strict),
    safeAll<IncomeSourceRows["eventSignups"][number]>((f, t) =>
      db().from("event_signups").select("*, events(title,type)").gte("created_at", fromTs).lte("created_at", toTs).range(f, t), strict),
    safeAll<IncomeSourceRows["memberships"][number]>((f, t) =>
      db().from("client_memberships").select("*, membership_plans(name,price_cents,billing_interval)")
        .lte("created_at", toTs).or(`canceled_at.is.null,canceled_at.gte.${fromTs}`).range(f, t), strict),
  ])
  // Flatten embedded names so the pure adapter stays schema-light.
  const base: IncomeSourceRows = {
    payments,
    shopOrders,
    clientPackages: clientPackages.map((r) => ({ ...r, product_name: (r as { session_pack_products?: { name?: string } }).session_pack_products?.name ?? null })),
    eventSignups: eventSignups.map((r) => ({ ...r, event_title: (r as { events?: { title?: string } }).events?.title ?? null, event_type: (r as { events?: { type?: string } }).events?.type ?? null })),
    memberships: memberships.map((r) => {
      const pl = (r as { membership_plans?: { name?: string; price_cents?: number; billing_interval?: string } }).membership_plans
      return { ...r, plan_name: pl?.name ?? null, plan_price_cents: pl?.price_cents ?? null, plan_interval: pl?.billing_interval ?? null }
    }),
  }
  const { userIds, programIds } = collectEnrichmentIds(base)
  const [usersById, programNamesById] = await Promise.all([lookupUsers(userIds), lookupProgramNames(programIds)])
  return stampIncomeEnrichment(base, usersById, programNamesById)
}

// ── Documents + Phase-2 helpers ────────────────────────────────────────────
export async function getEntry(id: string): Promise<BookkeepingLedgerEntry | null> {
  const { data, error } = await db().from("bookkeeping_ledger_entries").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as BookkeepingLedgerEntry) ?? null
}

export interface AccountScopeError extends Error { code: "ACCOUNT_NOT_FOUND" | "WRONG_BOOK" | "WRONG_TYPE" }
export async function assertAccountInBook(accountId: string, bookId: string, direction: LedgerDirection): Promise<void> {
  const { data, error } = await db().from("bookkeeping_accounts").select("book_id,account_type").eq("id", accountId).maybeSingle()
  if (error) throw error
  const mk = (code: AccountScopeError["code"], msg: string) => Object.assign(new Error(msg), { code }) as AccountScopeError
  if (!data) throw mk("ACCOUNT_NOT_FOUND", "account not found")
  if ((data as { book_id: string }).book_id !== bookId) throw mk("WRONG_BOOK", "account belongs to a different book")
  if ((data as { account_type: string }).account_type !== direction) throw mk("WRONG_TYPE", "account type does not match entry direction")
}

export interface PostedRefRow { id: string; occurred_on: string; amount_cents: number; direction: LedgerDirection; memo: string | null; source: LedgerSource }
export async function listPostedForDedupe(bookId: string, from: string, to: string): Promise<PostedRefRow[]> {
  return fetchAllRows<PostedRefRow>((f, t) =>
    db().from("bookkeeping_ledger_entries")
      .select("id,occurred_on,amount_cents,direction,memo,source")
      .eq("book_id", bookId).gte("occurred_on", from).lte("occurred_on", to)
      .in("source", ["platform_import", "manual", "statement_import"])
      .range(f, t) as never)
}

export async function createDocument(input: NewDocument): Promise<BookkeepingDocument> {
  const { data, error } = await db().from("bookkeeping_documents").insert(input).select().single()
  if (error) throw error
  return data as BookkeepingDocument
}
export async function getDocument(id: string): Promise<BookkeepingDocument | null> {
  const { data, error } = await db().from("bookkeeping_documents").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as BookkeepingDocument) ?? null
}
export async function findDocumentBySha256(bookId: string, sha256: string): Promise<BookkeepingDocument | null> {
  const { data, error } = await db().from("bookkeeping_documents").select("*").eq("book_id", bookId).eq("sha256", sha256)
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return (data as BookkeepingDocument) ?? null
}
export async function listDocuments(bookId: string): Promise<BookkeepingDocument[]> {
  return fetchAllRows<BookkeepingDocument>((f, t) =>
    db().from("bookkeeping_documents").select("*").eq("book_id", bookId).order("created_at", { ascending: false }).range(f, t) as never)
}
/** Pending email receipts for /admin/books/email-receipts: polled Gmail docs
 *  not yet posted. posted_count has no default and is written ONLY by
 *  linkDocumentBatch after a commit, so IS NULL is exactly "never committed".
 *
 *  DESIGN AMENDMENT (design §3.4 says `posted_count IS NULL OR posted_count =
 *  0`): the `= 0` arm is dropped. For these documents 0 has no true-positive
 *  meaning — unlike a statement (where a commit can legitimately post zero
 *  rows), a receipt commit writes 0 only when insertReceiptEntry deduped on
 *  (book_id, source, source_ref), i.e. the ledger entry ALREADY exists. Keeping
 *  the arm pinned such a document in the queue permanently: the UI drops the
 *  row client-side on the "already posted" response, but every page load
 *  brought it back and no further action could ever clear it (re-posting always
 *  re-writes 0). Reachable whenever a commit half-completes — e.g.
 *  insertReceiptEntry succeeds but updateDocumentRetainUntil throws → 500 with
 *  posted_count still NULL → the coach's retry dedupes to 0. */
export async function listPendingEmailReceiptDocuments(): Promise<BookkeepingDocument[]> {
  return fetchAllRows<BookkeepingDocument>((f, t) =>
    db().from("bookkeeping_documents").select("*")
      .eq("kind", "receipt")
      .like("external_ref", "gmail:%")
      .is("posted_count", null)
      .order("created_at", { ascending: false })
      .range(f, t) as never)
}
export async function linkDocumentBatch(id: string, bookId: string, importBatchId: string, postedCount: number): Promise<void> {
  const { error } = await db().from("bookkeeping_documents")
    .update({ import_batch_id: importBatchId, posted_count: postedCount, updated_at: new Date().toISOString() })
    .eq("id", id).eq("book_id", bookId)
  if (error) throw error
}
/** Every external_ref under `prefix` (e.g. 'gmail:<messageId>:') — the
 *  PER-ATTACHMENT side of the 00193 check-then-insert discipline. The poller
 *  needs the exact refs, not a boolean: a message whose attachment 0 ingested
 *  and whose attachment 1 threw must retry ONLY index 1 next run, and a
 *  message-level "any row exists" answer would strand it forever.
 *  NOTE: `prefix` is passed to PostgREST `.like` as a PATTERN — callers must
 *  not pass user-controlled strings containing % or _ (Gmail message ids are
 *  hex, so the poller is safe). */
export async function listExternalRefsWithPrefix(prefix: string): Promise<string[]> {
  const rows = await fetchAllRows<{ external_ref: string | null }>((f, t) =>
    db().from("bookkeeping_documents").select("external_ref").like("external_ref", `${prefix}%`).range(f, t) as never)
  return rows.map((r) => r.external_ref).filter((r): r is string => typeof r === "string")
}
/** True when any document carries external_ref starting with `prefix`
 *  (e.g. 'gmail:<messageId>:'). Check-then-insert side of the 00193
 *  discipline — external_ref is NEVER an onConflict target. Same PATTERN
 *  caveat as listExternalRefsWithPrefix.
 *  The poller itself uses listExternalRefsWithPrefix (it needs the indices);
 *  this boolean is the cheap probe for the Track-C live-proof / ad-hoc checks. */
export async function hasDocumentsForExternalRefPrefix(prefix: string): Promise<boolean> {
  const { count, error } = await db()
    .from("bookkeeping_documents")
    .select("id", { count: "exact", head: true })
    .like("external_ref", `${prefix}%`)
  if (error) throw error
  return (count ?? 0) > 0
}
export async function deleteDocument(id: string): Promise<void> {
  const { error } = await db().from("bookkeeping_documents").delete().eq("id", id)
  if (error) throw error
}

// ── Receipts + Phase-3 helpers ──────────────────────────────────────────────
export async function getAccount(id: string): Promise<BookkeepingAccount | null> {
  const { data, error } = await db().from("bookkeeping_accounts").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as BookkeepingAccount) ?? null
}

export async function insertReceiptEntry(input: {
  book_id: string; account_id: string | null; amount_cents: number; occurred_on: string
  counterparty: string | null; business_purpose: string | null; memo: string | null
  source_ref: string; document_id: string | null; import_batch_id: string | null
}): Promise<{ inserted: number; id: string | null }> {
  const closed = new Set(await listClosedPeriods(input.book_id))
  assertPeriodOpen(closed, input.book_id, input.occurred_on)
  const row = {
    book_id: input.book_id, account_id: input.account_id, direction: "expense" as const,
    amount_cents: input.amount_cents, occurred_on: input.occurred_on, memo: input.memo,
    business_purpose: input.business_purpose, counterparty: input.counterparty,
    source: "receipt" as const, source_ref: input.source_ref,
    import_batch_id: input.import_batch_id, document_id: input.document_id,
  }
  const { data, error } = await db()
    .from("bookkeeping_ledger_entries")
    .upsert([row], { onConflict: "book_id,source,source_ref", ignoreDuplicates: true })
    .select("id")
  if (error) throw error
  return { inserted: (data ?? []).length, id: (data?.[0] as { id: string } | undefined)?.id ?? null }
}

export async function insertAmazonEntries(
  bookId: string, importBatchId: string,
  drafts: Array<{ direction: LedgerDirection; amount_cents: number; occurred_on: string; memo: string | null; counterparty: string | null; business_purpose?: string | null; source_ref: string; account_id?: string | null }>,
): Promise<{ inserted: number; rejected_closed: number; rejected_closed_rows: RejectedClosedRow[] }> {
  if (drafts.length === 0) return { inserted: 0, rejected_closed: 0, rejected_closed_rows: [] }
  const closed = new Set(await listClosedPeriods(bookId))
  const { open, rejected_closed, rejected_closed_rows } = partitionByClosedPeriods(drafts, closed)
  if (open.length === 0) return { inserted: 0, rejected_closed, rejected_closed_rows }
  const rows = open.map((d) => ({
    book_id: bookId, account_id: d.account_id ?? null, direction: d.direction,
    amount_cents: d.amount_cents, occurred_on: d.occurred_on, memo: d.memo,
    counterparty: d.counterparty, business_purpose: d.business_purpose ?? null,
    source: "receipt" as const, source_ref: d.source_ref, import_batch_id: importBatchId,
  }))
  const { data, error } = await db()
    .from("bookkeeping_ledger_entries")
    .upsert(rows, { onConflict: "book_id,source,source_ref", ignoreDuplicates: true })
    .select("id")
  if (error) throw error
  return { inserted: (data ?? []).length, rejected_closed, rejected_closed_rows }
}

export async function updateDocumentRetainUntil(id: string, retainUntil: string): Promise<void> {
  const { error } = await db()
    .from("bookkeeping_documents")
    .update({ retain_until: retainUntil, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

export async function assertAccountsInBook(
  bookId: string, items: Array<{ accountId: string | null; direction: LedgerDirection }>,
): Promise<void> {
  const pairs = new Set<string>()
  for (const it of items) if (it.accountId) pairs.add(`${it.accountId}|${it.direction}`)
  for (const p of pairs) {
    const [accountId, direction] = p.split("|")
    await assertAccountInBook(accountId, bookId, direction as LedgerDirection)
  }
}

// ── Retention pruning (Phase 3, Task 15) ────────────────────────────────────
// Pure date-string compare: works off `retain_until date` (YYYY-MM-DD) columns,
// so no timezone conversion — a doc is expired once retain_until is strictly
// before today, not on the day it expires.
export function isDocumentExpired(retainUntil: string, today: string): boolean {
  return retainUntil < today
}

// Twin of functions/src/lib/bookkeeping-retention.ts:pruneExpiredDocuments — kept in
// sync deliberately because functions/ has rootDir: "src" and can't import from lib/.
// Deletes the bucket object first (best-effort — errors are swallowed + warned, since
// a missing/already-gone object shouldn't block the row prune), then the row.
// bookkeeping_ledger_entries.document_id is ON DELETE SET NULL (migration 00186), so a
// linked ledger entry survives with its document_id nulled out.
export async function pruneExpiredDocuments(today: string): Promise<{ deleted: number; ids: string[] }> {
  const rows = await fetchAllRows<{ id: string; storage_path: string }>((f, t) =>
    db().from("bookkeeping_documents").select("id, storage_path").lt("retain_until", today).range(f, t) as never)
  const ids: string[] = []
  for (const r of rows) {
    try {
      await deleteStatementFile(r.storage_path)
    } catch (err) {
      console.warn(`[bookkeeping] retention: object delete failed for ${r.storage_path}:`, (err as Error).message)
    }
    await deleteDocument(r.id)
    ids.push(r.id)
  }
  return { deleted: ids.length, ids }
}

// ── Track A (6e): Stripe payout mirror (read model — NEVER the ledger) ─────
// Merge-mode upserts (no ignoreDuplicates): a re-pulled payout whose status
// flipped (in_transit→paid, paid→failed) must overwrite the stored row (A-6).
export async function upsertPayouts(rows: NewBookkeepingPayout[]): Promise<BookkeepingPayout[]> {
  if (rows.length === 0) return []
  const now = new Date().toISOString()
  const { data, error } = await db()
    .from("bookkeeping_payouts")
    .upsert(rows.map((r) => ({ ...r, updated_at: now })), { onConflict: "stripe_payout_id" })
    .select()
  if (error) throw error
  return (data ?? []) as BookkeepingPayout[]
}

export async function upsertPayoutLines(rows: NewBookkeepingPayoutLine[]): Promise<number> {
  if (rows.length === 0) return 0
  const now = new Date().toISOString()
  const { data, error } = await db()
    .from("bookkeeping_payout_lines")
    .upsert(rows.map((r) => ({ ...r, updated_at: now })), { onConflict: "stripe_balance_txn_id" })
    .select("id")
  if (error) throw error
  return (data ?? []).length
}

/** Latest arrival_date among the book's stored payouts — the payout-sync
 *  cron's watermark (mirrors latestPlatformImportDate). Null when none. */
export async function latestPayoutArrivalDate(bookId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("bookkeeping_payouts")
    .select("arrival_date")
    .eq("book_id", bookId)
    .order("arrival_date", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as { arrival_date: string } | null)?.arrival_date ?? null
}

export interface PayoutLineWindowRow {
  txn_date: string; fee_cents: number; net_cents: number; amount_cents: number; type: string
  payout_id: string
  /** Joined from the parent payout — false when the payout's lines do not
   *  explain its net (manual payouts ingest with no lines at all). */
  fees_reconciled: boolean
}
interface PayoutLineJoinRow extends Omit<PayoutLineWindowRow, "fees_reconciled"> {
  bookkeeping_payouts?: { book_id: string; fees_reconciled: boolean } | null
}
/** Windowed payout lines for the net-revenue report layer. fetchAllRows —
 *  growth table (blanket rule: no bare .select() over growth tables).
 *  BOOK-SCOPED through the payout join: bookkeeping_payout_lines carries no
 *  book_id of its own, and the reports route attributes this sum wholly to the
 *  primary business book — an unscoped read would hand a second book's Stripe
 *  fees to the coach. !inner, so a line whose payout belongs elsewhere is
 *  dropped by the database rather than filtered (or not) in JS. */
export async function listPayoutLinesForWindow(bookId: string, from: string, to: string): Promise<PayoutLineWindowRow[]> {
  const rows = await fetchAllRows<PayoutLineJoinRow>((f, t) =>
    db().from("bookkeeping_payout_lines")
      .select("txn_date,fee_cents,net_cents,amount_cents,type,payout_id,bookkeeping_payouts!inner(book_id,fees_reconciled)")
      .eq("bookkeeping_payouts.book_id", bookId)
      .gte("txn_date", from).lte("txn_date", to)
      .order("txn_date", { ascending: true }).order("id", { ascending: true })
      .range(f, t) as never)
  // Flatten the embed away — the pure fee layer must never see PostgREST shape.
  // A missing embed reads as UNreconciled: "we could not confirm" is the honest
  // default, and it surfaces as a visible caveat rather than a silent clean net.
  return rows.map(({ bookkeeping_payouts, ...line }) => ({
    ...line, fees_reconciled: bookkeeping_payouts?.fees_reconciled === true,
  }))
}

export interface PayoutWindowRefRow { id: string; fees_reconciled: boolean }
/** Payouts that ARRIVED in the window, with their reconciliation state. The
 *  report layer unions these with the line-derived set: a MANUAL payout produces
 *  no balance-transaction lines at all, so a line-only count would report "no
 *  payouts ingested" for a window made entirely of them. Book-scoped, paginated. */
export async function listPayoutRefsForWindow(bookId: string, from: string, to: string): Promise<PayoutWindowRefRow[]> {
  return fetchAllRows<PayoutWindowRefRow>((f, t) =>
    db().from("bookkeeping_payouts")
      .select("id,fees_reconciled")
      .eq("book_id", bookId).gte("arrival_date", from).lte("arrival_date", to)
      .order("arrival_date", { ascending: true }).order("id", { ascending: true })
      .range(f, t) as never)
}

export interface PayoutDedupeRow {
  id: string; stripe_payout_id: string; net_cents: number; arrival_date: string; status: BookkeepingPayoutStatus
}
/** Payouts for the statement-dedupe exact layer. PostgREST column alias maps
 *  amount_cents (payout NET) → net_cents to match PayoutRef. Paginated. */
export async function listPayoutsForDedupe(bookId: string, from: string, to: string): Promise<PayoutDedupeRow[]> {
  return fetchAllRows<PayoutDedupeRow>((f, t) =>
    db().from("bookkeeping_payouts")
      .select("id,stripe_payout_id,net_cents:amount_cents,arrival_date,status")
      .eq("book_id", bookId).gte("arrival_date", from).lte("arrival_date", to)
      .order("arrival_date", { ascending: true }).order("id", { ascending: true })
      .range(f, t) as never)
}

/** Stored payouts whose status can still change — the sync route re-pulls
 *  these by id every run (eligibility arm; income-sync watermark lesson). */
export async function listNonTerminalPayouts(bookId: string): Promise<BookkeepingPayout[]> {
  return fetchAllRows<BookkeepingPayout>((f, t) =>
    db().from("bookkeeping_payouts").select("*")
      .eq("book_id", bookId).in("status", ["pending", "in_transit"])
      .order("arrival_date", { ascending: true }).order("id", { ascending: true })
      .range(f, t) as never)
}

// ── Phase 6a: closed-period write guard (D-2 choke point) ───────────────────
// The spec's "exported from the DAL" surface — the class itself lives in the
// pure module so period-close.ts stays zero-IO.
export { PeriodClosedError }

/** All closed YYYY-MM periods for one book. One indexed select (the plain
 *  UNIQUE (book_id, period) doubles as the index). Empty ledger → [] → every
 *  guard below no-ops. */
export async function listClosedPeriods(bookId: string): Promise<string[]> {
  const { data, error } = await db().from("bookkeeping_period_closes").select("period").eq("book_id", bookId)
  if (error) throw error
  return (data ?? []).map((r) => (r as { period: string }).period)
}

// ── Reports (Phase 4) ────────────────────────────────────────────────────
/** Slim windowed ledger read for reports. fetchAllRows-paginated (a year can
 *  exceed the ~1000-row PostgREST cap); deterministic order for stable pages. */
export async function listEntriesForReports(from: string, to: string, bookId?: string): Promise<ReportEntry[]> {
  return fetchAllRows<ReportEntry>((f, t) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db()
      .from("bookkeeping_ledger_entries")
      .select("book_id,account_id,direction,amount_cents,occurred_on,counterparty,memo,source")
      .gte("occurred_on", from)
      .lte("occurred_on", to)
    if (bookId) q = q.eq("book_id", bookId)
    return q.order("occurred_on", { ascending: true }).order("id", { ascending: true }).range(f, t) as never
  })
}

/** ALL accounts across books, INCLUDING archived — report grouping must keep
 *  archived accounts joinable or their historical entries re-bucket as
 *  Uncategorized (a wrong report). Small coach-managed table (~25 rows). */
export async function listAccountsForReports(): Promise<ReportAccount[]> {
  const { data, error } = await db()
    .from("bookkeeping_accounts")
    .select("id,book_id,name,account_type,service_line,tax_category,sort_order")
    .order("book_id", { ascending: true })
    .order("sort_order", { ascending: true })
  if (error) throw error
  return (data ?? []) as ReportAccount[]
}

/** Every document across books for the pack's Document Index (paginated — grows). */
export async function listAllDocuments(): Promise<BookkeepingDocument[]> {
  return fetchAllRows<BookkeepingDocument>((f, t) =>
    db()
      .from("bookkeeping_documents")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(f, t) as never
  )
}

// ---- Phase-5 insight readers (mirror the ForReports discipline exactly) ----

/**
 * Windowed ledger entries widened for the insight finders (entry id, business_purpose,
 * document_id on top of the report columns). Paginated: a year of ledger can exceed the
 * ~1000-row PostgREST cap. Deterministic order for stable pages.
 */
export async function listEntriesForInsights(from: string, to: string): Promise<InsightEntry[]> {
  return fetchAllRows<InsightEntry>((f, t) =>
    db()
      .from("bookkeeping_ledger_entries")
      .select("id,book_id,account_id,direction,amount_cents,occurred_on,counterparty,memo,source,business_purpose,document_id")
      .gte("occurred_on", from)
      .lte("occurred_on", to)
      .order("occurred_on", { ascending: true })
      .order("id", { ascending: true })
      .range(f, t) as never
  )
}

// ── Phase 6a: close CRUD ────────────────────────────────────────────────────
export async function listCloses(bookId?: string): Promise<BookkeepingPeriodClose[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see listEntries: Supabase builder generics fight conditional chaining
  let q: any = db().from("bookkeeping_period_closes").select("*")
  if (bookId) q = q.eq("book_id", bookId)
  const { data, error } = await q.order("period", { ascending: false })
  if (error) throw error
  return (data ?? []) as BookkeepingPeriodClose[]
}

export async function getClose(bookId: string, period: string): Promise<BookkeepingPeriodClose | null> {
  const { data, error } = await db()
    .from("bookkeeping_period_closes").select("*").eq("book_id", bookId).eq("period", period).maybeSingle()
  if (error) throw error
  return (data as BookkeepingPeriodClose) ?? null
}

export async function getCloseById(id: string): Promise<BookkeepingPeriodClose | null> {
  const { data, error } = await db().from("bookkeeping_period_closes").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as BookkeepingPeriodClose) ?? null
}

export async function insertClose(input: {
  book_id: string; period: string; closed_by: string | null
  income_cents: number; expense_cents: number; net_cents: number; entry_count: number
}): Promise<BookkeepingPeriodClose> {
  const { data, error } = await db().from("bookkeeping_period_closes").insert(input).select().single()
  if (error) throw error
  return data as BookkeepingPeriodClose
}

export async function deleteClose(id: string): Promise<void> {
  const { error } = await db().from("bookkeeping_period_closes").delete().eq("id", id)
  if (error) throw error
}

export async function stampCloseEmailSent(id: string): Promise<void> {
  const { error } = await db()
    .from("bookkeeping_period_closes")
    .update({ email_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

/**
 * All accounts across all books INCLUDING archived (same re-bucketing hazard as
 * listAccountsForReports: filtering archived would re-bucket historical money).
 */
export async function listAccountsForInsights(): Promise<InsightAccount[]> {
  const { data, error } = await db()
    .from("bookkeeping_accounts")
    .select("id,book_id,name,account_type,service_line,tax_category,sort_order,is_deductible_candidate,requires_business_purpose,archived_at")
    .order("book_id", { ascending: true })
    .order("sort_order", { ascending: true })
  if (error) throw error
  return (data ?? []) as InsightAccount[]
}

// ── Assets (Phase 6d — depreciation is REPORT-LAYER only, never a ledger row: D-12) ──
/** Small coach-managed register (like accounts) — unpaginated read is safe; the
 *  optional bookId scopes the /admin/books/assets page, absent = all books (pack). */
export async function listAssets(bookId?: string): Promise<BookkeepingAsset[]> {
  const base = db().from("bookkeeping_assets").select("*")
  const filtered = bookId ? base.eq("book_id", bookId) : base
  const { data, error } = await filtered
    .order("in_service_on", { ascending: true })
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data ?? []) as BookkeepingAsset[]
}

export async function getAsset(id: string): Promise<BookkeepingAsset | null> {
  const { data, error } = await db().from("bookkeeping_assets").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as BookkeepingAsset) ?? null
}

export async function createAsset(input: NewBookkeepingAsset): Promise<BookkeepingAsset> {
  const { data, error } = await db().from("bookkeeping_assets").insert(input).select().single()
  if (error) throw error
  return data as BookkeepingAsset
}

export async function updateAsset(
  id: string,
  updates: Partial<Omit<BookkeepingAsset, "id" | "book_id" | "created_at">>,
): Promise<BookkeepingAsset> {
  const { data, error } = await db()
    .from("bookkeeping_assets")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as BookkeepingAsset
}

export async function deleteAsset(id: string): Promise<void> {
  const { error } = await db().from("bookkeeping_assets").delete().eq("id", id)
  if (error) throw error
}
