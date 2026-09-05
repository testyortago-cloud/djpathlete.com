// @vitest-environment node
//
// lib/tenancy/platform.ts is a TRUTHFUL INVENTORY: every caller of
// platformBusinessId() is listed there under the shelf that names WHY it
// cannot (or need not) resolve a tenant. Nothing else enforces that the list
// is complete, and a seam whose inventory silently goes stale is worse than
// no inventory — phase 4's sweep is "the CANNOT RESOLVE YET shelf", and a
// caller missing from it is a caller phase 4 will not convert.
//
// This is deliberately a prose assertion on a comment. The callers are found
// on CODE lines only — a comment that mentions platformBusinessId() is not a
// caller — and platform.ts itself is excluded.
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.cwd()
const ROOTS = ["app", "lib", "components"]
const INVENTORY = "lib/tenancy/platform.ts"

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

function isCommentLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")
}

/** Repo-relative paths of every file with platformBusinessId() on a code line. */
function callers(): string[] {
  const hits: string[] = []
  for (const root of ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file)
      if (rel === INVENTORY) continue
      const calls = readFileSync(file, "utf8")
        .split("\n")
        .some((line) => !isCommentLine(line) && line.includes("platformBusinessId()"))
      if (calls) hits.push(rel)
    }
  }
  return hits.sort()
}

describe("lib/tenancy/platform.ts inventory", () => {
  it("has callers to inventory at all (presence control for the test below)", () => {
    expect(callers().length).toBeGreaterThan(10)
  })

  it("names every file that calls platformBusinessId(), so the seam list cannot silently go stale", () => {
    const inventory = readFileSync(join(ROOT, INVENTORY), "utf8")
    const missing = callers().filter((file) => !inventory.includes(file))
    expect(missing).toEqual([])
  })
})
