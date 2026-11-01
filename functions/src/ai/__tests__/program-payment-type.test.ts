import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// A program with no price must be stored as "free". Leaving payment_type to the column default
// stored "one_time" with a null price, which the Edit Program dialog then refuses to save
// ("Price is required for paid programs") while the card shows "Free". Migration 00298 makes the
// default "free"; the orchestrator says which one it means so a priced program stays "one_time".
describe("AI program payment_type", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../orchestrator.ts"), "utf8")

  it("is set from the price on the insert", () => {
    expect(src).toContain('payment_type: request.price_cents ? "one_time" : "free",')
  })
})
