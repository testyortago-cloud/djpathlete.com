// Pure identity fingerprint for insight-finding dismissals (5b, decision B-1).
// "<finder>:<key>" — identity only, NEVER amounts: aggregate totals grow nightly
// (income-sync) and an amount-bearing hash would resurface every dismissal
// within a day. Keys per finder (design §2.1): watchlist/home_office →
// account uuid; substantiation_gap/uncategorized/watchdog → entry uuid;
// vendor → normalizeCounterparty(vendor key); year_end → literal flag id.
// Client-safe: zero IO, imported by both the routes and InsightsClient.
import { normalizeCounterparty } from "./insight-types"

export type FinderKind =
  | "watchlist"
  | "substantiation_gap"
  | "uncategorized"
  | "vendor"
  | "home_office"
  | "year_end"
  | "watchdog"

export function findingFingerprint(finder: FinderKind, key: string): string {
  const stableKey = finder === "vendor" ? (normalizeCounterparty(key) ?? key) : key
  return `${finder}:${stableKey}`
}
