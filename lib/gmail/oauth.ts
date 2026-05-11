// lib/gmail/oauth.ts
// Gmail-specific OAuth helpers. State signing and code exchange are reused
// from lib/ads/oauth.ts so we don't duplicate HMAC logic. Only the
// authorization URL (different scope set) lives here.

export {
  signState,
  verifyState,
  exchangeCodeForTokens,
  type OAuthTokenResponse,
  type ExchangeCodeInput,
} from "@/lib/ads/oauth"

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
].join(" ")

export interface GmailAuthorizationUrlInput {
  client_id: string
  redirect_uri: string
  state: string
}

export function buildGmailAuthorizationUrl(input: GmailAuthorizationUrlInput): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("client_id", input.client_id)
  url.searchParams.set("redirect_uri", input.redirect_uri)
  url.searchParams.set("scope", GMAIL_SCOPES)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("include_granted_scopes", "true")
  url.searchParams.set("state", input.state)
  return url.toString()
}

export interface RefreshAccessTokenInput {
  refresh_token: string
  client_id: string
  client_secret: string
}

export interface RefreshAccessTokenResponse {
  access_token: string
  expires_in: number
  scope: string
  token_type: "Bearer"
}

export async function refreshAccessToken(
  input: RefreshAccessTokenInput,
): Promise<RefreshAccessTokenResponse> {
  const params = new URLSearchParams({
    refresh_token: input.refresh_token,
    client_id: input.client_id,
    client_secret: input.client_secret,
    grant_type: "refresh_token",
  })
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Gmail token refresh failed: HTTP ${res.status} ${text}`)
  }
  return (await res.json()) as RefreshAccessTokenResponse
}
