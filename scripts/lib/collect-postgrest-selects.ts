// scripts/lib/collect-postgrest-selects.ts — find every PostgREST select in the
// source, so __tests__/integration/postgrest-select-contract.test.ts can run
// each one against the dev clone's LIVE schema.
//
// WHY. Every DAL unit test mocks PostgREST, so none of them can see a select
// string the real server refuses. G31 shipped exactly that: an embed hint
// (`funnels:funnel_id`) that could not resolve against a composite foreign
// key. PostgREST answered PGRST200 and the leads inbox 500'd for every tenant
// while every mocked suite passed. A `limit=0` GET with the same select
// reproduces that error without reading a row, so the live check needs only
// what this module extracts: the table, the select string, and the `.order()`
// columns in the same chain (an ORDER BY on a missing column answers 42703
// too, and G25's refund lookup had exactly that bug in its order clause).
//
// REAL SCOPES, NO TYPE CHECKING. Every file goes into one in-memory TypeScript
// program with `noResolve` and `noLib`, so nothing is imported or type-checked
// and `functions/src` (its own tsconfig) reads the same as `lib/`. The binder
// is still used, because a name-only lookup resolves a parameter, a `let` or a
// destructured binding to whatever same-named `const` sits elsewhere in the
// file — a probe that passes for the wrong reason. A name resolves only when
// its ONE declaration is a `const` with an initializer.
//
// NEVER SILENTLY SKIPPED. A select whose table, select string, schema,
// receiver or order column cannot be resolved is returned in `unresolved`
// with the reason, so the contract test can list what it did NOT check.
//
// KNOWN LIMITS, stated rather than hidden: an `.order()` applied to a builder
// in a LATER statement (`query = query.order(col)`) is not in the select's
// chain and is not seen; a client created with `createClient(..., { db: {
// schema } })` is taken to use the default schema. Neither occurs in the
// deployed code today.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"

export interface OrderColumn {
  column: string
  /** From `{ referencedTable }` (or the older `{ foreignTable }`): the embed the column belongs to. */
  referencedTable: string | null
}

export interface SelectCall {
  file: string
  line: number
  /** From `.schema("x")` in the chain; null is PostgREST's default schema. */
  schema: string | null
  table: string
  select: string
  orders: OrderColumn[]
}

export interface UnresolvedSelect {
  file: string
  line: number
  reason: string
  text: string
}

export interface CollectedSelects {
  calls: SelectCall[]
  unresolved: UnresolvedSelect[]
}

const VIRTUAL_ROOT = "/__repo__/"

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isTypeAssertionExpression(e) ||
    ts.isNonNullExpression(e)
  ) {
    e = e.expression
  }
  return e
}

/**
 * The initializer an identifier stands for, or null unless the identifier's
 * one declaration is a `const` with an initializer. Parameters, `let`, `var`,
 * destructured bindings, loop variables and imports all come back null.
 */
function constInitializer(id: ts.Identifier, checker: ts.TypeChecker): ts.Expression | null {
  const declarations = checker.getSymbolAtLocation(id)?.declarations
  if (!declarations || declarations.length !== 1) return null
  const d = declarations[0]
  if (!ts.isVariableDeclaration(d) || !ts.isIdentifier(d.name) || !d.initializer) return null
  return ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const ? d.initializer : null
}

/** True when `expr` is a builder chain (`x.eq(...).not(...)`) whose root is `symbol` itself. */
function chainRootedAt(expr: ts.Expression, symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  let e = unwrap(expr)
  while (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) e = unwrap(e.expression.expression)
  return ts.isIdentifier(e) && checker.getSymbolAtLocation(e) === symbol
}

const selfBuildingCache = new WeakMap<ts.VariableDeclaration, boolean>()

/**
 * A `let` builder is followed to its initializer only when every write to it
 * builds on itself (`query = query.eq(...)`): then its table and select never
 * change. One `query = supabase.from("other")` and it is not followed at all.
 */
function onlyEverBuildsOnItself(decl: ts.VariableDeclaration, checker: ts.TypeChecker): boolean {
  const cached = selfBuildingCache.get(decl)
  if (cached !== undefined) return cached
  const symbol = checker.getSymbolAtLocation(decl.name)
  let ok = Boolean(symbol)
  const visit = (n: ts.Node): void => {
    if (!ok) return
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const left = unwrap(n.left)
      if (ts.isIdentifier(left) && checker.getSymbolAtLocation(left) === symbol) {
        if (n.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !chainRootedAt(n.right, symbol!, checker)) ok = false
      }
    }
    ts.forEachChild(n, visit)
  }
  if (ok) visit(decl.getSourceFile())
  selfBuildingCache.set(decl, ok)
  return ok
}

/** The initializer a builder variable stands for: any `const`, or a `let` that only builds on itself. */
function builderInitializer(id: ts.Identifier, checker: ts.TypeChecker): ts.Expression | null {
  const declarations = checker.getSymbolAtLocation(id)?.declarations
  if (!declarations || declarations.length !== 1) return null
  const d = declarations[0]
  if (!ts.isVariableDeclaration(d) || !ts.isIdentifier(d.name) || !d.initializer) return null
  if (ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const) return d.initializer
  return onlyEverBuildsOnItself(d, checker) ? d.initializer : null
}

function resolveString(expr: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Node> = new Set()): string | null {
  const e = unwrap(expr)
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
  if (ts.isTemplateExpression(e)) {
    let out = e.head.text
    for (const span of e.templateSpans) {
      const part = resolveString(span.expression, checker, seen)
      if (part === null) return null
      out += part + span.literal.text
    }
    return out
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveString(e.left, checker, seen)
    const right = resolveString(e.right, checker, seen)
    return left === null || right === null ? null : left + right
  }
  if (ts.isIdentifier(e)) {
    const init = constInitializer(e, checker)
    if (!init || seen.has(init)) return null
    return resolveString(init, checker, new Set([...seen, init]))
  }
  return null
}

type ChainEnd =
  /** `select` is the first `.select()` met on the way down, if any. */
  | { kind: "from"; call: ts.CallExpression; select: ts.CallExpression | null }
  | { kind: "rpc" }
  | { kind: "unknown"; receiver: ts.Expression; sawCall: boolean }

/** Walk a builder chain back from a receiver to the `.from()` that opened it. */
function findChainStart(receiver: ts.Expression, checker: ts.TypeChecker): ChainEnd {
  let e = unwrap(receiver)
  let sawCall = false
  let select: ts.CallExpression | null = null
  const seen = new Set<ts.Node>()
  for (;;) {
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      const method = e.expression.name.text
      if (method === "from") return { kind: "from", call: e, select }
      if (method === "rpc") return { kind: "rpc" }
      if (method === "select" && !select) select = e
      sawCall = true
      e = unwrap(e.expression.expression)
      continue
    }
    if (ts.isIdentifier(e)) {
      const init = builderInitializer(e, checker)
      if (init && !seen.has(init)) {
        seen.add(init)
        e = unwrap(init)
        continue
      }
    }
    return { kind: "unknown", receiver: e, sawCall }
  }
}

/**
 * The schema `.from()` is called in: a `.schema("x")` call on its receiver,
 * followed through `const` receivers. null is the default schema; undefined
 * means a `.schema()` whose argument could not be resolved.
 */
function schemaOf(fromCall: ts.CallExpression, checker: ts.TypeChecker): string | null | undefined {
  let owner = unwrap((fromCall.expression as ts.PropertyAccessExpression).expression)
  const seen = new Set<ts.Node>()
  for (;;) {
    if (
      ts.isCallExpression(owner) &&
      ts.isPropertyAccessExpression(owner.expression) &&
      owner.expression.name.text === "schema"
    ) {
      const arg = owner.arguments[0]
      return arg ? (resolveString(arg, checker) ?? undefined) : undefined
    }
    if (ts.isIdentifier(owner)) {
      const init = builderInitializer(owner, checker)
      if (init && !seen.has(init)) {
        seen.add(init)
        owner = unwrap(init)
        continue
      }
    }
    return null
  }
}

/** True when an `.order()` call's own chain passes through a `.select()` — the select's visit covers it. */
function isChainedAfterSelect(orderCall: ts.CallExpression): boolean {
  let e = unwrap((orderCall.expression as ts.PropertyAccessExpression).expression)
  while (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    if (e.expression.name.text === "select") return true
    e = unwrap(e.expression.expression)
  }
  return false
}

/** Every `.order()` call chained after this select, outermost last. */
function ordersAfter(selectCall: ts.CallExpression): ts.CallExpression[] {
  const orders: ts.CallExpression[] = []
  let node: ts.Node = selectCall
  for (;;) {
    const access = node.parent
    if (!access || !ts.isPropertyAccessExpression(access) || access.expression !== node) break
    const call = access.parent
    if (!call || !ts.isCallExpression(call) || call.expression !== access) break
    if (access.name.text === "order") orders.push(call)
    node = call
  }
  return orders
}

function referencedTableOf(options: ts.Expression | undefined, checker: ts.TypeChecker): string | null | undefined {
  if (!options) return null
  const o = unwrap(options)
  if (!ts.isObjectLiteralExpression(o)) return undefined
  for (const p of o.properties) {
    if (
      ts.isPropertyAssignment(p) &&
      ts.isIdentifier(p.name) &&
      (p.name.text === "referencedTable" || p.name.text === "foreignTable")
    ) {
      return resolveString(p.initializer, checker) ?? undefined
    }
  }
  return null
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > 200 ? flat.slice(0, 197) + "..." : flat
}

function collectFromSourceFile(file: string, sf: ts.SourceFile, checker: ts.TypeChecker): CollectedSelects {
  const calls: SelectCall[] = []
  const unresolved: UnresolvedSelect[] = []
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

  /** Resolve one `.order()` call, reporting it when its column or embed cannot be. */
  const resolveOrder = (order: ts.CallExpression): OrderColumn | null => {
    const colArg = order.arguments[0]
    const column = colArg ? resolveString(colArg, checker) : null
    const referencedTable = referencedTableOf(order.arguments[1], checker)
    const line = lineOf((order.expression as ts.PropertyAccessExpression).name)
    const text = oneLine(order.getText(sf))
    if (column === null) {
      const what = colArg ? oneLine(colArg.getText(sf)) : "(none)"
      unresolved.push({ file, line, reason: `order column is not a constant: ${what}`, text })
      return null
    }
    if (referencedTable === undefined) {
      unresolved.push({ file, line, reason: "order referencedTable is not a constant", text })
      return null
    }
    return { column, referencedTable }
  }

  /** Table, schema and select of a chain that reached from(), or the reason it cannot be resolved. */
  const resolveChain = (
    start: Extract<ChainEnd, { kind: "from" }>,
    selectCall: ts.CallExpression | null,
  ): { schema: string | null; table: string; select: string } | { reason: string } => {
    const tableArg = start.call.arguments[0]
    const table = tableArg ? resolveString(tableArg, checker) : null
    if (table === null)
      return { reason: `table is not a constant: ${tableArg ? oneLine(tableArg.getText(sf)) : "(none)"}` }
    const schema = schemaOf(start.call, checker)
    if (schema === undefined) return { reason: "schema is not a constant" }
    const selectArg = selectCall?.arguments[0]
    const select = selectArg ? resolveString(selectArg, checker) : "*"
    if (select === null) return { reason: `select is not a constant: ${oneLine(selectArg!.getText(sf))}` }
    return { schema, table, select }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text

      if (method === "select") {
        const line = lineOf(node.expression.name)
        const report = (reason: string) => unresolved.push({ file, line, reason, text: oneLine(node.getText(sf)) })
        const start = findChainStart(node.expression.expression, checker)
        if (start.kind === "from") {
          const chain = resolveChain(start, node)
          if ("reason" in chain) report(chain.reason)
          else {
            const orders = ordersAfter(node)
              .map(resolveOrder)
              .filter((o): o is OrderColumn => o !== null)
            calls.push({ file, line, ...chain, orders })
          }
        } else if (start.kind === "unknown" && (node.arguments.length > 0 || start.sawCall)) {
          // A bare `.select()` straight off a property or identifier with no
          // call in the chain is HTMLInputElement.select(), not PostgREST.
          // Anything else that is not traceable to a from() is reported.
          report(`receiver is not a from() chain: ${oneLine(start.receiver.getText(sf))}`)
        }
      } else if (method === "order" && !isChainedAfterSelect(node)) {
        // An order on a builder held in a variable (`query.order(...)` after
        // `let query = supabase.from(t).select(s)`) is not in any select's
        // chain, so it is probed on its own: the table and select its builder
        // was opened with, plus this one order.
        const line = lineOf(node.expression.name)
        const report = (reason: string) => unresolved.push({ file, line, reason, text: oneLine(node.getText(sf)) })
        const start = findChainStart(node.expression.expression, checker)
        if (start.kind === "from") {
          const chain = resolveChain(start, start.select)
          if ("reason" in chain) report(chain.reason)
          else {
            const order = resolveOrder(node)
            if (order) calls.push({ file, line, ...chain, orders: [order] })
          }
        } else if (start.kind === "unknown") {
          report(`order receiver is not a from() chain: ${oneLine(start.receiver.getText(sf))}`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { calls, unresolved }
}

/** Collect from in-memory sources keyed by repo-relative path, in one program. */
function collectFromSources(sources: Map<string, string>): CollectedSelects {
  const byPath = new Map([...sources].map(([rel, text]) => [VIRTUAL_ROOT + rel, text]))
  const host: ts.CompilerHost = {
    getSourceFile: (fileName, languageVersion) => {
      const text = byPath.get(fileName)
      if (text === undefined) return undefined
      const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      return ts.createSourceFile(fileName, text, languageVersion, true, kind)
    },
    getDefaultLibFileName: () => VIRTUAL_ROOT + "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => VIRTUAL_ROOT,
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => byPath.has(f),
    readFile: (f) => byPath.get(f),
  }
  const program = ts.createProgram(
    [...byPath.keys()],
    {
      noResolve: true,
      noLib: true,
      types: [],
      noEmit: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.Latest,
      // Every deployed file is an ES module. Without this, a file with no
      // import/export parses as a SCRIPT, where top-level `await (x)` is a
      // call to a function named `await` and the chain behind it is lost.
      moduleDetection: ts.ModuleDetectionKind.Force,
    },
    host,
  )
  const checker = program.getTypeChecker()
  const calls: SelectCall[] = []
  const unresolved: UnresolvedSelect[] = []
  for (const rel of sources.keys()) {
    const sf = program.getSourceFile(VIRTUAL_ROOT + rel)
    if (!sf) throw new Error(`collect-postgrest-selects: ${rel} did not load into the program`)
    const out = collectFromSourceFile(rel, sf, checker)
    calls.push(...out.calls)
    unresolved.push(...out.unresolved)
  }
  return { calls, unresolved }
}

export function collectSelectsFromSource(file: string, text: string): CollectedSelects {
  return collectFromSources(new Map([[file, text]]))
}

const SKIP_DIRS = new Set(["node_modules", "__tests__"])
const SOURCE = /\.tsx?$/
const NOT_SOURCE = /\.(test|spec)\.tsx?$|\.d\.ts$/

/**
 * Every select under `dirs` (relative to `root`), with repo-relative paths.
 * Test files are skipped because their `.from()` chains run against mocks,
 * not the database this contract checks.
 */
export function collectSelects(root: string, dirs: string[]): CollectedSelects {
  const sources = new Map<string, string>()
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (SKIP_DIRS.has(name)) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (SOURCE.test(name) && !NOT_SOURCE.test(name))
        sources.set(relative(root, path), readFileSync(path, "utf8"))
    }
  }
  for (const dir of dirs) walk(join(root, dir))
  return collectFromSources(sources)
}
