import { describe, it, expect } from "vitest"
import { duplicatePairFingerprint } from "@/lib/bookkeeping/finding-fingerprint"
import {
  findCandidatePairs,
  pairId,
  type DuplicateScanEntry,
} from "@/lib/bookkeeping/duplicate-scan"

// Distinct amounts/dates per case so a mutated window or amount check FAILS
// loudly (tests_that_cannot_fail).
let seq = 0
function entry(over: Partial<DuplicateScanEntry>): DuplicateScanEntry {
  seq += 1
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    occurred_on: "2026-07-01",
    amount_cents: 5000,
    direction: "expense",
    memo: null,
    counterparty: null,
    source: "manual",
    account_id: null,
    ...over,
  }
}
const NONE = new Set<string>()

describe("duplicatePairFingerprint", () => {
  it("is order-independent and prefixed with the finder", () => {
    const f1 = duplicatePairFingerprint("bbb", "aaa")
    const f2 = duplicatePairFingerprint("aaa", "bbb")
    expect(f1).toBe(f2)
    expect(f1).toBe("duplicate:aaa|bbb")
  })
})

describe("findCandidatePairs", () => {
  it("pairs same direction + exact amount within 7 days", () => {
    const a = entry({ occurred_on: "2026-07-01", amount_cents: 4321 })
    const b = entry({ occurred_on: "2026-07-08", amount_cents: 4321 })
    const { pairs, truncated } = findCandidatePairs([a, b], NONE)
    expect(pairs).toHaveLength(1)
    expect(truncated).toBe(false)
    expect(pairs[0].pair_id).toBe(pairId(a.id, b.id))
    expect(pairs[0].day_gap).toBe(7)
  })

  it("rejects a pair 8 days apart", () => {
    const a = entry({ occurred_on: "2026-07-01", amount_cents: 4321 })
    const b = entry({ occurred_on: "2026-07-09", amount_cents: 4321 })
    expect(findCandidatePairs([a, b], NONE).pairs).toHaveLength(0)
  })

  it("rejects cross-direction and cross-amount pairs", () => {
    const a = entry({ amount_cents: 4321, direction: "expense" })
    const b = entry({ amount_cents: 4321, direction: "income" })
    const c = entry({ amount_cents: 4322, direction: "expense" })
    expect(findCandidatePairs([a, b, c], NONE).pairs).toHaveLength(0)
  })

  it("pairs income too (double-counted income matters)", () => {
    const a = entry({ direction: "income", amount_cents: 9999 })
    const b = entry({ direction: "income", amount_cents: 9999, occurred_on: "2026-07-03" })
    expect(findCandidatePairs([a, b], NONE).pairs).toHaveLength(1)
  })

  it("allows overlapping pairs (A-B and A-C)", () => {
    const a = entry({ occurred_on: "2026-07-02", amount_cents: 777 })
    const b = entry({ occurred_on: "2026-07-03", amount_cents: 777 })
    const c = entry({ occurred_on: "2026-07-04", amount_cents: 777 })
    const { pairs } = findCandidatePairs([a, b, c], NONE)
    expect(pairs).toHaveLength(3) // A-B, A-C, B-C
  })

  it("filters pairs whose fingerprint is dismissed BEFORE returning", () => {
    const a = entry({ amount_cents: 606 })
    const b = entry({ amount_cents: 606, occurred_on: "2026-07-02" })
    const dismissed = new Set([duplicatePairFingerprint(a.id, b.id)])
    expect(findCandidatePairs([a, b], dismissed).pairs).toHaveLength(0)
  })

  it("orders deterministically and caps at maxPairs with truncated=true", () => {
    // 10 same-amount entries on one day = 45 raw pairs
    const entries = Array.from({ length: 10 }, () => entry({ amount_cents: 123 }))
    const { pairs, truncated } = findCandidatePairs(entries, NONE, { maxPairs: 40 })
    expect(pairs).toHaveLength(40)
    expect(truncated).toBe(true)
    const again = findCandidatePairs(entries, NONE, { maxPairs: 40 })
    expect(again.pairs.map((p) => p.pair_id)).toEqual(pairs.map((p) => p.pair_id))
  })

  it("annotates memo similarity from counterparty+memo text", () => {
    const exactA = entry({ amount_cents: 1111, counterparty: "Rogue Fitness", memo: "bands" })
    const exactB = entry({ amount_cents: 1111, counterparty: "Rogue Fitness", memo: "bands", occurred_on: "2026-07-02" })
    expect(findCandidatePairs([exactA, exactB], NONE).pairs[0].memo_similarity).toBe("exact")

    const subA = entry({ amount_cents: 2222, memo: "ROGUE FITNESS ORDER 4417" })
    const subB = entry({ amount_cents: 2222, memo: "rogue fitness", occurred_on: "2026-07-02" })
    expect(findCandidatePairs([subA, subB], NONE).pairs[0].memo_similarity).toBe("similar")

    const difA = entry({ amount_cents: 3333, memo: "starbucks coffee" })
    const difB = entry({ amount_cents: 3333, memo: "shell gasoline fuel", occurred_on: "2026-07-02" })
    expect(findCandidatePairs([difA, difB], NONE).pairs[0].memo_similarity).toBe("different")

    const misA = entry({ amount_cents: 4444 })
    const misB = entry({ amount_cents: 4444, occurred_on: "2026-07-02" })
    expect(findCandidatePairs([misA, misB], NONE).pairs[0].memo_similarity).toBe("missing")
  })

  it("flags same_source pairs (double import) and cross-source pairs alike", () => {
    const a = entry({ amount_cents: 8181, source: "statement_import" })
    const b = entry({ amount_cents: 8181, source: "statement_import", occurred_on: "2026-07-02" })
    const c = entry({ amount_cents: 8181, source: "receipt", occurred_on: "2026-07-03" })
    const { pairs } = findCandidatePairs([a, b, c], NONE)
    expect(pairs).toHaveLength(3)
    const ab = pairs.find((p) => p.pair_id === pairId(a.id, b.id))
    const ac = pairs.find((p) => p.pair_id === pairId(a.id, c.id))
    expect(ab?.same_source).toBe(true)
    expect(ac?.same_source).toBe(false)
  })
})
