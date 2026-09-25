// INTEGRATION TEST — opt-in: `npm run test:integration:selects`. Excluded from `npm test`.
//
// Runs every PostgREST select in the deployed code against the DEV CLONE's live
// schema, with `limit=0`, and fails on any the server refuses.
//
// WHY THIS EXISTS. Every DAL unit test mocks PostgREST, so none of them can see
// a select string the real server rejects. G31 shipped one: the leads inbox
// embedded `funnels:funnel_id(...)`, a single-column hint that cannot resolve
// once migration 00278 replaced the simple foreign key with a composite one.
// PostgREST answered PGRST200 and the inbox 500'd for every tenant, while every
// mocked suite passed (and one of them pinned the broken string as "unchanged").
// A `limit=0` GET with the same select reproduces that error without reading a
// row. So does a missing column (42703). That is the whole mechanism.
//
// WHAT IT DOES NOT COVER: rpc() calls, filters (.eq/.in on a missing column),
// and insert/update payload columns. It checks the select string and the table
// it runs against. The one select the extractor cannot resolve statically is
// listed in KNOWN_UNRESOLVED below, so a new one fails until someone looks at it.
//
// RUN IT before merging to main, and after applying a migration to the clone.
// The clone only has the migrations a session applied by hand
// (apply-migrations.yml targets production), so a branch whose code needs its
// own migration must apply it to the clone first, or this reports the gap.
//
// DEV CLONE ONLY. It refuses production by ref and refuses anything that is not
// the clone. It writes nothing: every probe is a GET with limit=0.

import { describe, it, expect, beforeAll } from "vitest"
import path from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { collectSelects, type CollectedSelects, type SelectCall } from "@/scripts/lib/collect-postgrest-selects"

const CLONE_REF = "anjvztjiokcgiyhobknq"
const PROD_REF = "epzuvzkokzqtzomeyoha"

/** Everything that ships: the Next app, the Firebase functions and the render worker. */
const DEPLOYED_DIRS = ["lib", "app", "components", "functions/src", "render-worker/src"]

/**
 * Selects the extractor cannot resolve without guessing. Matched on file and
 * call text, not line, so unrelated edits above them do not churn this list.
 */
const KNOWN_UNRESOLVED: { file: string; text: string; why: string }[] = [
  {
    file: "lib/db/shop-variants.ts",
    text: 'query.select("id")',
    why: '`let query` is reassigned under a condition; the chain is from("shop_product_variants").update(...). The select is a bare id.',
  },
]

/**
 * Selects the live schema refuses TODAY, found by the first run of this test
 * on 2026-09-25 and left unfixed because each fix is a decision, not a typo.
 * Matched on file, table and error code. An entry that stops being refused
 * fails the test until it is removed, so this list cannot outlive its bugs.
 */
const KNOWN_REFUSED: { file: string; table: string; code: string; why: string }[] = [
  {
    file: "functions/src/ai/admin-tools.ts",
    table: "performance_assessments",
    code: "PGRST200",
    why:
      "Selects exercise_id, metric_type, value, unit, assessed_at and exercises(name), filtered on user_id — " +
      "none of which performance_assessments has (00048: client_user_id, title, status; per-exercise rows live " +
      "in a child table). The error is ignored, so the AI coach's client context has never included " +
      "assessments. Needs a rewrite against the real schema, not a rename.",
  },
  {
    file: "functions/src/seo/execute.ts",
    table: "profiles",
    code: "PGRST205",
    why:
      "There is no profiles table; users carries role. The SEO agent's flag-for-human action returns this " +
      "error every time, so no flag has reached the admin. Pointing it at users makes an untenanted " +
      "'first admin' reader live, which is a tenancy decision (G35), not a typo.",
  },
  {
    file: "functions/src/social-agent.ts",
    table: "profiles",
    code: "PGRST205",
    why: "Same missing profiles table: the 'no eligible topic' notification to the admin is never sent. See seo/execute.ts.",
  },
  {
    file: "functions/src/social-outcome-tracker.ts",
    table: "social_analytics",
    code: "42703",
    why:
      "engagement_rate and captured_at do not exist (00089 has engagement and recorded_at). The error is " +
      "ignored, so every social memo is scored on zero likes, comments, shares and impressions. Fixing it " +
      "changes impact_score and the agent_tool_baselines P95 the social agent learns from — the owner's call.",
  },
]

const CONCURRENCY = 8
const REPO_ROOT = path.resolve(__dirname, "../..")

function requireCloneClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must point at the dev clone. " +
        "This contract has NOT run.",
    )
  }
  if (url.includes(PROD_REF)) throw new Error(`Refusing to probe production (${PROD_REF}).`)
  if (!url.includes(CLONE_REF))
    throw new Error(`Refusing to probe ${url}: only the dev clone (${CLONE_REF}) is allowed.`)
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

type ProbeError = { code: string; message: string }

async function probe(
  client: SupabaseClient,
  schema: string | null,
  table: string,
  select: string,
): Promise<ProbeError | null> {
  for (let attempt = 0; ; attempt++) {
    const base = schema ? client.schema(schema) : client
    const { error } = await base.from(table).select(select).limit(0)
    if (!error) return null
    // No code means the request never got a PostgREST answer (network). Retry
    // once; a PostgREST or Postgres error is the answer and is not retried.
    if (!error.code && attempt === 0) continue
    return { code: error.code || "(no code)", message: error.message }
  }
}

function key(c: Pick<SelectCall, "schema" | "table" | "select">): string {
  // supabase-js strips whitespace outside quotes before sending, so two
  // selects that differ only in spacing are the same request.
  return `${c.schema ?? ""}|${c.table}|${c.select.replace(/\s+/g, "")}`
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

  // Positive controls. If PostgREST ever stopped resolving embeds or columns
  // under limit=0, every probe below would pass and prove nothing; these two
  // fail first in that case.
  it("control: the embed hint that took down the leads inbox is still refused (PGRST200)", async () => {
    const err = await probe(
      client,
      null,
      "funnel_submissions",
      "*, funnels:funnel_id(name, slug), funnel_steps:step_id(name)",
    )
    expect(err?.code).toBe("PGRST200")
  })

  it("control: a column that does not exist is still refused (42703)", async () => {
    const err = await probe(client, null, "funnel_submissions", "id, column_that_does_not_exist")
    expect(err?.code).toBe("42703")
  })

  it("collected the leads-inbox select that G31 broke", () => {
    // Matches the embed however it is spelled: the point is that the scan
    // reached it, not that it is currently correct — the probe decides that.
    const inbox = collected.calls.filter(
      (c) => c.file === "lib/db/funnel-leads.ts" && c.table === "funnel_submissions" && c.select.includes("funnels"),
    )
    expect(inbox.length).toBeGreaterThan(0)
  })

  it("collected selects from every deployed directory that has any", () => {
    const dirsWithCalls = new Set(DEPLOYED_DIRS.filter((d) => collected.calls.some((c) => c.file.startsWith(d + "/"))))
    expect([...dirsWithCalls].sort()).toEqual(["app", "functions/src", "lib", "render-worker/src"])
  })

  it("every select it could not resolve is on the known list, and the list has no stale entries", () => {
    const actual = collected.unresolved.map((u) => `${u.file} :: ${u.text}  (${u.reason}, line ${u.line})`)
    const found = collected.unresolved.map((u) => `${u.file} :: ${u.text}`)
    const known = KNOWN_UNRESOLVED.map((k) => `${k.file} :: ${k.text}`)
    expect(
      found.filter((f) => !known.includes(f)),
      `New unresolvable selects — make them resolvable or add them to KNOWN_UNRESOLVED:\n${actual.join("\n")}`,
    ).toEqual([])
    expect(
      known.filter((k) => !found.includes(k)),
      "KNOWN_UNRESOLVED names a select that is gone or now resolves — remove it",
    ).toEqual([])
  })

  describe("probing every collected select", () => {
    type Refusal = ProbeError & { schema: string | null; table: string; select: string; sites: SelectCall[] }
    let refusals: Refusal[] = []
    let probed = 0

    beforeAll(async () => {
      const sites = new Map<string, SelectCall[]>()
      for (const c of collected.calls) sites.set(key(c), [...(sites.get(key(c)) ?? []), c])
      const unique = [...sites.values()].map((s) => s[0])
      probed = unique.length
      const errors = await pool(unique, CONCURRENCY, (c) => probe(client, c.schema, c.table, c.select))
      refusals = unique.flatMap((c, i) => {
        const err = errors[i]
        return err ? [{ ...err, schema: c.schema, table: c.table, select: c.select, sites: sites.get(key(c))! }] : []
      })
    }, 180_000)

    const isKnown = (r: Refusal, file: string) =>
      KNOWN_REFUSED.some((k) => k.file === file && k.table === r.table && k.code === r.code)

    it("no select outside KNOWN_REFUSED is refused by the live schema", () => {
      const unknown = refusals.flatMap((r) =>
        r.sites
          .filter((s) => !isKnown(r, s.file))
          .map((s) => {
            const table = r.schema ? `${r.schema}.${r.table}` : r.table
            return `${r.code} at ${s.file}:${s.line} — ${table} select "${r.select.replace(/\s+/g, " ")}" — ${r.message}`
          }),
      )
      expect(
        unknown,
        `${unknown.length} select site(s) refused by the dev clone (${probed} distinct selects probed)`,
      ).toEqual([])
    })

    it("every KNOWN_REFUSED entry is still refused (remove the ones that were fixed)", () => {
      const stale = KNOWN_REFUSED.filter(
        (k) =>
          !refusals.some((r) => r.table === k.table && r.code === k.code && r.sites.some((s) => s.file === k.file)),
      ).map((k) => `${k.file} (${k.table}, ${k.code})`)
      expect(stale).toEqual([])
    })
  })
})
