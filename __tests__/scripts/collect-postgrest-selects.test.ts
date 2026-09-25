import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { collectSelects, collectSelectsFromSource } from "@/scripts/lib/collect-postgrest-selects"

// The extractor feeds __tests__/integration/postgrest-select-contract.test.ts,
// which runs every collected (table, select) pair against the dev clone's live
// PostgREST. Every case here is a way that live check could go quietly blind:
// a select it never collects is a select nobody probes, and a select it
// resolves to the WRONG string is a probe that passes for the wrong reason.

const FILE = "lib/db/example.ts"

describe("collectSelectsFromSource — what it collects", () => {
  it("collects a plain from().select() chain with its table and select string", () => {
    const src = `const { data } = await supabase.from("contacts").select("id, email").eq("id", id)`
    expect(collectSelectsFromSource(FILE, src)).toEqual({
      calls: [{ file: FILE, line: 1, schema: null, table: "contacts", select: "id, email" }],
      unresolved: [],
    })
  })

  it("treats a select() with no argument as *", () => {
    const src = `await supabase.from("contacts").insert(row).select().single()`
    expect(collectSelectsFromSource(FILE, src).calls).toEqual([
      { file: FILE, line: 1, schema: null, table: "contacts", select: "*" },
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
      },
    ])
  })

  it("records the schema when the chain goes through .schema()", () => {
    const src = `await supabase.schema("storage").from("objects").select("name")`
    expect(collectSelectsFromSource(FILE, src).calls).toEqual([
      { file: FILE, line: 1, schema: "storage", table: "objects", select: "name" },
    ])
  })

  it("keeps the select's option object out of the select string", () => {
    const src = `await supabase.from("leads").select("id", { count: "exact", head: true })`
    expect(collectSelectsFromSource(FILE, src).calls).toEqual([
      { file: FILE, line: 1, schema: null, table: "leads", select: "id" },
    ])
  })

  it("collects a select inside a template literal with no substitutions", () => {
    const src = "await supabase.from(`programs`).select(`id,\n  name`)"
    expect(collectSelectsFromSource(FILE, src).calls).toEqual([
      { file: FILE, line: 1, schema: null, table: "programs", select: "id,\n  name" },
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
      { file: FILE, line: 2, schema: null, table: "contacts", select: "id, email, phone_e164" },
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
      { file: FILE, line: 2, schema: null, table: "bookings", select: "id, starts_at" },
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

  it("reports a const name declared twice with different values as ambiguous, not whichever came first", () => {
    const src = [
      `function a() { const COLS = "id"; return supabase.from("contacts").select(COLS) }`,
      `function b() { const COLS = "id, email"; return supabase.from("contacts").select(COLS) }`,
    ].join("\n")
    const out = collectSelectsFromSource(FILE, src)
    expect(out.calls).toEqual([])
    expect(out.unresolved.map((u) => u.reason)).toEqual([
      "select is not a constant: COLS",
      "select is not a constant: COLS",
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
  it("ignores Array.from, storage buckets and rpc() chains", () => {
    const src = [
      `const ids = Array.from(new Set(rows.map((r) => r.id)))`,
      `await supabase.storage.from("media").upload(path, file)`,
      `await supabase.storage.from("media").list(prefix)`,
      `await supabase.rpc("claim_sequence_runs", { p_limit: 10 })`,
    ].join("\n")
    expect(collectSelectsFromSource(FILE, src)).toEqual({ calls: [], unresolved: [] })
  })
})
