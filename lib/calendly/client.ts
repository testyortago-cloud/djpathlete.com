// lib/calendly/client.ts — reads availability from Calendly. Nothing else.
//
// AVAILABILITY IS READ AT REQUEST TIME AND NEVER CACHED IN OUR DATABASE. A
// stored copy of somebody's calendar is wrong within minutes and has no
// invalidation signal — the same reasoning `stalenessOf` uses in the pipeline.
//
// `[]` AND A THROW ARE DIFFERENT ANSWERS. An empty collection means "nothing
// is free in this window", which is a real answer the assistant should give
// plainly. A network failure, a 401, a 5xx or a body that is not the shape we
// expect means "could not read", and that is `CalendlyUnavailable` — the
// assistant falls back to the link and says nothing about times. Returning
// `[]` for the second case would have the assistant tell a visitor the
// calendar is full when the calendar is merely unreachable. This repo has been
// bitten by conflating null and [] before.
//
// THE RANGE IS CLAMPED TO SEVEN DAYS. Calendly's docs disagree with themselves
// (31 days on the endpoint reference, 7 on the recipe); seven is correct under
// both. The card shows six slots at most, so a week is plenty.
//
// Deliberately `fetch` + Zod rather than an SDK: one GET does not justify a
// dependency, and an injectable `fetchImpl` is what lets the unit tests run
// against recorded fixtures instead of the live API.

import { z } from "zod"

import { CALENDLY_API_BASE_DEFAULT } from "@/lib/calendly/env"

export const AVAILABILITY_WINDOW_DAYS = 7
const AVAILABILITY_TIMEOUT_MS = 8_000
const DAY_MS = 86_400_000

export type Slot = {
  /** ISO 8601 instant, as Calendly returned it. */
  startAt: string
  /** Calendly's booking page for THIS time — clicking it lands on that slot, not the month view. */
  schedulingUrl: string
  inviteesRemaining: number
}

export type CalendlyUnavailableReason = "network" | "http" | "shape"

/** Thrown when availability could not be READ. Never thrown for "no free slots". */
export class CalendlyUnavailable extends Error {
  readonly reason: CalendlyUnavailableReason
  readonly status: number | null

  constructor(reason: CalendlyUnavailableReason, message: string, status: number | null = null) {
    super(message)
    this.name = "CalendlyUnavailable"
    this.reason = reason
    this.status = status
  }
}

// `.loose()` on both: Calendly adds fields over time and a new key must not
// turn every availability read into a "shape" failure.
const availableTimeSchema = z
  .object({
    status: z.string(),
    start_time: z.string().min(1),
    scheduling_url: z.string().url(),
    invitees_remaining: z.number().int().nonnegative().optional(),
  })
  .loose()

const availableTimesResponseSchema = z.object({ collection: z.array(availableTimeSchema) }).loose()

export type ListAvailableTimesArgs = {
  eventTypeUri: string
  from: Date
  to: Date
  apiToken: string
  apiBase?: string
  fetchImpl?: typeof fetch
}

/**
 * The free times for one event type between `from` and `to` (clamped to seven
 * days after `from`), soonest first. Only `status === "available"` rows are
 * returned; anything Calendly marks otherwise is not offered.
 */
export async function listAvailableTimes(args: ListAvailableTimesArgs): Promise<Slot[]> {
  const fetchImpl = args.fetchImpl ?? fetch
  const apiBase = args.apiBase ?? CALENDLY_API_BASE_DEFAULT

  const from = args.from
  const latest = new Date(from.getTime() + AVAILABILITY_WINDOW_DAYS * DAY_MS)
  const to = args.to.getTime() > latest.getTime() ? latest : args.to

  const url = new URL("/event_type_available_times", apiBase)
  url.searchParams.set("event_type", args.eventTypeUri)
  url.searchParams.set("start_time", from.toISOString())
  url.searchParams.set("end_time", to.toISOString())

  let response: Response
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${args.apiToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(AVAILABILITY_TIMEOUT_MS),
    })
  } catch (err) {
    throw new CalendlyUnavailable("network", `availability request failed: ${(err as Error).message}`)
  }

  if (!response.ok) {
    throw new CalendlyUnavailable("http", `availability request answered ${response.status}`, response.status)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (err) {
    throw new CalendlyUnavailable("shape", `availability body was not JSON: ${(err as Error).message}`, response.status)
  }

  const parsed = availableTimesResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new CalendlyUnavailable("shape", `availability body had an unexpected shape`, response.status)
  }

  return parsed.data.collection
    .filter((row) => row.status === "available")
    .map((row) => ({
      startAt: row.start_time,
      schedulingUrl: row.scheduling_url,
      inviteesRemaining: row.invitees_remaining ?? 1,
    }))
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
}
