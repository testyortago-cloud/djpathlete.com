// @vitest-environment node
//
// G45. Migration 00279 seeds the same `sequences.key` and `pipelines.key`
// values (e.g. 'assessment') for every business, so a lookup by key alone
// stops naming one row the moment a second business exists. Three operator
// scripts did exactly that:
//   - repair-failed-sequence-runs.mjs (the 73-run incident's repair tool) read
//     its sequence by key, and then filed its timeline rows with no
//     business_id, which DEFAULTS to the platform's id;
//   - the two smoke-g29-pipeline-settings-prod scripts read the 'assessment'
//     board by key, then compared it with (or, in the writing one, reordered)
//     whichever board the admin page showed.
// Each now takes a required --business and looks its row up through
// scripts/_business-scope.mjs.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { findByKeyForBusiness, parseBusinessId, readBusinessArg } from "../../scripts/_business-scope.mjs"

const A = "aaaaaaaa-0000-4000-8000-00000000000a"
const B = "bbbbbbbb-0000-4000-8000-00000000000b"

function fakeClient(rows: Record<string, unknown>[], error: { message: string } | null = null) {
  const calls: { table: string; col: string; val: unknown }[] = []
  return {
    calls,
    from: (table: string) => {
      let current = [...rows]
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          calls.push({ table, col, val })
          current = current.filter((r) => r[col] === val)
          return q
        },
        maybeSingle: async () => {
          if (error) return { data: null, error }
          if (current.length > 1) return { data: null, error: { message: "multiple rows returned" } }
          return { data: current[0] ?? null, error: null }
        },
      }
      return q
    },
  }
}

describe("findByKeyForBusiness", () => {
  const ROWS = [
    { id: "pipe-b", key: "assessment", business_id: B },
    { id: "pipe-a", key: "assessment", business_id: A },
  ]

  it("finds the named business's row when every business shares the key", async () => {
    const client = fakeClient(ROWS)
    const row = await findByKeyForBusiness(client, "pipelines", { businessId: A, key: "assessment", select: "id, key" })
    expect(row?.id).toBe("pipe-a")
  })

  it("filters on the business_id VALUE it was given", async () => {
    const client = fakeClient(ROWS)
    await findByKeyForBusiness(client, "pipelines", { businessId: B, key: "assessment", select: "id" })
    expect(client.calls).toContainEqual({ table: "pipelines", col: "business_id", val: B })
    expect(client.calls).toContainEqual({ table: "pipelines", col: "key", val: "assessment" })
  })

  it("returns null when this business has no such row", async () => {
    const client = fakeClient([{ id: "pipe-b", key: "assessment", business_id: B }])
    expect(
      await findByKeyForBusiness(client, "pipelines", { businessId: A, key: "assessment", select: "id" }),
    ).toBeNull()
  })

  it("throws a read error instead of answering 'not found'", async () => {
    const client = fakeClient(ROWS, { message: "permission denied" })
    await expect(
      findByKeyForBusiness(client, "pipelines", { businessId: A, key: "assessment", select: "id" }),
    ).rejects.toThrow(/permission denied/)
  })

  it("refuses to run without a valid business id", async () => {
    const client = fakeClient(ROWS)
    await expect(
      findByKeyForBusiness(client, "pipelines", { businessId: "", key: "assessment", select: "id" }),
    ).rejects.toThrow(/business/)
  })
})

describe("--business", () => {
  it("reads a UUID", () => {
    expect(readBusinessArg(["--business", A])).toBe(A)
    expect(parseBusinessId(A)).toBe(A)
  })

  it.each([
    ["missing", []],
    ["with no value", ["--business"]],
    ["not a UUID", ["--business", "djp"]],
    ["given twice", ["--business", A, "--business", B]],
  ])("refuses a --business that is %s", (_label, argv) => {
    expect(() => readBusinessArg(argv as string[])).toThrow(/--business/)
  })
})

describe("the three scripts look rows up through the business scope", () => {
  const SCRIPTS = [
    "scripts/repair-failed-sequence-runs.mjs",
    "scripts/smoke-g29-pipeline-settings-prod.mjs",
    "scripts/smoke-g29-pipeline-settings-prod-readonly.mjs",
  ]
  const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8")

  it.each(SCRIPTS)("%s has no lookup by key alone", (file) => {
    expect(source(file)).not.toMatch(/\.eq\(\s*["']key["']/)
    expect(source(file)).toMatch(/findByKeyForBusiness\(/)
  })

  it.each(SCRIPTS.slice(1))("%s shows the page the SAME business it read", (file) => {
    // The page renders whichever business the admin session selects; the
    // djp_business cookie is what selects it. Without it the script compares
    // (or reorders) one business's board against another's.
    expect(source(file)).toMatch(/name:\s*"djp_business",\s*value:\s*BUSINESS/)
  })

  it("the repair script files its timeline rows under the business it repaired", () => {
    // contact_timeline_events.business_id DEFAULTS to the platform's id, so an
    // insert without it files another business's contact under the platform.
    const text = source("scripts/repair-failed-sequence-runs.mjs")
    const insert = text.slice(text.indexOf('from("contact_timeline_events").insert('))
    expect(insert.slice(0, 400)).toMatch(/business_id:\s*args\.businessId/)
  })
})
