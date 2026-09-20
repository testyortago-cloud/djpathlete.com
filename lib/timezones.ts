/**
 * Common IANA time zones offered wherever an operator picks one, labelled in
 * plain words. The stored VALUE is always the IANA id -- `isUsableTimezone`
 * below accepts any zone Intl recognises, not just these -- but the picker
 * only ever offers ones a non-programmer can read.
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

/**
 * Does this string name a timezone the runtime can actually use?
 *
 * Asked of the platform, not of a regex: the question is never "does it look
 * like a zone" but "will `Intl` survive it". An unknown zone throws a
 * RangeError wherever it is finally used, which is always several layers from
 * wherever it was accepted.
 *
 * ONE predicate, TWO policies, and the policies stay at their call sites:
 *   - `lib/validators/business.ts` REJECTS the payload — an operator picking
 *     their own business timezone is choosing, and should be told it is wrong.
 *   - `lib/db/contacts.ts` (`timezonePatch`) stores NULL and logs — a lead's
 *     browser reported that value, nobody chose it, and refusing the whole
 *     submission would trade a real enquiry for a scheduling nicety.
 *
 * Accepts fixed offsets (`+05:30`, `Etc/GMT+5`) because `Intl` does. They have
 * no daylight saving, so a contact stored that way has a quiet-hours window
 * that is an hour out for half the year — no browser emits them, and
 * narrowing this would reject inputs nothing sends, but it is the thing to
 * tighten first if that ever stops being true.
 */
export function isUsableTimezone(tz: string): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}
