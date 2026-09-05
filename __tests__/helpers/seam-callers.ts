// Shared by the seam-inventory tests. A "seam" here is a function whose doc
// comment is a TRUTHFUL INVENTORY of its callers (lib/tenancy/platform.ts,
// lib/tenancy/public.ts); the tests over it need one walker, so the forward
// check ("every caller is named") and the reverse check ("every named path
// still calls") read the same relation each way.
//
// The match is on the IDENTIFIER, not on the literal call `name()`.
// lib/bookings/calendly-tenant.ts reaches platformBusinessId as
// `(deps.platformBusinessId ?? platformBusinessId)()` — the function passed as
// a VALUE, with no `()` against the name. A literal-call match reported that
// file as a non-caller: a real caller invisible to the check that exists to
// find them. A bare `import` line is skipped because importing a symbol is
// not using it; every real caller has the identifier on at least one other
// line, so the skip costs nothing and stops a leftover import from being
// reported as a caller. Comment lines are skipped so prose ABOUT a seam is
// never mistaken for a use of it.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

export const SEAM_ROOTS = ["app", "lib", "components"] as const

export function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

export function isCommentLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")
}

/**
 * Repo-relative paths of every file under app/, lib/ and components/ that
 * references `identifier` on a code line, excluding `excludeFile` (the seam's
 * own file, which defines it). Sorted.
 */
export function callersOf(identifier: string, excludeFile: string, root: string = process.cwd()): string[] {
  const hits: string[] = []
  for (const seamRoot of SEAM_ROOTS) {
    for (const file of walk(join(root, seamRoot))) {
      const rel = relative(root, file)
      if (rel === excludeFile) continue
      const refs = readFileSync(file, "utf8")
        .split("\n")
        .some((line) => {
          if (isCommentLine(line)) return false
          if (line.trim().startsWith("import ")) return false
          return line.includes(identifier)
        })
      if (refs) hits.push(rel)
    }
  }
  return hits.sort()
}
