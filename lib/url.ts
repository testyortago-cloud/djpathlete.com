/**
 * Resolve the public base URL for server-side links (emails, callbacks).
 * Falls back to localhost for tests / unconfigured local dev.
 */
export function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}
