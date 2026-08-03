// Pure candidate-pair generator for the post-hoc ledger duplicate scan
// (design: docs/superpowers/specs/2026-08-03-ledger-duplicate-scan-design.md).
// Pairs entries with the same direction + exact amount within a 7-day window;
// the AI route judges, this module only pairs. Dismissed fingerprints are
// filtered HERE so dismissals gate both display and AI spend. Zero IO.
import type { LedgerDirection, LedgerSource } from "@/types/database"
import { duplicatePairFingerprint } from "./finding-fingerprint"
import { normalizeDescription } from "./statement-parse"

export interface DuplicateScanEntry {
  id: string
  occurred_on: string
  amount_cents: number
  direction: LedgerDirection
  memo: string | null
  counterparty: string | null
  source: LedgerSource
  account_id: string | null
  document_id: string | null
}

export type MemoSimilarity = "exact" | "similar" | "different" | "missing"

export interface CandidatePair {
  pair_id: string
  fingerprint: string
  a: DuplicateScanEntry
  b: DuplicateScanEntry
  day_gap: number
  same_source: boolean
  memo_similarity: MemoSimilarity
}

const DEFAULT_WINDOW_DAYS = 7
const DEFAULT_MAX_PAIRS = 40

/** `YYYY-MM-DD` → whole UTC days since epoch (statement-dedupe precedent — never local Date math). */
function toUtcDays(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** Stable pair id for AI round-tripping — sorted uuid join, same key as the fingerprint. */
export function pairId(idA: string, idB: string): string {
  return [idA, idB].sort().join("|")
}

function descriptor(e: DuplicateScanEntry): string {
  return [e.counterparty, e.memo].filter(Boolean).join(" ")
}

function memoSimilarity(a: DuplicateScanEntry, b: DuplicateScanEntry): MemoSimilarity {
  const na = normalizeDescription(descriptor(a))
  const nb = normalizeDescription(descriptor(b))
  if (!na || !nb) return "missing"
  if (na === nb) return "exact"
  if (na.includes(nb) || nb.includes(na)) return "similar"
  const aTokens = new Set(na.split(/\s+/).filter(Boolean))
  const bTokens = new Set(nb.split(/\s+/).filter(Boolean))
  const union = new Set([...aTokens, ...bTokens])
  if (union.size === 0) return "missing"
  let hit = 0
  for (const t of aTokens) if (bTokens.has(t)) hit++
  return hit / union.size >= 0.5 ? "similar" : "different"
}

/**
 * Same direction + exact amount + gap <= windowDays. Overlapping pairs allowed
 * (A can appear in A-B and A-C — deleting A clears both in the UI). Output is
 * deterministic: entries sorted (occurred_on, id), pairs sorted by earliest
 * member, capped at maxPairs with `truncated` set.
 */
export function findCandidatePairs(
  entries: DuplicateScanEntry[],
  dismissedFingerprints: ReadonlySet<string>,
  opts?: { windowDays?: number; maxPairs?: number },
): { pairs: CandidatePair[]; truncated: boolean } {
  const windowDays = opts?.windowDays ?? DEFAULT_WINDOW_DAYS
  const maxPairs = opts?.maxPairs ?? DEFAULT_MAX_PAIRS

  const sorted = [...entries].sort(
    (x, y) => x.occurred_on.localeCompare(y.occurred_on) || x.id.localeCompare(y.id),
  )
  const groups = new Map<string, DuplicateScanEntry[]>()
  for (const e of sorted) {
    const key = `${e.direction}:${e.amount_cents}`
    const g = groups.get(key)
    if (g) g.push(e)
    else groups.set(key, [e])
  }

  const all: CandidatePair[] = []
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const gap = toUtcDays(group[j].occurred_on) - toUtcDays(group[i].occurred_on)
        if (gap > windowDays) break // group is date-sorted — later j only grows the gap
        const fingerprint = duplicatePairFingerprint(group[i].id, group[j].id)
        if (dismissedFingerprints.has(fingerprint)) continue
        all.push({
          pair_id: pairId(group[i].id, group[j].id),
          fingerprint,
          a: group[i],
          b: group[j],
          day_gap: gap,
          same_source: group[i].source === group[j].source,
          memo_similarity: memoSimilarity(group[i], group[j]),
        })
      }
    }
  }

  all.sort(
    (p, q) =>
      p.a.occurred_on.localeCompare(q.a.occurred_on) ||
      p.a.id.localeCompare(q.a.id) ||
      p.b.id.localeCompare(q.b.id),
  )
  const truncated = all.length > maxPairs
  return { pairs: truncated ? all.slice(0, maxPairs) : all, truncated }
}
