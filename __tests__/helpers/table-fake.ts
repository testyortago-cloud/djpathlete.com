// A small in-memory stand-in for the supabase-js query builder that APPLIES
// its filters, order and limit, so a test fails when the code under test
// forgets one. Covers only the calls the auth token DALs make: select /
// insert / update / delete, eq / is / gt / gte / lt, order, limit, single,
// maybeSingle. Timestamps compare as dates when both sides parse as one.
type Row = Record<string, unknown>
type Result = { data: unknown; error: { message: string } | null }

function cmp(a: unknown, b: unknown): number {
  const da = typeof a === "string" ? Date.parse(a) : NaN
  const db = typeof b === "string" ? Date.parse(b) : NaN
  if (!Number.isNaN(da) && !Number.isNaN(db)) return da - db
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

export function createTableFake(tables: Record<string, Row[]>, defaults: Record<string, () => Row> = {}) {
  return {
    from(table: string) {
      tables[table] ??= []
      const rows = tables[table]
      let op: "select" | "insert" | "update" | "delete" = "select"
      let payload: Row = {}
      let returning = false
      let mode: "many" | "single" | "maybeSingle" = "many"
      let orderBy: { col: string; asc: boolean } | null = null
      let limit: number | null = null
      const filters: ((r: Row) => boolean)[] = []

      function run(): Result {
        if (op === "insert") {
          const row = {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            ...(defaults[table]?.() ?? {}),
            ...payload,
          }
          rows.push(row)
          return shape([row])
        }
        const matched = rows.filter((r) => filters.every((f) => f(r)))
        if (op === "update") {
          for (const r of matched) Object.assign(r, payload)
          return returning ? shape(matched) : { data: null, error: null }
        }
        if (op === "delete") {
          for (const r of matched) rows.splice(rows.indexOf(r), 1)
          return returning ? shape(matched) : { data: null, error: null }
        }
        let out = [...matched]
        if (orderBy) {
          const { col, asc } = orderBy
          out.sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col]))
        }
        if (limit !== null) out = out.slice(0, limit)
        return shape(out)
      }

      function shape(out: Row[]): Result {
        const copies = out.map((r) => ({ ...r }))
        if (mode === "many") return { data: copies, error: null }
        if (copies.length > 1) return { data: null, error: { message: "multiple rows" } }
        if (copies.length === 0)
          return mode === "single" ? { data: null, error: { message: "no rows" } } : { data: null, error: null }
        return { data: copies[0], error: null }
      }

      const q = {
        select() {
          if (op !== "select") returning = true
          return q
        },
        insert(p: Row) {
          op = "insert"
          payload = p
          return q
        },
        update(p: Row) {
          op = "update"
          payload = p
          return q
        },
        delete() {
          op = "delete"
          return q
        },
        eq(c: string, v: unknown) {
          filters.push((r) => r[c] === v)
          return q
        },
        is(c: string, v: unknown) {
          filters.push((r) => (r[c] ?? null) === v)
          return q
        },
        gt(c: string, v: unknown) {
          filters.push((r) => cmp(r[c], v) > 0)
          return q
        },
        gte(c: string, v: unknown) {
          filters.push((r) => cmp(r[c], v) >= 0)
          return q
        },
        lt(c: string, v: unknown) {
          filters.push((r) => cmp(r[c], v) < 0)
          return q
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orderBy = { col, asc: opts?.ascending ?? true }
          return q
        },
        limit(n: number) {
          limit = n
          return q
        },
        single() {
          mode = "single"
          return q
        },
        maybeSingle() {
          mode = "maybeSingle"
          return q
        },
        then<T>(resolve: (r: Result) => T, reject?: (e: unknown) => T) {
          try {
            return Promise.resolve(run()).then(resolve, reject)
          } catch (e) {
            return Promise.reject(e).then(resolve, reject)
          }
        },
      }
      return q
    },
  }
}
