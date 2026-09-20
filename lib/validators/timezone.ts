import { z } from "zod"

/**
 * The submitter's own IANA timezone, as every public form now sends it (G06).
 *
 * Produced by `Intl.DateTimeFormat().resolvedOptions().timeZone` in the
 * browser, consumed by `resolveTimezone` (lib/lead-engine/guardrails.ts) so
 * quiet hours land in this person's morning instead of the coach's.
 *
 * DELIBERATELY LENIENT — no `.max()`, no regex, no enum. A Zod constraint here
 * would reject the WHOLE submission, and this field is the least important
 * thing in it: refusing a lead because their browser reported an odd zone
 * trades a real enquiry for a scheduling nicety. This repo has already paid for
 * that shape once, when a `.max()` on a model's summary threw away nine valid
 * operations.
 *
 * The real check lives at the write instead, where the cost of a bad value is a
 * null column rather than a lost lead: `timezonePatch` (lib/db/contacts.ts)
 * stores it only if `isUsableTimezone` says `Intl` can parse it, and logs a
 * truncated copy otherwise. That bounds what reaches the COLUMN — only strings
 * `Intl` recognises get stored — and the truncation bounds what reaches the LOG,
 * which an unbounded field on a public POST would otherwise fill.
 *
 * `.nullish()`, not `.optional()`. Review finding: `.optional()` accepts a
 * missing key but REJECTS an explicit `timezone: null` — which would 400 the
 * whole submission, the exact thing this field's leniency exists to prevent,
 * and with an error naming a different field. Today's callers send `undefined`
 * (a key `JSON.stringify` drops) so nothing was live, but a cached bundle or a
 * hand-rolled integration posting `null` would have lost the lead.
 */
export const submittedTimezone = z.string().trim().nullish()
