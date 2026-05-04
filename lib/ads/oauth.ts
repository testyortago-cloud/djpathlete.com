// lib/ads/oauth.ts
// OAuth helpers for Google Ads. Pure logic; no I/O beyond the token-exchange
// fetch. State is HMAC-signed (instead of cookie-stored) so the callback can
// verify provenance without any server-side session lookup.

import { createHmac, timingSafeEqual } from "node:crypto"

const ADWORDS_SCOPE = "https://www.googleapis.com/auth/adwords"

export interface AuthorizationUrlInput {
  client_id: string
  redirect_uri: string
  state: string
}

export function buildAuthorizationUrl(input: AuthorizationUrlInput): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("client_id", input.client_id)
  url.searchParams.set("redirect_uri", input.redirect_uri)
  url.searchParams.set("scope", ADWORDS_SCOPE)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("state", input.state)
  return url.toString()
}

export function signState<T>(payload: T, secret: string): string {
  const json = JSON.stringify(payload)
  const body = Buffer.from(json, "utf8").toString("base64url")
  const hmac = createHmac("sha256", secret).update(body).digest("base64url")
  return `${body}.${hmac}`
}

export function verifyState<T>(state: string, secret: string): T | null {
  const parts = state.split(".")
  if (parts.length !== 2) return null
  const [body, sig] = parts
  if (!body || !sig) return null
  const expected = createHmac("sha256", secret).update(body).digest("base64url")
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null
  try {
    const json = Buffer.from(body, "base64url").toString("utf8")
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

export interface ExchangeCodeInput {
  code: string
  client_id: string
  client_secret: string
  redirect_uri: string
}

export interface OAuthTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: "Bearer"
  scope: string
}

export async function exchangeCodeForTokens(
  input: ExchangeCodeInput,
): Promise<OAuthTokenResponse> {
  const params = new URLSearchParams({
    code: input.code,
    client_id: input.client_id,
    client_secret: input.client_secret,
    redirect_uri: input.redirect_uri,
    grant_type: "authorization_code",
  })
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`OAuth token exchange failed: HTTP ${res.status} ${text}`)
  }
  return (await res.json()) as OAuthTokenResponse
}
