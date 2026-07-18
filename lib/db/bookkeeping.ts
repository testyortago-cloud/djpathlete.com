import { createServiceRoleClient } from "@/lib/supabase"
import { fetchAllRows } from "@/lib/db/paginate"
import { deleteStatementFile } from "@/lib/bookkeeping/documents"
import type {
  BookkeepingBook, BookkeepingAccount, BookkeepingLedgerEntry,
  LedgerDirection, LedgerSource, BookkeepingDocument, NewDocument,
  BookkeepingPeriodClose,
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

// ── Ledger entries ───────────────────────────────────────────────────────
export interface ListEntriesParams {
  bookId: string; from?: string; to?: string; direction?: LedgerDirection
  accountId?: string; source?: LedgerSource; search?: string; page: number; perPage: number
}

function applyEntryFilters<Q extends { eq: (c: string, v: unknown) => Q; gte: (c: string, v: unknown) => Q; lte: (c: string, v: unknown) => Q; or: (s: string) => Q }>(
  q: Q, p: ListEntriesParams,
): Q {
  let out = q.eq("book_id", p.bookId)
  if (p.from) out = out.gte("occurred_on", p.from)
  if (p.to) out = out.lte("occurred_on", p.to)
  if (p.direction) out = out.eq("direction", p.direction)
  if (p.accountId) out = out.eq("account_id", p.accountId)
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
): Promise<{ inserted: number; rejected_closed: number; rejected_closed_rows: RejectedClosedRow[] }> {
  if (drafts.length === 0) return { inserted: 0, rejected_closed: 0, rejected_closed_rows: [] }
  // Partition BEFORE the upsert (D-4): closed-period rows must never ride the
  // silent duplicate-skip, or the dialogs' "already imported" arithmetic lies.
  const closed = new Set(await listClosedPeriods(bookId))
  const { open, rejected_closed, rejected_closed_rows } = partitionByClosedPeriods(drafts, closed)
  if (open.length === 0) return { inserted: 0, rejected_closed, rejected_closed_rows }
  const rows = open.map((d) => ({
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
  return { inserted: (data ?? []).length, rejected_closed, rejected_closed_rows }
}

// ── Platform income reads (each paginated; missing table → [] + noop) ──────
async function safeAll<T>(builder: (from: number, to: number) => unknown): Promise<T[]> {
  try {
    return await fetchAllRows<T>(builder as never)
  } catch (err) {
    console.warn("[bookkeeping] platform-income source read failed (skipped):", (err as Error).message)
    return []
  }
}

export async function listPlatformIncome(from: string, to: string): Promise<IncomeSourceRows> {
  const fromTs = `${from}T00:00:00Z`
  const toTs = `${to}T23:59:59Z`
  const [payments, shopOrders, clientPackages, eventSignups, memberships] = await Promise.all([
    safeAll<IncomeSourceRows["payments"][number]>((f, t) =>
      db().from("payments").select("*").gte("created_at", fromTs).lte("created_at", toTs).range(f, t)),
    safeAll<IncomeSourceRows["shopOrders"][number]>((f, t) =>
      db().from("shop_orders").select("*").gte("created_at", fromTs).lte("created_at", toTs).range(f, t)),
    safeAll<IncomeSourceRows["clientPackages"][number]>((f, t) =>
      db().from("client_packages").select("*, session_pack_products(name)").gte("purchased_at", fromTs).lte("purchased_at", toTs).range(f, t)),
    safeAll<IncomeSourceRows["eventSignups"][number]>((f, t) =>
      db().from("event_signups").select("*, events(title,type)").gte("created_at", fromTs).lte("created_at", toTs).range(f, t)),
    safeAll<IncomeSourceRows["memberships"][number]>((f, t) =>
      db().from("client_memberships").select("*, membership_plans(name,price_cents,billing_interval)")
        .lte("created_at", toTs).or(`canceled_at.is.null,canceled_at.gte.${fromTs}`).range(f, t)),
  ])
  // Flatten embedded names so the pure adapter stays schema-light.
  return {
    payments,
    shopOrders,
    clientPackages: clientPackages.map((r) => ({ ...r, product_name: (r as { session_pack_products?: { name?: string } }).session_pack_products?.name ?? null })),
    eventSignups: eventSignups.map((r) => ({ ...r, event_title: (r as { events?: { title?: string } }).events?.title ?? null, event_type: (r as { events?: { type?: string } }).events?.type ?? null })),
    memberships: memberships.map((r) => {
      const pl = (r as { membership_plans?: { name?: string; price_cents?: number; billing_interval?: string } }).membership_plans
      return { ...r, plan_name: pl?.name ?? null, plan_price_cents: pl?.price_cents ?? null, plan_interval: pl?.billing_interval ?? null }
    }),
  }
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
export async function linkDocumentBatch(id: string, bookId: string, importBatchId: string, postedCount: number): Promise<void> {
  const { error } = await db().from("bookkeeping_documents")
    .update({ import_batch_id: importBatchId, posted_count: postedCount, updated_at: new Date().toISOString() })
    .eq("id", id).eq("book_id", bookId)
  if (error) throw error
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
