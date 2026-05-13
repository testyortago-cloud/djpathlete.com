// lib/ads/agent/thresholds.ts
// Single source of truth for all tunable constants the ads agent uses.
// Edit values here without touching signal, guardrail, or outcome logic.

// — Data-quality preflight ————————————————————————————
export const CONVERSION_FRESHNESS_HOURS = 48
export const SYNC_FRESHNESS_HOURS = 48
export const MIN_RECENT_CLICKS = 30
export const RECENT_CLICKS_WINDOW_DAYS = 7

// — Derived cross-channel signals —————————————————————
export const PAID_SPEND_THRESHOLD_USD = 20
export const ORGANIC_OVERLAP_MAX_POSITION = 5
export const ORGANIC_WIN_MIN_CLICKS = 10
export const ORGANIC_WIN_MAX_POSITION = 10
export const LP_ENGAGEMENT_FLOOR = 0.4

// — Learning layer ————————————————————————————————————
export const WINNING_KEYWORD_MIN_CONVERSIONS = 3
export const WINNING_KEYWORD_LOOKBACK_DAYS = 30
export const WINNING_AUDIENCE_MIN_TRENDING_WEEKS = 3 // out of last 4
export const WINNING_SCHEDULE_CVR_MULTIPLIER = 1.5
export const WINNING_GEO_CVR_MULTIPLIER = 1.3
export const WINNING_GEO_MIN_CONVERSIONS = 10

// — Hard guardrails ———————————————————————————————————
export const CAMPAIGN_MIN_AGE_DAYS = 14
export const MIN_CLICKS_FOR_RECOMMENDATION = 30
export const MIN_CONVERSIONS_FOR_RECOMMENDATION = 3
export const MAX_BUDGET_SHIFT_PCT = 20
export const NEW_CAMPAIGN_MAX_DAILY_BUDGET = 30
export const MAX_NEW_DAILY_SPEND_PER_MEMO = 100
export const PAUSE_PROTECTION_WINDOW_DAYS = 7
export const PAUSE_PROTECTION_MIN_CONVERSIONS = 1
export const MIN_AUDIENCE_SIZE = 1_000

// — Soft guardrails ———————————————————————————————————
export const SIG_MIN_SAMPLE = 100 // sessions per side for fallback floor
export const SIG_Z_THRESHOLD = 1.96 // two-tailed 95%

// — Approval-tier (UI enforces) ———————————————————————
export const LARGE_BUDGET_SHIFT_USD = 50
export const BULK_NEGATIVE_KEYWORD_THRESHOLD = 10

// — Outcomes ———————————————————————————————————————————
export const OUTCOME_WINDOW_DAYS = 14
export const OUTCOME_WINDOW_EXPIRY_DAYS = 30

// — Brand protection ——————————————————————————————————
// Configurable per project. Loose-matched case-insensitive against negative
// keyword text. Any overlap rejects the whole negative-keyword action.
export const BRAND_TERM_ALLOWLIST = [
  "djp athlete",
  "djpathlete",
  "darren paul",
  "darren j paul",
  "comeback code",
  "rotational reboot",
]
