import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createServiceRoleClient } from "@/lib/supabase"

describe("00193_bookkeeping_gmail_receipts.sql", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/00193_bookkeeping_gmail_receipts.sql"),
    "utf8",
  )

  it("adds external_ref as a plain UNIQUE text column + scan_result jsonb", () => {
    expect(sql).toMatch(
      /alter table bookkeeping_documents add column if not exists external_ref text unique/i,
    )
    expect(sql).toMatch(
      /alter table bookkeeping_documents add column if not exists scan_result jsonb/i,
    )
  })

  it("is re-runnable — every DDL statement is idempotent", () => {
    // Replaying supabase/migrations/ against a DB that already has 00193 (a
    // Supabase branch seeded from the folder, or a re-apply after a mid-file
    // failure) must not abort with 42701 before it reaches the seeds below.
    const ddl = sql.match(/^\s*alter table .*add column .*$/gim) ?? []
    expect(ddl.length).toBe(2)
    for (const stmt of ddl) expect(stmt.toLowerCase()).toContain("add column if not exists")
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

// ── Live schema ───────────────────────────────────────────────────────────
// The .sql text assertions above pass whether or not the migration was ever
// applied. These probe the real database, in the style of the sibling migration
// tests (00078, 00093), so drift between the file and the DB goes red.
//
// TWO PROJECTS, ON PURPOSE: migrations are applied to PRODUCTION through
// mcp__supabase__apply_migration (the .env.prod project), while vitest loads
// .env.local — a separate, older project that trails prod by the whole
// 00191/00192/00193 wave. A bare live assertion here would therefore be red for
// an environment reason that has nothing to do with 00193, so the probe below
// discriminates the two cases:
//   * 00192's table present, 00193's columns missing → genuine 00193 drift → FAIL
//   * 00192's table missing too                      → whole-DB lag        → skip
// Against prod (or any DB caught up to 00192) these assertions are unconditional.
describe("migration 00193 — live schema", () => {
  const supabase = createServiceRoleClient()
  const SKIP_NOTE =
    "connected Supabase project predates migration 00192 — not the DB 00193 was applied to"
  let dbIsCurrent = false

  beforeAll(async () => {
    // 00192 created bookkeeping_finding_dismissals. Its presence means this DB
    // is caught up to the migration immediately before 00193.
    const { error } = await supabase.from("bookkeeping_finding_dismissals").select("id").limit(1)
    dbIsCurrent = error === null
  })

  it("exposes external_ref + scan_result on bookkeeping_documents", async (ctx) => {
    if (!dbIsCurrent) return ctx.skip(SKIP_NOTE)

    const { error } = await supabase
      .from("bookkeeping_documents")
      .select("id, external_ref, scan_result")
      .limit(1)

    // PostgREST answers a missing column with 42703 rather than throwing.
    expect(error).toBeNull()
  })

  it("has the poller flag seeded OFF and the watched label seeded", async (ctx) => {
    if (!dbIsCurrent) return ctx.skip(SKIP_NOTE)

    const { data, error } = await supabase
      .from("system_settings")
      .select("key, value")
      .in("key", ["cron_bookkeeping_gmail_receipts_enabled", "bookkeeping_gmail_receipt_label"])

    expect(error).toBeNull()
    const seeded = Object.fromEntries(
      (data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]),
    )
    // getSetting() hands these back already-parsed, so C5 reads a bare
    // boolean / bare string — not 'false' and not '"DJP Receipts"'.
    expect(seeded["cron_bookkeeping_gmail_receipts_enabled"]).toBe(false)
    expect(seeded["bookkeeping_gmail_receipt_label"]).toBe("DJP Receipts")
  })

  it("enforces the UNIQUE on external_ref (the belt behind the skip check)", async (ctx) => {
    if (!dbIsCurrent) return ctx.skip(SKIP_NOTE)

    const book = await supabase.from("bookkeeping_books").select("id").limit(1).single()
    expect(book.error).toBeNull()

    const stamp = `${Date.now()}`
    const base = {
      book_id: book.data!.id,
      kind: "receipt" as const,
      storage_path: `bookkeeping/test-00193-${stamp}.jpg`,
      retain_until: "2030-01-01",
      external_ref: `gmail:test-00193-${stamp}:0`,
    }

    const first = await supabase.from("bookkeeping_documents").insert(base).select("id").single()
    const second = await supabase
      .from("bookkeeping_documents")
      .insert({ ...base, storage_path: `${base.storage_path}.dup` })
      .select("id")
      .single()

    try {
      expect(first.error).toBeNull()
      expect(second.error).not.toBeNull()
      expect(second.error?.code).toBe("23505")
    } finally {
      const ids = [first.data?.id, second.data?.id].filter(Boolean) as string[]
      if (ids.length) await supabase.from("bookkeeping_documents").delete().in("id", ids)
    }
  })
})
