// app/api/admin/bookings/calendar/cookies.ts — the two cookie names the
// connect route sets and the callback route requires, in one place so the pair
// cannot drift apart. A verifier written under one name and read under another
// is an OAuth flow that always answers "pkce".
//
// Not a route file: Next's App Router only treats route.ts / page.tsx and
// friends as routes, so this module ships nothing to the network.

export const NONCE_COOKIE = "calendly_oauth_nonce"
export const VERIFIER_COOKIE = "calendly_oauth_verifier"

/**
 * Scoped to the calendar routes alone. The cookies are useless anywhere else
 * and a browser should not be sending them to every admin request.
 */
export const CALENDAR_COOKIE_PATH = "/api/admin/bookings/calendar"

/** Ten minutes — the same window `CALENDLY_STATE_TTL_SECONDS` gives the state itself. */
export const CALENDAR_COOKIE_MAX_AGE_SECONDS = 600
