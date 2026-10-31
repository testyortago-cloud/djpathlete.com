import type { OutputMeasurement } from "./map"

/**
 * Output Sports' public API (spec: https://api.outputsports.com/swagger/v1.0/swagger.json).
 * Pull only. It signs in with the organisation OWNER's email and password; the refresh
 * token it returns did not rotate when probed on 2026-10-30.
 */
const BASE = "https://api.outputsports.com/api/v1"

/** Output refused the login or the stored token. The coach has to reconnect. */
export class OutputAuthError extends Error {}
/** Output could not be reached, timed out, or answered with an error. */
export class OutputApiError extends Error {}

export interface OutputAthlete {
  id: string
  externalId: string | null
  firstName: string | null
  lastName: string | null
  fullName: string | null
  dateOfBirth: string | null
}

interface TokenResponse {
  accessToken: string
  refreshToken: string
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...rest,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    throw new OutputApiError(`Output Sports did not answer (${(err as Error).name})`)
  }
  if (res.ok) return (await res.json()) as T
  // Output's errors are { title, status, detail }; detail is the readable part.
  const detail = await res
    .json()
    .then((b: { detail?: string }) => b.detail)
    .catch(() => undefined)
  const message = detail ?? `Output Sports answered ${res.status}`
  if (res.status === 401 || res.status === 403) throw new OutputAuthError(message)
  throw new OutputApiError(message)
}

function token(body: Record<string, string>) {
  return call<TokenResponse>("/oauth/token", { method: "POST", body: JSON.stringify(body) })
}

/** Exchanges the owner's login for tokens. The password is not kept anywhere. */
export function signIn(email: string, password: string) {
  return token({ grantType: "password", email, password })
}

export function refreshAccess(refreshToken: string) {
  return token({ grantType: "refresh_token", refreshToken })
}

export function listAthletes(accessToken: string) {
  return call<OutputAthlete[]>("/athletes", { token: accessToken })
}

/** At most 31 days per call (Output answers 400 beyond that). */
export function listMeasurements(
  accessToken: string,
  q: { start: Date; end: Date; athleteIds: string[]; exerciseIds: string[] },
) {
  return call<OutputMeasurement[]>("/exercises/measurements", {
    method: "POST",
    token: accessToken,
    body: JSON.stringify({
      startDate: q.start.toISOString(),
      endDate: q.end.toISOString(),
      athleteIds: q.athleteIds,
      exerciseMetadataIds: q.exerciseIds,
    }),
  })
}
