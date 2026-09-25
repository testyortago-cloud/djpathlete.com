import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { collectSelects, collectSelectsFromSource } from "@/scripts/lib/collect-postgrest-selects"

// The extractor feeds __tests__/integration/postgrest-select-contract.test.ts,
// which runs every collected (table, select, order) against the dev clone's
// live PostgREST. Every case here is a way that live check could go quietly
// blind: a select it never collects is a select nobody probes, and a select it
// resolves to the WRONG string or table is a probe that passes for the wrong
// reason.

const FILE = "lib/db/example.ts"

describe("collectSelectsFromSource — what it collects", () => {
  it("collects a plain from().select() chain with its table and select string", () => {
    const src = `const { data } = await supabase.from("contacts").select("id, email").eq("id", id)`
    expect(collectSelectsFromSource(FILE, src)).toEqual({
      calls: [{ file: FILE, line: 1, schema: null, table: "contacts", select: "id, email", orders: [] }],
      unresolved: [],
    })
  })

  it("treats a select() with no argument as *", () => {
    const src = `await supabase.from("contacts").insert(row).select().single()`
    expect(collectSelectsFromSource(FILE, src).calls).toEqual([
      { file: FILE, line: 1, schema: null, table: "contacts", select: "*", orders: [] },
    ])
  })

  it("walks past insert/update/filters to find the table a returning select belongs to", () => {
    const src = [
      `await supabase`,
      `  .from("funnel_submissions")`,
      `  .update({ status })`,
      `  .eq("id", id)`,
      `  .eq("business_id", businessId)`,
      `  .select("*, funnels(name, slug), funnel_steps(name)")`,
      `  .single()`,
    ].join("\n")
    expect(collectSelectsFromSource(FILE, src).calls).toEqual([
      {
        file: FILE,
        line: 6,
        schema: null,
        table: "funnel_submissions",
        select: "*, funnels(name, slug), funnel_steps(name)",
        orders: [],
      },
    ])
  })

  it("records the schema when the chain goes through .schema()", () => {
    const src = `await supabase.schema("storage").from("objects").select("name")`
    expect(collectSelectsFromSource(FILE, src).calls).toEqual([
      { file: FILE, line: 1, schema: "storage", table: "objects", select: "name", orders: [] },
    ])
  })

  it("records the schema when .from() is called on a const that holds a .schema() client", () => {
    const src = [`const db = supabase.schema("analytics")`, `await db.from("events").select("id")`].join("\n")
    expect(collectSelectsFromSource(FILE, src).calls).toEqual([
      { file: FILE, line: 2, schema: "analytics", table: "events", select: "id", orders: [] },
    ])
  })

  it("keeps the select's option object out of the select string", () => {
    const src = `await supabase.from("leads").select("id", { count: "exact", head: true })`
    expect(collectSelectsFromSource(FILE, src).calls).toEqual([
      { file: FILE, line: 1, schema: null, table: "leads", select: "id", orders: [] },
    ])
  })

  it("collects a select inside a template literal with no substitutions", () => {
    const src = "await supabase.from(`programs`).select(`id,\n  name`)"
    expect(collectSelectsFromSource(FILE, src).calls).toEqual([
      { file: FILE, line: 1, schema: null, table: "programs", select: "id,\n  name", orders: [] },
    ])
  })
})

describe("collectSelectsFromSource — order columns in the same chain", () => {
  // An ORDER BY on a missing column answers 42703 just like a select does, and
  // a select string that happens to name the column does not protect it:
  // G25's refund lookup selected AND ordered by a column the table lacks.
  it("collects each .order() column after the select, with its referenced table", () => {
    const src = [
      `await supabase.from("opportunity_stage_events")`,
      `  .select("opportunity_id, metadata")`,
      `  .eq("business_id", businessId)`,
      `  .order("occurred_at", { ascending: false })`,
      `  .order("name", { referencedTable: "funnels" })`,
      `  .order("id", { foreignTable: "funnel_steps", ascending: true })`,
    ].join("\n")
    expect(collectSelectsFromSource(FILE, src).calls[0].orders).toEqual([
      { column: "occurred_at", referencedTable: null },
      { column: "name", referencedTable: "funnels" },
      { column: "id", referencedTable: "funnel_steps" },
    ])
  })

  it("resolves an order column held in a const", () => {
    const src = [`const SORT = "created_at"`, `await supabase.from("events").select("id").order(SORT)`].join("\n")
    expect(collectSelectsFromSource(FILE, src).calls[0].orders).toEqual([
      { column: "created_at", referencedTable: null },
    ])
  })

  it("collects an order applied later to a let builder that is only ever reassigned onto itself", () => {
    const src = [
      `let query = supabase.from("ai_conversation_history").select("*").eq("user_id", userId)`,
      `if (feature) query = query.eq("feature", feature)`,
      `const { data } = await query.order("created_at", { ascending: false }).limit(limit)`,
    ].join("\n")
    expect(collectSelectsFromSource(FILE, src).calls).toEqual([
      { file: FILE, line: 1, schema: null, table: "ai_conversation_history", select: "*", orders: [] },
      {
        file: FILE,
        line: 3,
        schema: null,
        table: "ai_conversation_history",
        select: "*",
        orders: [{ column: "created_at", referencedTable: null }],
      },
    ])
  })

  it("reports an order on a builder that went through a helper, instead of skipping it", () => {
    const src = [
      `const base = supabase.from("chat_conversations").select("id")`,
      `const filtered = applyChatFilter(base, businessId)`,
      `const { data } = await (filtered as typeof base).order("last_activity_at", { ascending: false })`,
    ].join("\n")
    const out = collectSelectsFromSource(FILE, src)
    expect(out.calls.map((c) => c.orders)).toEqual([[]])
    expect(out.unresolved.map((u) => `${u.line} ${u.reason}`)).toEqual([
      "3 order receiver is not a from() chain: applyChatFilter(base, businessId)",
    ])
  })

  it("reports an order column it cannot resolve, and still collects the select", () => {
    const src = `function list(sort: string) { return supabase.from("events").select("id").order(sort) }`
    const out = collectSelectsFromSource(FILE, src)
    expect(out.calls).toEqual([{ file: FILE, line: 1, schema: null, table: "events", select: "id", orders: [] }])
    expect(out.unresolved).toEqual([
      {
        file: FILE,
        line: 1,
        reason: "order column is not a constant: sort",
        text: 'supabase.from("events").select("id").order(sort)',
      },
    ])
  })
})

describe("collectSelectsFromSource — resolving constants", () => {
  it("resolves a select held in a same-file const", () => {
    const src = [
      `const CONTACT_COLUMNS = "id, email, phone_e164"`,
      `await supabase.from("contacts").select(CONTACT_COLUMNS)`,
    ].join("\n")
    expect(collectSelectsFromSource(FILE, src).calls).toEqual([
      { file: FILE, line: 2, schema: null, table: "contacts", select: "id, email, phone_e164", orders: [] },
    ])
  })

  it("resolves a template literal whose substitutions are same-file consts", () => {
    const src = [
      "const BASE = `id, name`",
      'const EMBED = "funnels(name)"',
      'await supabase.from("funnel_steps").select(`${BASE}, ${EMBED}`)',
    ].join("\n")
    expect(collectSelectsFromSource(FILE, src).calls[0].select).toBe("id, name, funnels(name)")
  })

  it("resolves string concatenation of consts and literals", () => {
    const src = [`const COLS = "id, name"`, `await supabase.from("events").select(COLS + ", slug")`].join("\n")
    expect(collectSelectsFromSource(FILE, src).calls[0].select).toBe("id, name, slug")
  })

  it("resolves a table held in a same-file const", () => {
    const src = [`const TABLE = "sequence_runs"`, `await supabase.from(TABLE).select("id")`].join("\n")
    expect(collectSelectsFromSource(FILE, src).calls[0].table).toBe("sequence_runs")
  })

  it("unwraps `as const` on a resolved const", () => {
    const src = [`const COLS = "id, slug" as const`, `await supabase.from("events").select(COLS)`].join("\n")
    expect(collectSelectsFromSource(FILE, src).calls[0].select).toBe("id, slug")
  })

  it("follows a receiver held in a const back to its from()", () => {
    const src = [`const q = supabase.from("bookings")`, `const { data } = await q.select("id, starts_at")`].join("\n")
    expect(collectSelectsFromSource(FILE, src).calls).toEqual([
      { file: FILE, line: 2, schema: null, table: "bookings", select: "id, starts_at", orders: [] },
    ])
  })

  it("resolves the same const name declared in two scopes to each scope's own value", () => {
    const src = [
      `function a() { const COLS = "id"; return supabase.from("contacts").select(COLS) }`,
      `function b() { const COLS = "id, email"; return supabase.from("contacts").select(COLS) }`,
    ].join("\n")
    expect(collectSelectsFromSource(FILE, src).calls.map((c) => c.select)).toEqual(["id", "id, email"])
  })
})

describe("collectSelectsFromSource — scoping: a name that is not the const it looks like", () => {
  // Each of these resolved to the WRONG string or table under a name-only
  // lookup: a probe that passes for the wrong reason.
  it("does not resolve a parameter that shadows a module const of the same name", () => {
    const src = [
      `const COLS = "id, email"`,
      `function read(COLS: string) { return supabase.from("contacts").select(COLS) }`,
    ].join("\n")
    const out = collectSelectsFromSource(FILE, src)
    expect(out.calls).toEqual([])
    expect(out.unresolved.map((u) => u.reason)).toEqual(["select is not a constant: COLS"])
  })

  it("follows each same-named builder to its own declaration, never the other function's", () => {
    const src = [
      `function a() { const query = supabase.from("contacts"); return query.select("id") }`,
      `function b() { let query = supabase.from("leads").update(x); return query.select("id, name") }`,
    ].join("\n")
    const out = collectSelectsFromSource(FILE, src)
    expect(out.calls.map((c) => `${c.table}: ${c.select}`)).toEqual(["contacts: id", "leads: id, name"])
    expect(out.unresolved).toEqual([])
  })

  it("follows a let builder that is reassigned only onto itself", () => {
    const src = [
      `let query = supabase.from("shop_product_variants").update({ is_available: false }).eq("product_id", id)`,
      `if (keep.length > 0) { query = query.not("printful_sync_variant_id", "in", list) }`,
      `const { data } = await query.select("id")`,
    ].join("\n")
    expect(collectSelectsFromSource(FILE, src).calls).toEqual([
      { file: FILE, line: 3, schema: null, table: "shop_product_variants", select: "id", orders: [] },
    ])
  })

  it("does not follow a let builder that is ever reassigned to something else", () => {
    const src = [
      `let query = supabase.from("contacts")`,
      `if (useLeads) query = supabase.from("leads")`,
      `const { data } = await query.select("id")`,
    ].join("\n")
    const out = collectSelectsFromSource(FILE, src)
    expect(out.calls).toEqual([])
    expect(out.unresolved.map((u) => u.reason)).toEqual(["receiver is not a from() chain: query"])
  })

  it("does not resolve a for-of variable that shadows a module const", () => {
    const src = [
      `const table = "contacts"`,
      `for (const table of tables) { await supabase.from(table).select("id") }`,
    ].join("\n")
    const out = collectSelectsFromSource(FILE, src)
    expect(out.calls).toEqual([])
    expect(out.unresolved.map((u) => u.reason)).toEqual(["table is not a constant: table"])
  })

  it("does not resolve a destructured parameter that shadows a module const", () => {
    const src = [
      `const cols = "id"`,
      `function read({ cols }: { cols: string }) { return supabase.from("contacts").select(cols) }`,
    ].join("\n")
    expect(collectSelectsFromSource(FILE, src).unresolved.map((u) => u.reason)).toEqual([
      "select is not a constant: cols",
    ])
  })

  it("does not resolve an imported name, which it cannot see", () => {
    const src = [`import { COLS } from "./columns"`, `await supabase.from("contacts").select(COLS)`].join("\n")
    expect(collectSelectsFromSource(FILE, src).unresolved.map((u) => u.reason)).toEqual([
      "select is not a constant: COLS",
    ])
  })
})

describe("collectSelectsFromSource — what it refuses to guess", () => {
  it("reports a table it cannot resolve instead of skipping the call", () => {
    const src = `export async function readAll(table: string) { return supabase.from(table).select("id") }`
    const out = collectSelectsFromSource(FILE, src)
    expect(out.calls).toEqual([])
    expect(out.unresolved).toEqual([
      { file: FILE, line: 1, reason: "table is not a constant: table", text: 'supabase.from(table).select("id")' },
    ])
  })

  it("reports a select it cannot resolve instead of skipping the call", () => {
    const src = `function read(columns: string) { return supabase.from("contacts").select(columns) }`
    const out = collectSelectsFromSource(FILE, src)
    expect(out.calls).toEqual([])
    expect(out.unresolved).toEqual([
      {
        file: FILE,
        line: 1,
        reason: "select is not a constant: columns",
        text: 'supabase.from("contacts").select(columns)',
      },
    ])
  })

  it("reports a select whose receiver is a parameter, because it cannot see the table", () => {
    const src = `function withColumns(query: Builder) { return query.select("id, name") }`
    expect(collectSelectsFromSource(FILE, src).unresolved).toEqual([
      {
        file: FILE,
        line: 1,
        reason: "receiver is not a from() chain: query",
        text: 'query.select("id, name")',
      },
    ])
  })

  it("reports a no-argument select on an untraceable builder chain, not only one with columns", () => {
    const src = `function save(q: Builder, row: Row) { return q.insert(row).select() }`
    expect(collectSelectsFromSource(FILE, src).unresolved.map((u) => u.reason)).toEqual([
      "receiver is not a from() chain: q",
    ])
  })
})

describe("collectSelects — which files it reads", () => {
  let root: string | null = null
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = null
  })

  function tree(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "collect-selects-"))
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), body)
    }
    return dir
  }

  it("reads .ts and .tsx under the given directories and reports repo-relative paths", () => {
    root = tree({
      "lib/db/contacts.ts": `supabase.from("contacts").select("id")`,
      "app/admin/page.tsx": `supabase.from("events").select("slug")`,
      "functions/src/job.ts": `supabase.from("cron_runs").select("id")`,
    })
    const out = collectSelects(root, ["lib", "app", "functions/src"])
    expect(out.calls.map((c) => `${c.file} ${c.table}`).sort()).toEqual([
      "app/admin/page.tsx events",
      "functions/src/job.ts cron_runs",
      "lib/db/contacts.ts contacts",
    ])
  })

  it("reads dot-directories such as app/.well-known", () => {
    root = tree({ "app/.well-known/thing/route.ts": `supabase.from("events").select("slug")` })
    expect(collectSelects(root, ["app"]).calls.map((c) => c.file)).toEqual(["app/.well-known/thing/route.ts"])
  })

  it("skips test files, __tests__ directories, declaration files and node_modules", () => {
    root = tree({
      "lib/db/contacts.ts": `supabase.from("contacts").select("id")`,
      "lib/db/contacts.test.ts": `supabase.from("mocked").select("id")`,
      "lib/db/contacts.spec.tsx": `supabase.from("mocked").select("id")`,
      "lib/__tests__/helper.ts": `supabase.from("mocked").select("id")`,
      "lib/types.d.ts": `declare const x: string`,
      "lib/node_modules/pkg/index.ts": `supabase.from("mocked").select("id")`,
    })
    expect(collectSelects(root, ["lib"]).calls.map((c) => c.table)).toEqual(["contacts"])
  })

  it("does not read directories it was not given", () => {
    root = tree({
      "lib/db/contacts.ts": `supabase.from("contacts").select("id")`,
      "scripts/seed.ts": `supabase.from("seeded").select("id")`,
    })
    expect(collectSelects(root, ["lib"]).calls.map((c) => c.table)).toEqual(["contacts"])
  })
})

describe("collectSelectsFromSource — what is not PostgREST", () => {
  it("ignores Array.from, storage buckets, rpc() chains and an input's own select()", () => {
    const src = [
      `const ids = Array.from(new Set(rows.map((r) => r.id)))`,
      `await supabase.storage.from("media").upload(path, file)`,
      `await supabase.storage.from("media").list(prefix)`,
      `await supabase.rpc("claim_sequence_runs", { p_limit: 10 })`,
      `const onFocus = (e) => e.currentTarget.select()`,
      `inputRef.current?.select()`,
    ].join("\n")
    expect(collectSelectsFromSource(FILE, src)).toEqual({ calls: [], unresolved: [] })
  })
})
