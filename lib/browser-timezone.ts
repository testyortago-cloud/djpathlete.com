/**
 * The visitor's own IANA timezone, for every public form that captures a lead
 * (G06). One helper rather than five inline copies, so all five surfaces send
 * the same shape and there is one place to change if that ever moves.
 *
 * Returns `undefined`, never a guess. The server field is optional and the DAL
 * stores the column fill-only, so a missing value simply leaves the contact on
 * the business timezone — which is where every contact sat before G06. A wrong
 * value would be worse than none: it would be stored, it is fill-only, and it
 * would silently quiet-hour someone against a clock they do not live on.
 *
 * Wrapped because this runs in whatever browser the visitor brought. `Intl` is
 * universal in the supported set, but a locked-down or instrumented environment
 * can still make `resolvedOptions()` throw, and a lead form must not break over
 * a scheduling nicety.
 */
export function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}
