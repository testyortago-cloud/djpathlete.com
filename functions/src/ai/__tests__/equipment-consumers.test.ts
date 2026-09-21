import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * Both orchestrators narrow the exercise library to `effectiveEquipment`, but
 * two OTHER consumers used to read a separate `availableEquipment` binding that
 * only honoured an explicit override — not a restriction read out of the coach's
 * instructions:
 *
 *   1. the Exercise Selector's `Constraints: { available_equipment }` block,
 *      which told the model it had a 23-item gym while its library had been cut
 *      to bodyweight. That contradictory pairing is the shape of the original
 *      bug and the model has no way to resolve it.
 *   2. `dedupAssignmentsInPlace`'s `equipment`, which the swapper uses to CHOOSE
 *      replacement exercises — so a swap could put a dumbbell exercise back into
 *      a bodyweight week, after every filter had run.
 *
 * Neither is reachable from a unit test without standing up the whole pipeline,
 * and the full functions suite stayed green through the bug. This is a
 * structural guard instead: the binding is gone, and both consumers name the
 * resolved set.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const FILES = ["week-orchestrator.ts", "orchestrator.ts"] as const

/** Source with comments removed, so prose mentioning a name is not a match. */
function codeOf(file: string): string {
  const raw = readFileSync(join(HERE, "..", file), "utf8")
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/^\s*\/\/.*$/gm, "") // whole-line comments
    .replace(/([^:])\/\/.*$/gm, "$1") // trailing comments (not "https://")
}

describe.each(FILES)("%s — equipment consumers read the resolved set", (file) => {
  const code = codeOf(file)

  it("has no `availableEquipment` binding left", () => {
    // It only ever honoured request.equipment_override, so a typed restriction
    // ("hotel, bodyweight only") left it holding the client's full gym.
    expect(code).not.toContain("availableEquipment")
  })

  it("tells the Exercise Selector the effective set, not the profile", () => {
    // Anchored to constraintsContext on purpose. An earlier, LEGITIMATE
    // `available_equipment: profile.available_equipment` describes the client to
    // the Profile Analyzer; an unanchored match finds that one and passes for
    // the wrong reason.
    const match = code.match(/const constraintsContext[\s\S]{0,300}?available_equipment:\s*([\w.]+)/)
    expect(match, `${file} no longer builds a constraintsContext`).not.toBeNull()
    expect(match![1]).toBe("effectiveEquipment")
  })

  it("gives the dedup swapper the effective set, so a swap cannot reintroduce kit", () => {
    const match = code.match(/dedupAssignmentsInPlace\([\s\S]{0,400}?equipment:\s*(\w+)/)
    expect(match, `${file} no longer calls dedupAssignmentsInPlace with equipment`).not.toBeNull()
    expect(match![1]).toBe("effectiveEquipment")
  })

  it("still resolves equipment through the shared precedence rule", () => {
    expect(code).toContain("resolveEffectiveEquipment(")
  })
})
