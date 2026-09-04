// lib/calendly/oauth.ts — PKCE + signed-state OAuth helpers for per-coach
// Calendly connections. Pure logic; no DB, no routes (those come later).
//
// THIS STATE HELPER IS NOT lib/ads/oauth.ts's, ON PURPOSE. That one validates
// only the HMAC, so a signed state stays valid forever -- a real, pre-existing
// weakness in three shipped flows (google-ads, gmail, gsc; phase 2 spec §1.2,
// left alone there). This one also checks `iat` against a TTL, and rejects a
// state minted more than 60s in the future (clock skew is tolerated, a forged
// future timestamp is not). A signature proves WE minted the state; it does
// not prove THIS BROWSER asked for it -- the route layer pairs the state's
// `nonce` with an httpOnly cookie, which is why `nonce` travels inside the
// signed payload rather than being added by the route afterward.
//
// ENDPOINT HOST IS AMBIGUOUS IN CALENDLY'S OWN DOCS. Its published
// authorization-server metadata names https://calendly.com/oauth/{authorize,
// token}, while its refresh-token guide names https://auth.calendly.com/oauth
// /token. Both appear in Calendly's own documentation, so the base is a
// module constant with an override rather than a literal baked into each
// call -- and it is confirmed against a live client before go-live, not
// assumed correct from this comment.
//
// Style follows lib/calendly/client.ts: injectable `fetchImpl`, Zod `.loose()`
// parsing so an added field never turns a good response into a "shape"
// failure, and a typed error class carrying a `kind`/`status` discriminator
// (mirroring `CalendlyUnavailable`).

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { z } from "zod"

/** See the file-header note: Calendly documents both this host and calendly.com for /oauth/token. */
export const CALENDLY_AUTH_BASE_DEFAULT = "https://auth.calendly.com"

/** How long a signed state is honored after `iat`, in seconds. */
export const CALENDLY_STATE_TTL_SECONDS = 600

/** A state minted this many seconds in the future is rejected outright (clock skew tolerance, not a grant). */
const CLOCK_SKEW_TOLERANCE_SECONDS = 60

export type CalendlyOAuthState = {
  business_id: string
  host_id: string
  user_id: string
  /** Paired with an httpOnly cookie by the route layer -- proves THIS BROWSER asked for it. */
  nonce: string
  /** Unix seconds at signing time. */
  iat: number
}

export function signState(payload: CalendlyOAuthState, secret: string): string {
  const json = JSON.stringify(payload)
  const body = Buffer.from(json, "utf8").toString("base64url")
  const hmac = createHmac("sha256", secret).update(body).digest("base64url")
  return `${body}.${hmac}`
}

export function verifyState(
  state: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): CalendlyOAuthState | null {
  const parts = state.split(".")
  if (parts.length !== 2) return null
  const [body, sig] = parts
  if (!body || !sig) return null

  const expected = createHmac("sha256", secret).update(body).digest("base64url")
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null

  let payload: CalendlyOAuthState
  try {
    const json = Buffer.from(body, "base64url").toString("utf8")
    payload = JSON.parse(json) as CalendlyOAuthState
  } catch {
    return null
  }

  if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) return null
  const age = nowSeconds - payload.iat
  // Reject anything issued more than CLOCK_SKEW_TOLERANCE_SECONDS in the
  // future (age negative beyond tolerance -> forged), and anything older
  // than the TTL.
  if (age < -CLOCK_SKEW_TOLERANCE_SECONDS) return null
  if (age > CALENDLY_STATE_TTL_SECONDS) return null

  return payload
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

export type BuildAuthorizationUrlInput = {
  clientId: string
  redirectUri: string
  state: string
  challenge: string
  authBase?: string
}

export function buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
  const authBase = input.authBase ?? CALENDLY_AUTH_BASE_DEFAULT
  const url = new URL("/oauth/authorize", authBase)
  url.searchParams.set("client_id", input.clientId)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("state", input.state)
  url.searchParams.set("code_challenge", input.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  // No `scope` param: Calendly publishes no granular scopes.
  return url.toString()
}

export type CalendlyTokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  owner?: string
  organization?: string
}

// `.loose()`: Calendly may add fields over time, and a new key must not turn
// a good token response into a "shape" failure.
const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    expires_in: z.number(),
    token_type: z.string().min(1),
    owner: z.string().optional(),
    organization: z.string().optional(),
  })
  .loose()

export type CalendlyOAuthErrorKind = "invalid_grant" | "http" | "network" | "shape"

export class CalendlyOAuthError extends Error {
  readonly kind: CalendlyOAuthErrorKind
  readonly status: number | null

  constructor(kind: CalendlyOAuthErrorKind, message: string, status: number | null = null) {
    super(message)
    this.name = "CalendlyOAuthError"
    this.kind = kind
    this.status = status
  }
}

async function postToken(params: URLSearchParams, tokenUrl: string, fetchImpl: typeof fetch): Promise<Response> {
  try {
    return await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })
  } catch (err) {
    throw new CalendlyOAuthError("network", `Calendly token request failed: ${(err as Error).message}`)
  }
}

/**
 * `error === "invalid_grant"` on a 400/401 is the one non-transient refresh
 * failure -- Calendly's refresh tokens are single-use and rotate, so reusing
 * an outdated one answers this way. Every other non-2xx (503, other 4xx) is
 * transient/unknown and must NOT be classified as invalid_grant, because a
 * caller decides whether to mark a connection needs_reconnect purely off
 * `kind`, and a 503 misclassified this way would retire a working connection.
 */
async function isInvalidGrant(response: Response): Promise<boolean> {
  if (response.status !== 400 && response.status !== 401) return false
  try {
    const body = (await response.clone().json()) as unknown
    return (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      (body as { error?: unknown }).error === "invalid_grant"
    )
  } catch {
    return false
  }
}

async function parseTokenResponse(response: Response): Promise<CalendlyTokenResponse> {
  let body: unknown
  try {
    body = await response.json()
  } catch (err) {
    throw new CalendlyOAuthError(
      "shape",
      `Calendly token response was not JSON: ${(err as Error).message}`,
      response.status,
    )
  }

  const parsed = tokenResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new CalendlyOAuthError("shape", "Calendly token response had an unexpected shape", response.status)
  }
  return parsed.data
}

export type ExchangeCodeForTokensInput = {
  code: string
  verifier: string
  clientId: string
  clientSecret: string
  redirectUri: string
  authBase?: string
  fetchImpl?: typeof fetch
}

export async function exchangeCodeForTokens(input: ExchangeCodeForTokensInput): Promise<CalendlyTokenResponse> {
  const fetchImpl = input.fetchImpl ?? fetch
  const authBase = input.authBase ?? CALENDLY_AUTH_BASE_DEFAULT
  const tokenUrl = new URL("/oauth/token", authBase).toString()

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.verifier,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
  })

  const response = await postToken(params, tokenUrl, fetchImpl)

  if (!response.ok) {
    if (await isInvalidGrant(response)) {
      throw new CalendlyOAuthError("invalid_grant", "Calendly rejected the authorization code", response.status)
    }
    const text = await response.text().catch(() => "")
    throw new CalendlyOAuthError(
      "http",
      `Calendly token exchange answered HTTP ${response.status} ${text}`,
      response.status,
    )
  }

  return parseTokenResponse(response)
}

export type RefreshAccessTokenInput = {
  refreshToken: string
  clientId: string
  clientSecret: string
  authBase?: string
  fetchImpl?: typeof fetch
}

/**
 * Calendly refresh tokens are single-use and rotate: the caller MUST persist
 * the `refresh_token` this returns and stop sending the old one, or the next
 * refresh attempt gets `invalid_grant` and the connection is locked out.
 */
export async function refreshAccessToken(input: RefreshAccessTokenInput): Promise<CalendlyTokenResponse> {
  const fetchImpl = input.fetchImpl ?? fetch
  const authBase = input.authBase ?? CALENDLY_AUTH_BASE_DEFAULT
  const tokenUrl = new URL("/oauth/token", authBase).toString()

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  })

  const response = await postToken(params, tokenUrl, fetchImpl)

  if (!response.ok) {
    if (await isInvalidGrant(response)) {
      throw new CalendlyOAuthError("invalid_grant", "Calendly refresh token was reused or revoked", response.status)
    }
    const text = await response.text().catch(() => "")
    throw new CalendlyOAuthError(
      "http",
      `Calendly token refresh answered HTTP ${response.status} ${text}`,
      response.status,
    )
  }

  return parseTokenResponse(response)
}
