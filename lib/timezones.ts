/**
 * Common IANA time zones offered wherever an operator picks one, labelled in
 * plain words. The stored VALUE is always the IANA id -- `isValidTimezone` in
 * `lib/validators/business.ts` accepts any zone Intl recognises, not just
 * these -- but the picker only ever offers ones a non-programmer can read.
 */
export const COMMON_TIMEZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "America/New_York", label: "Eastern Time (New York)" },
  { value: "America/Chicago", label: "Central Time (Chicago)" },
  { value: "America/Denver", label: "Mountain Time (Denver)" },
  { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
  { value: "America/Phoenix", label: "Arizona Time (Phoenix, no daylight saving)" },
  { value: "America/Anchorage", label: "Alaska Time (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (Honolulu)" },
  { value: "Europe/London", label: "UK Time (London)" },
  { value: "UTC", label: "UTC (no local time zone)" },
]

/** The DB default for `businesses.timezone` and `business_settings.timezone`. */
export const DEFAULT_TIMEZONE = "America/New_York"
