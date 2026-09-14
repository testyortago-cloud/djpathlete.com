import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"

/**
 * Is this browser's session still alive? A read that does NOT renew it.
 *
 * This exists because the obvious way to ask — `getSession()`, i.e. GET
 * /api/auth/session — re-signs the JWT and re-sets the cookie with a fresh idle
 * window. A timer that polls *that* to find out whether it has run out renews
 * the very thing it is measuring, so the idle timeout can never fire on an open
 * tab. Measured on a real page with a 60-second window: the poll landed with one
 * second left and pushed the cookie back out to 55, every cycle, forever.
 *
 * Two things keep this route read-only, and both are load-bearing:
 *  - `auth()` with no arguments takes next-auth's React-Server-Component branch,
 *    which reads the session response and DISCARDS its `Set-Cookie` headers
 *    (`next-auth/lib/index.js`). The session is decoded; the cookie is not
 *    rewritten.
 *  - `proxy.ts` does not match `/api/*` (only `/api/admin/*`), so the middleware
 *    does not re-set the cookie on the way past either.
 *
 * Change either of those and the idle timeout silently stops working — nothing
 * will fail, users simply stay signed in forever.
 */
export async function GET() {
  try {
    const session = await auth()
    return NextResponse.json({ alive: Boolean(session?.user) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch {
    // An unreadable cookie is not proof of a dead session — a network or decode
    // failure must not sign anyone out. Say "alive" and let the real expiry,
    // enforced server-side on the next request, do the ending.
    return NextResponse.json({ alive: true }, { headers: { "Cache-Control": "private, no-store" } })
  }
}
