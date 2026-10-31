import { NextResponse } from "next/server"
import { OutputApiError, OutputAuthError } from "./api"
import { OutputNotConnectedError, OutputNotLinkedError } from "./sync"

/**
 * What the coach is told when a call to Output fails. Never 401/403: those would be
 * recorded as "access denied" in the audit log, and the coach's own access is fine.
 */
export function outputErrorResponse(err: unknown): NextResponse {
  if (err instanceof OutputNotConnectedError || err instanceof OutputNotLinkedError) {
    return NextResponse.json({ error: err.message }, { status: 409 })
  }
  if (err instanceof OutputAuthError) {
    return NextResponse.json(
      {
        error: `Output Sports stopped accepting the saved connection (${err.message}). Reconnect it in Settings > Output Sports.`,
      },
      { status: 409 },
    )
  }
  console.error("[output-sports]", err)
  if (err instanceof OutputApiError) {
    return NextResponse.json(
      { error: `Could not reach Output Sports (${err.message}). Try again in a minute.` },
      { status: 502 },
    )
  }
  return NextResponse.json({ error: "Something went wrong on our side, not in Output. Try again." }, { status: 500 })
}
