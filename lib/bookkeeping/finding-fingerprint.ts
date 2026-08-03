// Pure identity fingerprint for insight-finding dismissals (5b, decision B-1).
// "<finder>:<key>" — identity only, NEVER amounts: aggregate totals grow nightly
// (income-sync) and an amount-bearing hash would resurface every dismissal
// within a day. Keys per finder (design §2.1): watchlist → account uuid;
// substantiation_gap/uncategorized/watchdog → entry uuid;
// vendor → normalizeCounterparty(vendor key); year_end → literal flag id;
// duplicate → sorted entry uuid pair.
// Client-safe: zero IO, imported by both the routes and InsightsClient.
//
// The union is exactly the set of finders that HAVE a dismiss control. The
// design also sketched a "home_office" member, but the home-office card is a
// PROPOSAL the coach tunes with a percent, not a finding anyone can dismiss —
// no call site ever produced or consumed that fingerprint, so the type no
// longer advertises it. Re-add it (here and in the dismissable-card list in
// InsightsClient + the narrative route's filter) the day that card grows a
// dismiss button; an unused member only invites a fingerprint nothing reads.
import { normalizeCounterparty } from "./insight-types"

export type FinderKind =
  | "watchlist"
  | "substantiation_gap"
  | "uncategorized"
  | "vendor"
  | "year_end"
  | "watchdog"
  | "duplicate"

export function findingFingerprint(finder: FinderKind, key: string): string {
  const stableKey = finder === "vendor" ? (normalizeCounterparty(key) ?? key) : key
  return `${finder}:${stableKey}`
}

/** Pair fingerprint for the ledger duplicate scan — order-independent, identity only. */
export function duplicatePairFingerprint(idA: string, idB: string): string {
  return findingFingerprint("duplicate", [idA, idB].sort().join("|"))
}
