import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (f: string) => readFileSync(join(HERE, "..", f), "utf8")

/**
 * Prod job cKrLezpw, 2026-10-02. The coach wrote "30-90sec rest / 4-2-4 tempo"
 * for the session and a POWER block with "full recovery (120-180s rest),
 * maximum intent". The rewrite turned the first into "Every exercise: …", and
 * the AI judge held the power exercises to it, so the week could not pass. Both
 * prompts must say that a rule written for a group wins for that group. These
 * are prompt texts, so this only pins the sentence; the dev-clone replay of
 * that job is the proof that a model honours it.
 */
describe("a group's own rules beat the general prescription", () => {
  it("the rewrite keeps the general prescription off the group that has its own", () => {
    const src = read("instruction-enrich.ts")
    expect(src).toContain("All other exercises:")
    expect(src).toMatch(/POWER block/)
  })

  it("the judge applies the general prescription only to exercises without their own rules", () => {
    const src = read("instruction-check.ts")
    expect(src).toMatch(/own rules for a group[\s\S]{0,200}judge the general/)
  })
})
