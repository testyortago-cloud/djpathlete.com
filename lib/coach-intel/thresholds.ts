// lib/coach-intel/thresholds.ts
//
// Fixed thresholds for rule-based risk-flag generation. Tuned after
// real-world use; updates are one-file edits.

export const ACWR_DANGER = 1.5
export const ACWR_SWEET_SPOT_LOW = 0.8
export const ACWR_SWEET_SPOT_HIGH = 1.3

export const READINESS_FATIGUE_THRESHOLD = 40
export const FATIGUE_CONSECUTIVE_DAYS = 3

export const WEEKLY_LOAD_SPIKE_PCT = 30

export const MONOTONY_HIGH = 2.0

export const RPE_CREEP_THRESHOLD = 8
export const RPE_CREEP_CONSECUTIVE_SESSIONS = 3

export const ACUTE_WINDOW_DAYS = 7
export const CHRONIC_WINDOW_DAYS = 28
