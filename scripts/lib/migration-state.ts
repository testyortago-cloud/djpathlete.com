// The database state the migrations DESCRIBE, read from the files alone, and a
// comparison of it with what a live database reports from its catalogs.
//
// Used by __tests__/integration/dev-clone-drift.test.ts (G46). The dev clone is
// written to by hand — scripts/migrations/apply.mjs refuses it, so each session
// POSTs its own migration — and its supabase_migrations ledger cannot be
// trusted to say what ran: on 2026-09-26 it listed 00256 while the clone ran an
// older save_sequence_steps body, and it did not list 00231, whose RLS was off.
// This reads the catalogs instead of the ledger.
//
// WHAT IS DESCRIBED, per object, as of the LAST migration (in filename order)
// that touches it:
//   - functions: the body between the dollar quotes, and SECURITY DEFINER or not.
//     A later DROP FUNCTION removes the expectation.
//   - row level security: the last ENABLE / DISABLE ROW LEVEL SECURITY per table.
//   - policies: every CREATE POLICY not later dropped (DROP POLICY, or DROP TABLE).
//
// WHAT IT CANNOT SEE: anything created with dynamic SQL (EXECUTE format(...)),
// grants, columns, indexes, triggers, a function's argument list or its
// search_path, and overloads (functions are keyed on schema.name, so only the
// last definition of a name is expected). Statements inside a DO block are read
// as if unconditional.

export interface MigrationFile {
  name: string
  sql: string
}

export interface ExpectedFunction {
  file: string
  body: string
  securityDefiner: boolean
}

export interface MigrationState {
  functions: Map<string, ExpectedFunction>
  /** "schema.table" -> the file that last set it, and whether RLS ends up on. */
  rls: Map<string, { file: string; enabled: boolean }>
  /** "schema.table|policy name" -> the file that created it. */
  policies: Map<string, { file: string }>
}

/**
 * Replaces every comment with spaces of the same length, leaving string
 * literals and dollar-quoted bodies intact, so offsets into the result are
 * offsets into the input.
 */
export function maskComments(sql: string): string {
  let out = ""
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i)
      const stop = end === -1 ? sql.length : end
      out += " ".repeat(stop - i)
      i = stop
    } else if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2)
      const stop = end === -1 ? sql.length : end + 2
      out += sql.slice(i, stop).replace(/[^\n]/g, " ")
      i = stop
    } else if (c === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") break
        else j++
      }
      out += sql.slice(i, j + 1)
      i = j + 1
    } else if (c === "$") {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)
      if (!tag) {
        out += c
        i++
        continue
      }
      // A dollar-quoted string: copy it verbatim, comments inside included.
      // Masking inside it is the caller's business (normalizeCode recurses).
      const end = sql.indexOf(tag[0], i + tag[0].length)
      const stop = end === -1 ? sql.length : end + tag[0].length
      out += sql.slice(i, stop)
      i = stop
    } else {
      out += c
      i++
    }
  }
  return out
}

/**
 * A function body reduced to its code: comments removed (outside string
 * literals, and inside nested dollar quotes too), whitespace collapsed. Two
 * bodies that differ only in comments or layout normalise to the same string.
 */
export function normalizeCode(body: string): string {
  let out = ""
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (c === "-" && body[i + 1] === "-") {
      const end = body.indexOf("\n", i)
      i = end === -1 ? body.length : end
      out += " "
    } else if (c === "/" && body[i + 1] === "*") {
      const end = body.indexOf("*/", i + 2)
      i = end === -1 ? body.length : end + 2
      out += " "
    } else if (c === "'") {
      let j = i + 1
      while (j < body.length) {
        if (body[j] === "'" && body[j + 1] === "'") j += 2
        else if (body[j] === "'") break
        else j++
      }
      out += body.slice(i, j + 1)
      i = j + 1
    } else if (c === "$") {
      const tag = body.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)
      if (!tag) {
        out += c
        i++
        continue
      }
      const start = i + tag[0].length
      const end = body.indexOf(tag[0], start)
      const inner = end === -1 ? body.slice(start) : body.slice(start, end)
      out += `${tag[0]}${normalizeCode(inner)}${tag[0]}`
      i = end === -1 ? body.length : end + tag[0].length
    } else if (/\s/.test(c)) {
      while (i < body.length && /\s/.test(body[i])) i++
      out += " "
    } else {
      out += c
      i++
    }
  }
  return out.replace(/\s+/g, " ").trim()
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)`
const QNAME = String.raw`(?:${IDENT}\s*\.\s*)?${IDENT}`

function unquote(id: string): string {
  return id.startsWith('"') ? id.slice(1, -1) : id.toLowerCase()
}

/** "public.x", "x" or '"realtime"."messages"' -> "schema.name", defaulting to public. */
export function qualify(name: string): string {
  const [first = "", second] = name.match(new RegExp(IDENT, "g")) ?? []
  return second === undefined ? `public.${unquote(first)}` : `${unquote(first)}.${unquote(second)}`
}

type Event =
  | { at: number; kind: "fn"; key: string; fn: ExpectedFunction }
  | { at: number; kind: "dropfn"; key: string }
  | { at: number; kind: "rls"; key: string; enabled: boolean }
  | { at: number; kind: "policy"; key: string }
  | { at: number; kind: "droppolicy"; key: string }
  | { at: number; kind: "droptable"; key: string }

function eventsOf(file: MigrationFile): Event[] {
  const raw = file.sql
  const masked = maskComments(raw)
  const events: Event[] = []

  // Function definitions. The body is taken from the RAW text, comments and all,
  // because that is what the server stores (pg_proc.prosrc).
  const bodies: [number, number][] = []
  const fnRe = new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?function\s+(${QNAME})\s*\(`, "gi")
  for (const m of masked.matchAll(fnRe)) {
    const from = m.index!
    const open = masked.slice(from).match(/\bAS\s+(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)/i)
    if (!open) continue
    const tag = open[1]
    const bodyStart = from + open.index! + open[0].length
    const bodyEnd = raw.indexOf(tag, bodyStart)
    if (bodyEnd === -1) continue
    const afterBody = bodyEnd + tag.length
    const semi = masked.indexOf(";", afterBody)
    const header = masked.slice(from, bodyStart) + masked.slice(afterBody, semi === -1 ? masked.length : semi)
    events.push({
      at: from,
      kind: "fn",
      key: qualify(m[1]),
      fn: {
        file: file.name,
        body: raw.slice(bodyStart, bodyEnd),
        securityDefiner: /\bsecurity\s+definer\b/i.test(header),
      },
    })
    bodies.push([bodyStart, bodyEnd])
  }

  // Table-level statements, looked for outside every function body.
  let outside = masked
  for (const [s, e] of bodies) outside = outside.slice(0, s) + " ".repeat(e - s) + outside.slice(e)

  const patterns: [RegExp, (m: RegExpMatchArray) => Event][] = [
    [
      new RegExp(String.raw`\bdrop\s+function\s+(?:if\s+exists\s+)?(${QNAME})`, "gi"),
      (m) => ({ at: m.index!, kind: "dropfn", key: qualify(m[1]) }),
    ],
    [
      new RegExp(
        String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QNAME})\s+(enable|disable)\s+row\s+level\s+security`,
        "gi",
      ),
      (m) => ({ at: m.index!, kind: "rls", key: qualify(m[1]), enabled: m[2].toLowerCase() === "enable" }),
    ],
    [
      new RegExp(String.raw`\bcreate\s+policy\s+(${IDENT})\s+on\s+(${QNAME})`, "gi"),
      (m) => ({ at: m.index!, kind: "policy", key: `${qualify(m[2])}|${unquote(m[1])}` }),
    ],
    [
      new RegExp(String.raw`\bdrop\s+policy\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+(${QNAME})`, "gi"),
      (m) => ({ at: m.index!, kind: "droppolicy", key: `${qualify(m[2])}|${unquote(m[1])}` }),
    ],
    [
      new RegExp(String.raw`\bdrop\s+table\s+(?:if\s+exists\s+)?(${QNAME})`, "gi"),
      (m) => ({ at: m.index!, kind: "droptable", key: qualify(m[1]) }),
    ],
  ]
  for (const [re, make] of patterns) for (const m of outside.matchAll(re)) events.push(make(m))

  return events.sort((a, b) => a.at - b.at)
}

/** Replays the files in the order given. Pass them sorted by filename. */
export function readMigrationState(files: MigrationFile[]): MigrationState {
  const state: MigrationState = { functions: new Map(), rls: new Map(), policies: new Map() }
  for (const file of files) {
    for (const e of eventsOf(file)) {
      switch (e.kind) {
        case "fn":
          state.functions.set(e.key, e.fn)
          break
        case "dropfn":
          state.functions.delete(e.key)
          break
        case "rls":
          state.rls.set(e.key, { file: file.name, enabled: e.enabled })
          break
        case "policy":
          state.policies.set(e.key, { file: file.name })
          break
        case "droppolicy":
          state.policies.delete(e.key)
          break
        case "droptable":
          state.rls.delete(e.key)
          for (const k of [...state.policies.keys()]) if (k.startsWith(`${e.key}|`)) state.policies.delete(k)
          break
      }
    }
  }
  return state
}

export interface LiveState {
  /** One row per pg_proc entry: overloads appear as several rows of one name. */
  functions: { schema: string; name: string; src: string; securityDefiner: boolean }[]
  tables: { schema: string; name: string; rlsEnabled: boolean }[]
  policies: { schema: string; table: string; name: string }[]
}

export type Drift =
  | { kind: "function_missing"; object: string; file: string }
  | { kind: "function_code_differs"; object: string; file: string }
  | { kind: "function_security_differs"; object: string; file: string; expected: "definer" | "invoker" }
  | { kind: "table_missing"; object: string; file: string }
  | { kind: "rls_differs"; object: string; file: string; expected: "on" | "off" }
  | { kind: "policy_missing"; object: string; file: string }

/**
 * Every way the live database differs from what the migrations describe.
 * Function bodies are compared on their code alone (normalizeCode): a body that
 * differs only in comments or layout behaves identically and is not drift.
 */
export function findDrift(expected: MigrationState, live: LiveState): Drift[] {
  const drift: Drift[] = []
  const fns = new Map<string, LiveState["functions"]>()
  for (const f of live.functions) {
    const k = `${f.schema}.${f.name}`
    fns.set(k, [...(fns.get(k) ?? []), f])
  }
  const tables = new Map(live.tables.map((t) => [`${t.schema}.${t.name}`, t]))
  const policies = new Set(live.policies.map((p) => `${p.schema}.${p.table}|${p.name}`))

  for (const [object, fn] of expected.functions) {
    const candidates = fns.get(object)
    if (!candidates) {
      drift.push({ kind: "function_missing", object, file: fn.file })
      continue
    }
    const want = normalizeCode(fn.body)
    const same = candidates.filter((c) => normalizeCode(c.src) === want)
    if (same.length === 0) drift.push({ kind: "function_code_differs", object, file: fn.file })
    else if (!same.some((c) => c.securityDefiner === fn.securityDefiner))
      drift.push({
        kind: "function_security_differs",
        object,
        file: fn.file,
        expected: fn.securityDefiner ? "definer" : "invoker",
      })
  }

  const missingTables = new Set<string>()
  for (const [object, { file, enabled }] of expected.rls) {
    const t = tables.get(object)
    if (!t) {
      missingTables.add(object)
      drift.push({ kind: "table_missing", object, file })
    } else if (t.rlsEnabled !== enabled) drift.push({ kind: "rls_differs", object, file, expected: enabled ? "on" : "off" })
  }
  for (const [object, { file }] of expected.policies) {
    const table = object.split("|")[0]
    if (!tables.has(table)) {
      if (!missingTables.has(table)) {
        missingTables.add(table)
        drift.push({ kind: "table_missing", object: table, file })
      }
    } else if (!policies.has(object)) drift.push({ kind: "policy_missing", object, file })
  }
  return drift
}
