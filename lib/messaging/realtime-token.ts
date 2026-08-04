import { SignJWT } from "jose"

/**
 * Mint a Supabase-compatible JWT for the browser's Realtime socket.
 *
 * This app authenticates with NextAuth, so the browser has no Supabase session
 * and `auth.uid()` is NULL inside RLS — which would deny every policy. Supabase
 * documents exactly this escape hatch: sign a JWT with the project's JWT secret
 * carrying `sub` + `role`, then hand it to `supabase.realtime.setAuth()`.
 *
 * The token grants nothing on its own. Every messaging table is SELECT-only for
 * `authenticated` and there is no INSERT policy anywhere, so RLS is the real
 * constraint and this is only the identity claim. Keep the TTL short regardless.
 *
 * NOTE: Supabase is migrating projects from this shared legacy JWT secret to
 * asymmetric signing keys. The legacy secret is what this project uses today and
 * remains supported; if it is ever rotated or migrated in the dashboard, this
 * function is the single place that changes.
 */
export const REALTIME_TOKEN_TTL_MS = 60 * 60 * 1000

/** Refresh ten minutes before expiry so a slow network cannot drop the socket. */
export const REALTIME_TOKEN_REFRESH_MS = REALTIME_TOKEN_TTL_MS - 10 * 60 * 1000

export async function signRealtimeToken(userId: string): Promise<{ token: string; expiresAt: number }> {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) throw new Error("SUPABASE_JWT_SECRET is not configured")

  const expiresAt = Date.now() + REALTIME_TOKEN_TTL_MS
  const token = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(new TextEncoder().encode(secret))

  return { token, expiresAt }
}
