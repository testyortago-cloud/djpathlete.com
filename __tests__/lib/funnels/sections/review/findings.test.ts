// __tests__/lib/funnels/sections/review/findings.test.ts
//
// The merge is the only logic in findings.ts, and it has one property worth
// protecting: truncation must drop the LEAST severe finding, never whatever
// happened to arrive last. A reviser that never sees `cta-divergence` because
// three copy-polish notes got there first is a reviser that fixes the page's
// commas and leaves it pointing at two different offers.

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { AUDIT_CODES, findingSchema, mergeFindings, type Finding } from "@/lib/funnels/sections/review/findings"

function f(over: Partial<Finding> = {}): Finding {
  return {
    code: "tone-run",
    severity: "high",
    sectionIds: ["a", "b"],
    issue: "issue",
    suggestion: "suggestion",
    source: "audit",
    ...over,
  }
}

describe("mergeFindings", () => {
  it("dedupes on code + section set regardless of section order", () => {
    const merged = mergeFindings(
      [[f({ sectionIds: ["a", "b"] })], [f({ sectionIds: ["b", "a"], source: "art" })]],
      24,
    )
    expect(merged).toHaveLength(1)
  })

  it("does not merge the same code on different sections", () => {
    const merged = mergeFindings([[f({ sectionIds: ["a", "b"] }), f({ sectionIds: ["c", "d"] })]], 24)
    expect(merged).toHaveLength(2)
  })

  it("keeps the highest severity when deduping", () => {
    const merged = mergeFindings([[f({ severity: "low" })], [f({ severity: "high", source: "art" })]], 24)
    expect(merged[0].severity).toBe("high")
  })

  it("orders high before medium before low", () => {
    const merged = mergeFindings(
      [
        [
          f({ code: "c-low", severity: "low" }),
          f({ code: "c-high", severity: "high" }),
          f({ code: "c-med", severity: "medium" }),
        ],
      ],
      24,
    )
    expect(merged.map((x) => x.code)).toEqual(["c-high", "c-med", "c-low"])
  })

  it("truncates to max by dropping the LEAST severe, not the last to arrive", () => {
    const merged = mergeFindings([[f({ code: "drop", severity: "low" }), f({ code: "keep", severity: "high" })]], 1)
    expect(merged.map((x) => x.code)).toEqual(["keep"])
  })

  it("returns an empty list for no input rather than throwing", () => {
    expect(mergeFindings([], 24)).toEqual([])
    expect(mergeFindings([[], []], 24)).toEqual([])
  })
})

describe("findingSchema", () => {
  it("rejects an empty issue — an unnamed problem is unactionable", () => {
    expect(findingSchema.safeParse(f({ issue: "" })).success).toBe(false)
  })

  it("rejects an empty suggestion — the reviser can only act on a specific one", () => {
    expect(findingSchema.safeParse(f({ suggestion: "" })).success).toBe(false)
  })

  it("rejects a source the pipeline does not stamp", () => {
    expect(findingSchema.safeParse({ ...f(), source: "somebody-else" }).success).toBe(false)
  })
})

describe("the leaf boundary", () => {
  // This module reaches the browser through build-stream.ts. An import of the
  // Anthropic SDK here would construct a provider at module scope inside the
  // client bundle, and it would still build green — the exact failure
  // builder-config.ts carries a header about.
  it("imports nothing but zod", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/funnels/sections/review/findings.ts"), "utf8")
    const imports = [...source.matchAll(/^import .*? from "([^"]+)"/gm)].map((match) => match[1])
    expect(imports).toEqual(["zod"])
  })
})

describe("AUDIT_CODES", () => {
  it("has no duplicates", () => {
    expect(new Set(AUDIT_CODES).size).toBe(AUDIT_CODES.length)
  })
})
