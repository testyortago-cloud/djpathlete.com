// The UNTENANTED BY SCHEMA shelf of lib/tenancy/platform.ts, as data.
//
// One list, read by two tests so they cannot drift apart:
//   - the platform inventory test proves each entry is still TRUE in the code
//     and in the migrations, and that the shelf's prose names it;
//   - the live PostgREST select contract proves each table still has no
//     `business_id` column on the dev clone, which is the only check that
//     sees a column added outside supabase/migrations.
//
// An entry is a READER of a table that has no `business_id` column, on a
// surface more than one business can reach. It goes stale in exactly two
// ways, and each must fail a test rather than leave a false sentence on the
// shelf:
//   - the reader is converted or deleted, so the read the entry describes is
//     no longer inside the function it names (`functionBody`);
//   - the table gains the column, so "untenanted by schema" stops being true
//     (`statementsAddingBusinessId` over the migrations here; the 42703 probe
//     in the select contract for everything else).
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type UntenantedRead = {
  /** Repo-relative path of the file the read sits in. */
  file: string
  /** The top-level function containing the read; "GET"/"POST" for a route handler. */
  fn: string
  /** The table read. It must have NO `business_id` column. */
  table: string
  /**
   * What must still appear inside `fn` for the entry to be true. Defaults to
   * `.from("<table>")`. An entry whose function reaches the table through a
   * DAL call names that call instead.
   */
  reads?: string
  /** The ledger row that owns the decision. */
  row: string
  /** Other paths the shelf's paragraph names for this entry: the pages and routes that reach it. */
  surfaces?: string[]
}

/**
 * One row per (file, function, table). A function that reads three tables is
 * three rows, because each table can gain its column on its own. Grouped by
 * the shelf's paragraphs, in the design's order (S1-S12,
 * docs/superpowers/specs/2026-09-25-g35-untenanted-readers-design.md §D1).
 */
export const UNTENANTED_BY_SCHEMA: UntenantedRead[] = [
  // S1 — the programme list, the programme page, analytics.
  {
    file: "lib/db/programs.ts",
    fn: "getPrograms",
    table: "programs",
    row: "G37",
    surfaces: ["app/(admin)/admin/programs/page.tsx", "app/(admin)/admin/analytics/page.tsx"],
  },
  { file: "lib/db/programs.ts", fn: "getAllPrograms", table: "programs", row: "G37" },
  {
    file: "lib/db/programs.ts",
    fn: "getProgramById",
    table: "programs",
    row: "G37",
    surfaces: ["app/(admin)/admin/programs/[id]/page.tsx"],
  },
  // S2 — the programme list's counts and completion rate.
  { file: "lib/db/assignments.ts", fn: "getAssignments", table: "program_assignments", row: "G37" },
  { file: "lib/db/assignments.ts", fn: "getAssignmentCountsByProgram", table: "program_assignments", row: "G37" },
  // S3 — the copy-sources route: three tables, three rows.
  { file: "app/api/admin/programs/copy-sources/route.ts", fn: "GET", table: "programs", row: "G37" },
  { file: "app/api/admin/programs/copy-sources/route.ts", fn: "GET", table: "program_assignments", row: "G37" },
  { file: "app/api/admin/programs/copy-sources/route.ts", fn: "GET", table: "users", row: "G37" },
  // S4 — the client roster behind the assign picker.
  { file: "lib/db/users.ts", fn: "getClients", table: "users", row: "G37" },
  // S5 — the pipeline's grantable programmes.
  {
    file: "lib/db/pipeline.ts",
    fn: "listGrantablePrograms",
    table: "programs",
    row: "G37",
    surfaces: ["app/(admin)/admin/pipeline/page.tsx", "app/api/admin/pipeline/grant/route.ts"],
  },
  // S6 — the contact record's payments leg.
  {
    file: "lib/db/contact-detail.ts",
    fn: "getContactDetail",
    table: "payments",
    row: "G04",
    surfaces: ["app/(admin)/admin/contacts/[id]/page.tsx"],
  },
  // S7 — the funnel catalogue. Reaches both tables through aliased DAL
  // readers, so the needle is the call. Its FAQ read is NOT here: that one is
  // gated on the seam (the NARROWER VARIANT shelf).
  {
    file: "lib/funnels/sections/resolve.ts",
    fn: "loadCatalogues",
    table: "programs",
    reads: "listAllPrograms()",
    row: "G31",
  },
  {
    file: "lib/funnels/sections/resolve.ts",
    fn: "loadCatalogues",
    table: "session_pack_products",
    reads: "listAllSessionPackProducts()",
    row: "G31",
  },
  // S8 (public funnel checkout) left the shelf with G40: the route now reads
  // only a product id its page's published version offers, so the one way a
  // cross-business programme reaches it is the `loadCatalogues` entry above.
  // S9 — attribution keyed on a user_id that spans businesses.
  {
    file: "lib/db/marketing-attribution.ts",
    fn: "findAttributionForContact",
    table: "marketing_attribution",
    row: "G42",
    surfaces: ["app/api/stripe/webhook/route.ts", "lib/bookings/ingest.ts"],
  },
  // S10 — one newsletter list for every business.
  {
    file: "lib/db/newsletter.ts",
    fn: "getActiveSubscribers",
    table: "newsletter_subscribers",
    row: "G38",
    surfaces: ["app/(admin)/admin/newsletter/page.tsx"],
  },
  {
    file: "lib/db/newsletter.ts",
    fn: "getAllSubscribers",
    table: "newsletter_subscribers",
    row: "G38",
    surfaces: ["app/(admin)/admin/newsletter/subscribers/page.tsx"],
  },
  // S11 — the platform's waiver on every business's public surfaces.
  {
    file: "lib/db/legal-documents.ts",
    fn: "getActiveDocument",
    table: "legal_documents",
    row: "G43",
    surfaces: [
      "components/funnels/islands/FormIsland.tsx",
      "app/(marketing)/camps/page.tsx",
      "app/(marketing)/clinics/page.tsx",
    ],
  },
  // S12 — one inquiry by id.
  {
    file: "lib/db/lead-inquiries.ts",
    fn: "getLeadInquiryById",
    table: "lead_inquiries",
    row: "G45",
    surfaces: ["app/api/admin/leads/[id]/regenerate-analysis/route.ts"],
  },
]

/** Every table on the shelf, once each, sorted. */
export function untenantedTables(): string[] {
  return [...new Set(UNTENANTED_BY_SCHEMA.map((e) => e.table))].sort()
}

/**
 * The source of top-level function `fn`: from its declaration to the first
 * line after it that is nothing but `}`. Prettier closes a top-level function
 * on such a line and indents everything inside it, so this is the function
 * and nothing after it. "Nothing but" matters: a multi-line parameter type
 * closes in column 0 too — `}): Promise<…> {` in `findAttributionForContact`
 * — and stopping there would slice off the whole body. Null when there is no
 * such declaration, so a renamed reader reads as stale instead of matching
 * somewhere else in the file.
 *
 * Function-scoped on purpose: lib/db/programs.ts contains `.from("programs")`
 * eight times, so a whole-file search would keep an entry "true" long after
 * its own reader was converted. The `\s*[(<]` after the name is the other
 * half: without it `getPrograms` would also find `getProgramsCount`.
 */
export function functionBody(source: string, fn: string): string | null {
  const decl = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${fn}\\s*[(<]`, "m").exec(source)
  if (!decl) return null
  const rest = source.slice(decl.index)
  const end = rest.search(/^\}[ \t]*$/m)
  return end === -1 ? null : rest.slice(0, end + 1)
}

/**
 * `functionBody` plus everything since the previous line that is nothing but
 * `}` -- the close of the top-level block before it. That is where the
 * function's doc comment sits, so a note may be written there or at the read
 * inside the body, and either counts. It stops at the previous block on
 * purpose: a note on the function ABOVE must not count for this one.
 */
export function functionRegion(source: string, fn: string): string | null {
  const body = functionBody(source, fn)
  if (body === null) return null
  const start = source.indexOf(body)
  const closes = [...source.slice(0, start).matchAll(/^\}[ \t]*$/gm)]
  const from = closes.length > 0 ? (closes[closes.length - 1].index ?? 0) + 1 : 0
  return source.slice(from, start + body.length)
}

/**
 * Whether `entry`'s function says IN PLACE that its table has no
 * `business_id`, and which ledger row owns that: "`<table>` … no
 * `business_id`" inside one sentence, plus the row id, anywhere in
 * `functionRegion`. Comment markers and line breaks are flattened first, so a
 * note wrapped across lines still matches.
 */
export function hasInPlaceNote(entry: UntenantedRead, root: string = process.cwd()): boolean {
  const region = functionRegion(readFileSync(join(root, entry.file), "utf8"), entry.fn)
  if (region === null) return false
  const prose = region.replace(/\n[ \t]*(?:\/\/|\*)?[ \t]*/g, " ")
  return (
    new RegExp("`" + entry.table + "`[^.]*?\\bno `business_id`", "i").test(prose) &&
    new RegExp(`\\b${entry.row}\\b`).test(prose)
  )
}

/**
 * The statements in one migration's SQL that give `table` a `business_id`
 * column. Comments are stripped and the text split on `;` FIRST, so a
 * `business_id` in a comment, or in the next statement about another table,
 * cannot match. Three shapes:
 *   alter table T … add [column] [if not exists] business_id
 *   alter table T … rename [column] x to business_id
 *   create table T ( … business_id … )
 * T may be schema-qualified and quoted, and must END where the name ends, so
 * `programs` never matches `programs_archive`.
 *
 * A column added by dynamic SQL (`execute format('alter table %I …')`) is
 * invisible here. The select contract's 42703 probe is what sees that.
 */
export function statementsAddingBusinessId(sql: string, table: string): string[] {
  const t = `(?:"?public"?\\.)?"?${table}"?`
  const alter = `\\balter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${t}\\s`
  const shapes = [
    new RegExp(`${alter}[\\s\\S]*?\\badd\\s+(?:column\\s+)?(?:if\\s+not\\s+exists\\s+)?"?business_id"?\\b`, "i"),
    new RegExp(`${alter}[\\s\\S]*?\\brename\\s+(?:column\\s+)?"?\\w+"?\\s+to\\s+"?business_id"?\\b`, "i"),
    new RegExp(`\\bcreate\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${t}\\s*\\([\\s\\S]*?\\bbusiness_id\\b`, "i"),
  ]
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ")
  return code
    .split(";")
    .map((s) => s.trim())
    .filter((s) => shapes.some((re) => re.test(s)))
}

const migrationsByRoot = new Map<string, { name: string; sql: string }[]>()

function migrations(root: string): { name: string; sql: string }[] {
  let list = migrationsByRoot.get(root)
  if (!list) {
    const dir = join(root, "supabase/migrations")
    list = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }))
    migrationsByRoot.set(root, list)
  }
  return list
}

/** "<migration file>: <statement head>" for every statement that gives `table` a `business_id`. */
export function migrationsAddingBusinessId(table: string, root: string = process.cwd()): string[] {
  return migrations(root).flatMap(({ name, sql }) =>
    statementsAddingBusinessId(sql, table).map((s) => `${name}: ${s.replace(/\s+/g, " ").slice(0, 100)}`),
  )
}

/**
 * Why `entry` no longer describes the code, or [] when it still does. The
 * same function judges the real list and the test's control fixtures, so a
 * control that fails here proves the real entries went through a check that
 * CAN fail.
 */
export function staleReasons(entry: UntenantedRead, root: string = process.cwd()): string[] {
  const where = `${entry.file} · ${entry.fn} · ${entry.table}`
  const path = join(root, entry.file)
  if (!existsSync(path)) return [`${where}: the file does not exist`]
  const reasons: string[] = []
  const body = functionBody(readFileSync(path, "utf8"), entry.fn)
  const needle = entry.reads ?? `.from("${entry.table}")`
  if (body === null) reasons.push(`${where}: no top-level function ${entry.fn}`)
  else if (!body.includes(needle)) reasons.push(`${where}: ${entry.fn} no longer contains ${needle}`)
  for (const hit of migrationsAddingBusinessId(entry.table, root)) {
    reasons.push(`${where}: a migration gives ${entry.table} a business_id — ${hit}`)
  }
  for (const surface of entry.surfaces ?? []) {
    if (!existsSync(join(root, surface))) reasons.push(`${where}: surface ${surface} does not exist`)
  }
  return reasons
}
