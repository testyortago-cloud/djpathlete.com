/**
 * How long a signed-in session lives. Two clocks, deliberately.
 *
 * **Idle** — `SESSION_IDLE_MAX_AGE_SECONDS` is NextAuth's `session.maxAge`, and
 * under the JWT strategy that is a SLIDING window, not a fixed lifetime: every
 * session read re-signs the token with a fresh expiry and re-sets the cookie
 * (`@auth/core/lib/actions/session.js`, the `strategy === "jwt"` branch). And
 * every page request in this app passes through `proxy.ts`, which is the
 * `auth()` wrapper — `handleAuth` copies that refreshed `Set-Cookie` onto the
 * response. So the window renews on each page load, and the session dies this
 * long after the LAST one. That is the idle timeout; there is no separate timer.
 *
 * **Absolute** — the sliding window alone can be renewed forever, so a device
 * that walks away stays signed in indefinitely. `SESSION_ABSOLUTE_MAX_AGE_MS`
 * is measured from the moment of sign-in and cannot be extended by activity,
 * by tab focus, or by clicking "Stay signed in". It is the only guarantee here
 * that a session ever ends.
 */

/** Idle window: signed out this long after the last page load. */
export const SESSION_IDLE_MAX_AGE_SECONDS = 2 * 60 * 60 // 2 hours
export const SESSION_IDLE_MAX_AGE_MS = SESSION_IDLE_MAX_AGE_SECONDS * 1000

/** Absolute cap: re-authenticate this long after signing in, however active. */
export const SESSION_ABSOLUTE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/** How long before expiry the "you're about to be signed out" warning appears. */
export const SESSION_WARN_BEFORE_MS = 2 * 60 * 1000 // 2 minutes

/**
 * Has this session passed its absolute cap?
 *
 * A token minted before this policy shipped carries no `loginAt`, and a missing
 * stamp must NOT read as "infinitely old" — that would sign out every user in
 * the product at once, the moment the deploy landed. The caller stamps the
 * absent case with the current time instead (see `lib/auth.ts`), so an unstamped
 * session is grandfathered into a fresh window rather than destroyed.
 */
export function isPastAbsoluteCap(loginAt: unknown, now: number): boolean {
  if (typeof loginAt !== "number" || !Number.isFinite(loginAt)) return false
  return now - loginAt > SESSION_ABSOLUTE_MAX_AGE_MS
}

/** Should the sign-out warning be on screen at `now`, for a session expiring at `expiresAt`? */
export function shouldWarn(expiresAt: number | null, now: number): boolean {
  if (expiresAt === null || !Number.isFinite(expiresAt)) return false
  if (now >= expiresAt) return false // past expiry is a redirect, not a warning
  return now >= expiresAt - SESSION_WARN_BEFORE_MS
}

/**
 * Stamp the absolute clock and decide whether this session has run out.
 * Returns `null` when it must be destroyed — under the JWT strategy that is how
 * a session ends: `@auth/core` clears the cookie instead of re-signing it.
 *
 * Pure on purpose. This is the only rule in the product that guarantees a
 * session ever ends, and it should be provable without standing up NextAuth,
 * a database, or a browser.
 */
export function applyAbsoluteCap<T extends { loginAt?: number }>(token: T, isSignIn: boolean, now: number): T | null {
  // A fresh sign-in starts the clock. A token minted before this policy shipped
  // has no stamp at all, and gets one now rather than being read as expired —
  // see isPastAbsoluteCap.
  if (isSignIn || typeof token.loginAt !== "number") token.loginAt = now
  return isPastAbsoluteCap(token.loginAt, now) ? null : token
}
