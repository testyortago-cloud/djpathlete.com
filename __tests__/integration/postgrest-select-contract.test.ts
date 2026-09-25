// INTEGRATION TEST — opt-in: `npm run test:integration:selects`. Excluded from `npm test`.
//
// Runs every PostgREST select in the deployed code — its table, its select
// string and the `.order()` columns applied to it — against the DEV CLONE's
// live schema, with `limit=0`, and fails on any the server refuses.
//
// WHY THIS EXISTS. Every DAL unit test mocks PostgREST, so none of them can see
// a select string the real server rejects. G31 shipped one: the leads inbox
// embedded `funnels:funnel_id(...)`, a single-column hint that cannot resolve
// once migration 00278 replaced the simple foreign key with a composite one.
// PostgREST answered PGRST200 and the inbox 500'd for every tenant, while every
// mocked suite passed (and one of them pinned the broken string as "unchanged").
// A `limit=0` GET with the same select reproduces that error without reading a
// row. So does a missing column (42703), in the select or in an ORDER BY — G25's
// refund lookup had it in both, and its fake stamped the missing column on
// every row.
//
// WHAT IT DOES NOT COVER: rpc() calls, filters (.eq/.in on a missing column),
// and insert/update payload columns. What it cannot resolve statically is on
// KNOWN_UNRESOLVED below, so a new one fails until someone looks at it.
//
// RUN IT before merging to main, and after applying a migration to the clone.
// The clone only has the migrations a session applied by hand
// (apply-migrations.yml targets production), so a branch whose code needs its
// own migration must apply it to the clone first, or this reports the gap.
//
// DEV CLONE ONLY. It accepts exactly the clone's host and nothing else. It
// writes nothing: every probe is a GET with limit=0.

import { describe, it, expect, beforeAll } from "vitest"
import path from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  collectSelects,
  type CollectedSelects,
  type OrderColumn,
  type SelectCall,
} from "@/scripts/lib/collect-postgrest-selects"
import { untenantedTables } from "../helpers/untenanted-by-schema"

const CLONE_HOST = "anjvztjiokcgiyhobknq.supabase.co"

/** Everything that ships: the Next app, the Firebase functions and the render worker. */
const DEPLOYED_DIRS = ["lib", "app", "components", "functions/src", "render-worker/src"]

/**
 * What the extractor cannot resolve without guessing — today, only `.order()`
 * calls on a builder that went through a helper or a ternary first. Matched on
 * file, reason and how many times it occurs, never on line, so unrelated edits
 * do not churn this list and a new site with the same shape still fails.
 * `checkedAs` is the table and order column(s) a human read off the code, and
 * the test probes those too, so these orders are still checked live.
 */
const KNOWN_UNRESOLVED: {
  file: string
  reason: string
  count: number
  checkedAs: { table: string; orders: string[] }
}[] = [
  {
    file: "lib/db/bookkeeping.ts",
    reason: "order receiver is not a from() chain: applyEntryFilters(base as any, p)",
    count: 1,
    checkedAs: { table: "bookkeeping_ledger_entries", orders: ["occurred_on"] },
  },
  {
    file: "lib/db/bookkeeping.ts",
    reason: 'order receiver is not a from() chain: bookId ? base.eq("book_id", bookId) : base',
    count: 2,
    checkedAs: { table: "bookkeeping_assets", orders: ["in_service_on", "created_at"] },
  },
  {
    file: "lib/db/chat.ts",
    reason: "order receiver is not a from() chain: applyChatFilter(base, businessId, show, blockedIds)",
    count: 1,
    checkedAs: { table: "chat_conversations", orders: ["last_activity_at"] },
  },
  {
    file: "lib/db/contacts-list.ts",
    reason: "order receiver is not a from() chain: applyFilters(base, filters)",
    count: 1,
    checkedAs: { table: "contacts", orders: ["created_at"] },
  },
  {
    file: "lib/db/funnel-leads.ts",
    reason: "order receiver is not a from() chain: applyFilters(base, businessId, filters)",
    count: 1,
    checkedAs: { table: "funnel_submissions", orders: ["created_at"] },
  },
]

/**
 * Selects the live schema refuses TODAY, found by the first run of this test
 * on 2026-09-25 and left unfixed because each fix is a decision, not a typo.
 * Matched on file, table, select string and error code, so a second, different
 * broken select in the same file cannot hide behind an entry. An entry that
 * stops being refused fails the test until it is removed.
 */
const KNOWN_REFUSED: { file: string; table: string; select: string; code: string; why: string }[] = [
  {
    file: "functions/src/ai/admin-tools.ts",
    table: "performance_assessments",
    select: "exercise_id, metric_type, value, unit, assessed_at, exercises(name)",
    code: "PGRST200",
    why:
      "Selects exercise_id, metric_type, value, unit, assessed_at and exercises(name), filtered on user_id — " +
      "none of which performance_assessments has (00048: client_user_id, title, status; per-exercise rows live " +
      "in a child table). The error is ignored, so the AI coach's client context has never included " +
      "assessments. Needs a rewrite against the real schema, not a rename.",
  },
  {
    file: "functions/src/social-outcome-tracker.ts",
    table: "social_analytics",
    select: "social_post_id, likes, comments, shares, impressions, engagement_rate, captured_at",
    code: "42703",
    why:
      "engagement_rate and captured_at do not exist (00089 has engagement and recorded_at). The error is " +
      "ignored, so every social memo is scored on zero likes, comments, shares and impressions. Fixing it " +
      "changes impact_score and the agent_tool_baselines P95 the social agent learns from — the owner's call.",
  },
]

const CONCURRENCY = 8
const REPO_ROOT = path.resolve(__dirname, "../..")

/** Codes that mean "the database could not answer", not "the schema says no". Retried, then reported apart. */
const INFRA_CODES = new Set(["PGRST000", "PGRST001", "PGRST002", "PGRST003", "57014", "53300"])
const RETRY_DELAYS_MS = [500, 2000]

function requireCloneClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must point at the dev clone. " +
        "This contract has NOT run.",
    )
  }
  const host = new URL(url).hostname
  if (host !== CLONE_HOST) throw new Error(`Refusing to probe ${host}: only the dev clone (${CLONE_HOST}) is allowed.`)
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

type ProbeResult = null | { kind: "refused" | "infra"; code: string; message: string }

const normalise = (s: string) => s.replace(/\s+/g, "")

async function probe(
  client: SupabaseClient,
  schema: string | null,
  table: string,
  select: string,
  orders: OrderColumn[] = [],
): Promise<ProbeResult> {
  for (let attempt = 0; ; attempt++) {
    const base = schema ? client.schema(schema) : client
    let query = base.from(table).select(select)
    for (const o of orders)
      query = query.order(o.column, o.referencedTable ? { referencedTable: o.referencedTable } : {})
    const { error } = await query.limit(0)
    if (!error) return null
    // No code: the request never got a PostgREST answer (network, gateway
    // page). An INFRA code: PostgREST or Postgres could not serve it (pool,
    // schema cache reloading right after a migration, timeout). Both are
    // retried with backoff and, if they persist, reported as infrastructure —
    // never as the schema refusing the select.
    const infra = !error.code || INFRA_CODES.has(error.code)
    if (infra && attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
      continue
    }
    return { kind: infra ? "infra" : "refused", code: error.code || "(no code)", message: error.message }
  }
}

function key(c: Pick<SelectCall, "schema" | "table" | "select" | "orders">): string {
  // supabase-js strips whitespace outside quotes before sending, so two
  // selects that differ only in spacing are the same request.
  return `${c.schema ?? ""}|${c.table}|${normalise(c.select)}|${JSON.stringify(c.orders)}`
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

describe("PostgREST select contract (dev clone, live)", () => {
  let client: SupabaseClient
  let collected: CollectedSelects

  beforeAll(() => {
    client = requireCloneClient()
    collected = collectSelects(REPO_ROOT, DEPLOYED_DIRS)
  })

  // Positive controls. If PostgREST ever stopped checking the schema under
  // limit=0, every probe below would pass and prove nothing; these fail first.
  describe("controls: limit=0 still makes PostgREST check the schema", () => {
    it("the embed hint that took down the leads inbox is refused (PGRST200)", async () => {
      const r = await probe(
        client,
        null,
        "funnel_submissions",
        "*, funnels:funnel_id(name, slug), funnel_steps:step_id(name)",
      )
      expect(r?.code).toBe("PGRST200")
    })

    it("an embed of a relation that does not exist is refused (PGRST200)", async () => {
      const r = await probe(client, null, "funnel_submissions", "id, not_a_table_control(id)")
      expect(r?.code).toBe("PGRST200")
    })

    it("a column that does not exist is refused (42703)", async () => {
      const r = await probe(client, null, "funnel_submissions", "id, column_that_does_not_exist")
      expect(r?.code).toBe("42703")
    })

    it("an order column that does not exist is refused (42703)", async () => {
      const r = await probe(client, null, "opportunity_stage_events", "id", [
        { column: "created_at", referencedTable: null },
      ])
      expect(r?.code).toBe("42703")
    })

    it("a table that does not exist is refused (PGRST205)", async () => {
      const r = await probe(client, null, "not_a_table_control", "id")
      expect(r?.code).toBe("PGRST205")
    })
  })

  // G35 §D2. Every table on the UNTENANTED BY SCHEMA shelf of
  // lib/tenancy/platform.ts is there because it has NO business_id column.
  // platform-inventory.test.ts proves no MIGRATION adds one; only the live
  // schema can say the column arrived some other way — a statement run by
  // hand, a dashboard edit, dynamic SQL the migration scan cannot read. A
  // table that stops answering 42703 has grown the column: move its readers
  // off the shelf and give them a predicate, rather than editing this test.
  describe("the UNTENANTED BY SCHEMA shelf's tables still have no business_id", () => {
    it("control: a table that HAS business_id answers the same probe without an error", async () => {
      expect(await probe(client, null, "events", "business_id")).toBeNull()
    })

    it.each(untenantedTables())("%s has no business_id column (42703)", async (table) => {
      const r = await probe(client, null, table, "business_id")
      expect(r?.code).toBe("42703")
    })
  })

  it("collected the leads-inbox select that G31 broke", () => {
    // Matches the embed however it is spelled: the point is that the scan
    // reached it, not that it is currently correct — the probe decides that.
    const inbox = collected.calls.filter(
      (c) => c.file === "lib/db/funnel-leads.ts" && c.table === "funnel_submissions" && c.select.includes("funnels"),
    )
    expect(inbox.length).toBeGreaterThan(0)
  })

  it("collected the refund lookup's order column that G25 got wrong", () => {
    const refund = collected.calls.filter(
      (c) => c.file === "lib/db/pipeline.ts" && c.table === "opportunity_stage_events" && c.orders.length > 0,
    )
    expect(refund.length).toBeGreaterThan(0)
  })

  it("collected selects from every deployed directory known to have them", () => {
    const dirsWithCalls = DEPLOYED_DIRS.filter((d) => collected.calls.some((c) => c.file.startsWith(d + "/")))
    expect(dirsWithCalls).toEqual(expect.arrayContaining(["app", "functions/src", "lib", "render-worker/src"]))
  })

  it("everything it could not resolve is on KNOWN_UNRESOLVED, with no stale entries", () => {
    const found = new Map<string, number>()
    for (const u of collected.unresolved) {
      const k = `${u.file} :: ${u.reason}`
      found.set(k, (found.get(k) ?? 0) + 1)
    }
    const known = new Map(KNOWN_UNRESOLVED.map((k) => [`${k.file} :: ${k.reason}`, k.count]))
    const mismatched = [...new Set([...found.keys(), ...known.keys()])]
      .filter((k) => found.get(k) !== known.get(k))
      .map((k) => `${k}  (found ${found.get(k) ?? 0}, listed ${known.get(k) ?? 0})`)
    const detail = collected.unresolved.map((u) => `${u.file}:${u.line} ${u.reason} :: ${u.text}`).join("\n")
    expect(mismatched, `Make these resolvable, or list them with the table a human checked:\n${detail}`).toEqual([])
  })

  describe("probing every collected select", () => {
    type Probed = { schema: string | null; table: string; select: string; orders: OrderColumn[]; sites: string[] }
    let refused: (Probed & { code: string; message: string; files: string[] })[] = []
    let infra: string[] = []
    let probed = 0

    beforeAll(async () => {
      const groups = new Map<string, Probed & { files: string[] }>()
      const add = (p: Omit<Probed, "sites">, site: string, file: string) => {
        const g = groups.get(key(p)) ?? { ...p, sites: [], files: [] }
        g.sites.push(site)
        g.files.push(file)
        groups.set(key(p), g)
      }
      for (const c of collected.calls) add(c, `${c.file}:${c.line}`, c.file)
      for (const k of KNOWN_UNRESOLVED) {
        add(
          {
            schema: null,
            table: k.checkedAs.table,
            select: "*",
            orders: k.checkedAs.orders.map((column) => ({ column, referencedTable: null })),
          },
          `${k.file} (KNOWN_UNRESOLVED, checked by hand)`,
          k.file,
        )
      }
      const unique = [...groups.values()]
      probed = unique.length
      const results = await pool(unique, CONCURRENCY, (g) => probe(client, g.schema, g.table, g.select, g.orders))
      unique.forEach((g, i) => {
        const r = results[i]
        if (r?.kind === "refused") refused.push({ ...g, code: r.code, message: r.message })
        if (r?.kind === "infra") infra.push(`${r.code} on ${g.table} (${g.sites[0]}) — ${r.message}`)
      })
    }, 300_000)

    const isKnown = (r: (typeof refused)[number], file: string) =>
      KNOWN_REFUSED.some(
        (k) =>
          k.file === file && k.table === r.table && k.code === r.code && normalise(k.select) === normalise(r.select),
      )

    it("no probe failed for infrastructure reasons (the run would prove nothing)", () => {
      expect(infra).toEqual([])
    })

    it("no select outside KNOWN_REFUSED is refused by the live schema", () => {
      const unknown = refused.flatMap((r) =>
        r.sites
          .filter((_, i) => !isKnown(r, r.files[i]))
          .map((site) => {
            const table = r.schema ? `${r.schema}.${r.table}` : r.table
            const orders = r.orders.length
              ? ` order ${r.orders.map((o) => (o.referencedTable ? `${o.referencedTable}.` : "") + o.column).join(", ")}`
              : ""
            return `${r.code} at ${site} — ${table} select "${r.select.replace(/\s+/g, " ")}"${orders} — ${r.message}`
          }),
      )
      expect(unknown, `${unknown.length} site(s) refused by the dev clone (${probed} distinct probes)`).toEqual([])
    })

    it("every KNOWN_REFUSED entry is still refused (remove the ones that were fixed)", () => {
      const stale = KNOWN_REFUSED.filter(
        (k) =>
          !refused.some(
            (r) =>
              r.table === k.table &&
              r.code === k.code &&
              normalise(r.select) === normalise(k.select) &&
              r.files.includes(k.file),
          ),
      ).map((k) => `${k.file} (${k.table}, ${k.code})`)
      expect(stale).toEqual([])
    })
  })
})
