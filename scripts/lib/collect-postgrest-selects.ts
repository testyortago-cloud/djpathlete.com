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
// the (table, select) pairs this module extracts.
//
// PARSE-ONLY, on purpose. It uses the TypeScript parser but not the type
// checker, so it reads `functions/src` (its own tsconfig) the same way it
// reads `lib/`, and one file never needs another to compile. The cost is that
// constants are resolved by name within a file, so a name declared twice with
// different values is refused rather than guessed: a guessed select string is
// a probe that passes for the wrong reason.
//
// NEVER SILENTLY SKIPPED. A select whose table, select string or receiver
// cannot be resolved is returned in `unresolved` with the reason, so the
// contract test can list what it did NOT check.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"

export interface SelectCall {
  file: string
  line: number
  /** From `.schema("x")` in the chain; null is PostgREST's default schema. */
  schema: string | null
  table: string
  select: string
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

type Consts = Map<string, ts.Expression[]>

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

function collectConsts(sf: ts.SourceFile): Consts {
  const consts: Consts = new Map()
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      node.parent.flags & ts.NodeFlags.Const
    ) {
      const list = consts.get(node.name.text) ?? []
      list.push(node.initializer)
      consts.set(node.name.text, list)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return consts
}

/**
 * The single initializer a const name stands for, or null when the name is
 * unknown or declared more than once with initializers that differ.
 */
function soleInitializer(name: string, consts: Consts): ts.Expression | null {
  const inits = consts.get(name)
  if (!inits || inits.length === 0) return null
  const first = inits[0].getText()
  return inits.every((i) => i.getText() === first) ? inits[0] : null
}

function resolveString(expr: ts.Expression, consts: Consts, seen: Set<string> = new Set()): string | null {
  const e = unwrap(expr)
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
  if (ts.isTemplateExpression(e)) {
    let out = e.head.text
    for (const span of e.templateSpans) {
      const part = resolveString(span.expression, consts, seen)
      if (part === null) return null
      out += part + span.literal.text
    }
    return out
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveString(e.left, consts, seen)
    const right = resolveString(e.right, consts, seen)
    return left === null || right === null ? null : left + right
  }
  if (ts.isIdentifier(e)) {
    if (seen.has(e.text)) return null
    const init = soleInitializer(e.text, consts)
    return init ? resolveString(init, consts, new Set([...seen, e.text])) : null
  }
  return null
}

type ChainEnd =
  | { kind: "from"; call: ts.CallExpression }
  | { kind: "rpc" }
  | { kind: "unknown"; receiver: ts.Expression }

/** Walk a builder chain back from `.select`'s receiver to the `.from()` that opened it. */
function findChainStart(receiver: ts.Expression, consts: Consts): ChainEnd {
  let e = unwrap(receiver)
  const seen = new Set<string>()
  for (;;) {
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      const method = e.expression.name.text
      if (method === "from") return { kind: "from", call: e }
      if (method === "rpc") return { kind: "rpc" }
      e = unwrap(e.expression.expression)
      continue
    }
    if (ts.isIdentifier(e) && !seen.has(e.text)) {
      const init = soleInitializer(e.text, consts)
      if (init) {
        seen.add(e.text)
        e = unwrap(init)
        continue
      }
    }
    return { kind: "unknown", receiver: e }
  }
}

function schemaOf(fromCall: ts.CallExpression, consts: Consts): string | null | undefined {
  const owner = unwrap((fromCall.expression as ts.PropertyAccessExpression).expression)
  if (
    ts.isCallExpression(owner) &&
    ts.isPropertyAccessExpression(owner.expression) &&
    owner.expression.name.text === "schema"
  ) {
    const arg = owner.arguments[0]
    return arg ? (resolveString(arg, consts) ?? undefined) : undefined
  }
  return null
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > 200 ? flat.slice(0, 197) + "..." : flat
}

export function collectSelectsFromSource(file: string, text: string): CollectedSelects {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const consts = collectConsts(sf)
  const calls: SelectCall[] = []
  const unresolved: UnresolvedSelect[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "select"
    ) {
      const line = sf.getLineAndCharacterOfPosition(node.expression.name.getStart(sf)).line + 1
      const report = (reason: string) => unresolved.push({ file, line, reason, text: oneLine(node.getText(sf)) })
      const start = findChainStart(node.expression.expression, consts)

      if (start.kind === "from") {
        const tableArg = start.call.arguments[0]
        const table = tableArg ? resolveString(tableArg, consts) : null
        const selectArg = node.arguments[0]
        const select = selectArg ? resolveString(selectArg, consts) : "*"
        const schema = schemaOf(start.call, consts)
        if (table === null) report(`table is not a constant: ${tableArg ? oneLine(tableArg.getText(sf)) : "(none)"}`)
        else if (schema === undefined) report("schema is not a constant")
        else if (select === null) report(`select is not a constant: ${oneLine(selectArg!.getText(sf))}`)
        else calls.push({ file, line, schema, table, select })
      } else if (start.kind === "unknown" && node.arguments.length > 0) {
        // A no-argument .select() on something that is not a from() chain is
        // HTMLInputElement.select(), not PostgREST; only a select WITH a
        // column list is plausibly a builder this module cannot trace.
        report(`receiver is not a from() chain: ${oneLine(start.receiver.getText(sf))}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { calls, unresolved }
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
  const calls: SelectCall[] = []
  const unresolved: UnresolvedSelect[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".") || SKIP_DIRS.has(name)) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (SOURCE.test(name) && !NOT_SOURCE.test(name)) {
        const out = collectSelectsFromSource(relative(root, path), readFileSync(path, "utf8"))
        calls.push(...out.calls)
        unresolved.push(...out.unresolved)
      }
    }
  }
  for (const dir of dirs) walk(join(root, dir))
  return { calls, unresolved }
}
