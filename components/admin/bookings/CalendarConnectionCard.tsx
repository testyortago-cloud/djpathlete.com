"use client"

// components/admin/bookings/CalendarConnectionCard.tsx — every state of one
// coach's Calendly connection, in one card.
//
// THE WORDS ARE THE FEATURE HERE. The reader is a coach, not a programmer, so
// nothing on this screen says OAuth, authorize, integration, sync, endpoint,
// token, webhook or subscription. The database calls the thing that delivers a
// booking a "webhook subscription"; the coach reads "Calendly tells us as soon
// as someone books". Controls are named exactly as they appear — in quotes —
// and then said again in plain words.
//
// SIX STATES, AND EACH ONE IS A DIFFERENT SENTENCE:
//   no host          — nothing to attach a calendar to, so no Connect button
//   not connected    — what connecting does, and Connect
//   needs reconnect  — Calendly stopped accepting us; reconnect, or disconnect
//   plan lapsed      — webhooks need a paid Calendly plan; upgrade, then pick
//   choose a meeting — the coach's own meetings, with a radio
//   ready            — the account, the meeting, whether bookings arrive
// A single "not working" state covering the last four would be shorter to
// write and useless to read: the coach's next action is different in each.
//
// THE UNTICKED CONFLICT CHECK RENDERS A WARNING BADGE, NEVER A SILENT
// ABSENCE. No Calendly API exposes whether "Check for conflicts" is on, so the
// coach's own eyes are the only instrument that exists — and the failure it
// guards against (double-booked over a commitment Calendly never saw) is
// invisible until it happens to a real client.
//
// NO CREDENTIALS REACH THIS FILE. Everything a client component receives is
// serialised into the page the browser downloads, and
// `fn_get_coach_calendar_connection` decrypts and returns `credentials`. The
// page therefore builds `CalendarConnectionView` field by field rather than
// handing the row over; see its header.

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ExternalLink } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableToolbar,
  type DataTableBadgeTone,
} from "@/components/ui/data-table"
import { cn } from "@/lib/utils"

/** A GET that redirects to Calendly, so it is a link and never a fetch. */
const CONNECT_PATH = "/api/admin/bookings/calendar/connect"
const EVENT_TYPE_PATH = "/api/admin/bookings/calendar/event-type"
const CONFLICT_CHECK_PATH = "/api/admin/bookings/calendar/conflict-check"
const DISCONNECT_PATH = "/api/admin/bookings/calendar/disconnect"

/** Where "Check for conflicts" lives in Calendly's own settings. */
const CALENDLY_CALENDAR_SETTINGS_URL = "https://calendly.com/app/settings/calendar_connections"

const CALENDLY_UNREACHABLE = "We could not reach Calendly just now. Load this page again to try."

/**
 * The connection as the browser is allowed to see it. Deliberately not
 * `CoachCalendarConnection`: that type carries `credentials`.
 */
export type CalendarConnectionView = {
  /** `not_connected` never reaches here — the page passes `null` for it. */
  status: "connected" | "needs_reconnect" | "plan_lapsed" | "error"
  /** The chosen meeting, as Calendly names it. Not a secret; it is in the coach's own public URL. */
  eventTypeUri: string | null
  /** The chosen meeting's public booking page, stored on the row — available even when Calendly is not. */
  schedulingUrl: string | null
  /** Whether Calendly is still delivering. `"active"` is the only good value. */
  webhookState: string | null
  /** Preformatted on the server, so the date cannot read differently there and here. */
  conflictCheckedOn: string | null
  conflictConfirmed: boolean
  /** Who the connection belongs to, read from Calendly when the page rendered. */
  account: { name: string; email: string } | null
  /** True when we asked Calendly who this is and got no answer. */
  accountReadFailed: boolean
  /** The chosen meeting's name and length, when Calendly still lists it. */
  meeting: { name: string; durationMinutes: number } | null
}

export type CalendarFlash = { tone: "success" | "warning"; message: string }

export type CalendarConnectionCardProps = {
  /** False when the business has no calendar row — there is nothing to attach a Calendly account to. */
  hasHost: boolean
  /** `null` means no Calendly account is connected. */
  connection: CalendarConnectionView | null
  /** The one-off result of coming back from Calendly. */
  flash: CalendarFlash | null
}

type Meeting = {
  uri: string
  name: string
  durationMinutes: number
  schedulingUrl: string
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  return (await response.json().catch(() => null)) as Record<string, unknown> | null
}

function errorFrom(body: Record<string, unknown> | null, fallback: string): string {
  const message = body?.error
  return typeof message === "string" && message.length > 0 ? message : fallback
}

/** The card's own chrome, so every state opens the same way. */
function Shell({
  title,
  badge,
  actions,
  children,
}: {
  title: string
  badge: { tone: DataTableBadgeTone; label: string }
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <DataTableCard>
      <DataTableToolbar className="sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-primary">{title}</h2>
          <DataTableBadge tone={badge.tone}>{badge.label}</DataTableBadge>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </DataTableToolbar>
      {children}
    </DataTableCard>
  )
}

function Prose({ children }: { children: ReactNode }) {
  return <div className="space-y-2 p-4 text-sm text-muted-foreground">{children}</div>
}

function ConnectButton({ label }: { label: string }) {
  return (
    <Button asChild>
      <a href={CONNECT_PATH}>{label}</a>
    </Button>
  )
}

function DisconnectButton({ onDone }: { onDone: (leftoverNotice: string | null) => void }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function disconnect() {
    if (pending) return
    const sure = window.confirm(
      "Disconnect your Calendly?\n\n" +
        "We stop receiving your bookings here. Your Calendly account and your meetings are not changed.",
    )
    if (!sure) return
    setPending(true)
    try {
      const response = await fetch(DISCONNECT_PATH, { method: "POST" })
      const body = await readJson(response)
      if (!response.ok) {
        toast.error(errorFrom(body, "We could not disconnect just now. Try again in a moment."))
        return
      }
      // The route reports a Calendly-side leftover it could not remove. Its
      // own wording names a webhook; a coach should not have to read that
      // word, so the same fact is said here in plain words instead.
      const leftover = typeof body?.orphanedWebhookSubscriptionUri === "string"
      toast.success("Your Calendly is disconnected.")
      onDone(
        leftover
          ? "Your Calendly is disconnected here. One leftover setting could not be removed from your Calendly account. " +
              "It does nothing on its own — no more bookings will come through. Ask the person who set up your account to clear it."
          : null,
      )
      router.refresh()
    } catch {
      toast.error("We could not disconnect just now. Try again in a moment.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Button type="button" variant="outline" onClick={disconnect} disabled={pending}>
      {pending ? "Disconnecting…" : "Disconnect"}
    </Button>
  )
}

/**
 * The coach's own meetings, fetched when this renders. The list is read here
 * rather than on the server because it is the interactive half of the screen:
 * a coach who adds a meeting in Calendly and comes back wants the fresh list,
 * and the route already answers exactly this question.
 */
function MeetingPicker({ currentUri }: { currentUri: string | null }) {
  const router = useRouter()
  const [meetings, setMeetings] = useState<Meeting[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(currentUri)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(EVENT_TYPE_PATH)
        const body = await readJson(response)
        if (cancelled) return
        if (!response.ok) {
          setLoadError(errorFrom(body, CALENDLY_UNREACHABLE))
          return
        }
        setMeetings(Array.isArray(body?.eventTypes) ? (body.eventTypes as Meeting[]) : [])
      } catch {
        if (!cancelled) setLoadError(CALENDLY_UNREACHABLE)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    if (!chosen || saving) return
    setSaving(true)
    try {
      const response = await fetch(EVENT_TYPE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventTypeUri: chosen }),
      })
      const body = await readJson(response)
      if (!response.ok) {
        toast.error(errorFrom(body, "We could not save your choice. Try again in a moment."))
        return
      }
      toast.success("Saved. Calendly will tell us when someone books that meeting.")
      router.refresh()
    } catch {
      toast.error("We could not save your choice. Try again in a moment.")
    } finally {
      setSaving(false)
    }
  }

  const rows = meetings ?? []

  return (
    <>
      <DataTable>
        <DataTableHeader>
          <DataTableHead className="w-12">
            <span className="sr-only">Pick a meeting</span>
          </DataTableHead>
          <DataTableHead>Meeting</DataTableHead>
          <DataTableHead>Length</DataTableHead>
          <DataTableHead>Booking page</DataTableHead>
        </DataTableHeader>
        <tbody>
          {meetings === null && !loadError ? (
            <DataTableEmpty colSpan={4}>Reading your Calendly meetings…</DataTableEmpty>
          ) : null}
          {loadError ? <DataTableEmpty colSpan={4}>{loadError}</DataTableEmpty> : null}
          {meetings !== null && !loadError && rows.length === 0 ? (
            <DataTableEmpty colSpan={4}>
              No meetings are switched on in your Calendly. Add one there, then load this page again.
            </DataTableEmpty>
          ) : null}
          {rows.map((meeting) => (
            <DataTableRow key={meeting.uri}>
              <DataTableCell>
                <input
                  type="radio"
                  name="calendly-meeting"
                  id={`calendly-meeting-${meeting.uri}`}
                  value={meeting.uri}
                  checked={chosen === meeting.uri}
                  onChange={() => setChosen(meeting.uri)}
                  className="size-4 accent-primary"
                />
              </DataTableCell>
              <DataTableCell>
                <label htmlFor={`calendly-meeting-${meeting.uri}`} className="cursor-pointer font-medium text-primary">
                  {meeting.name}
                </label>
              </DataTableCell>
              <DataTableCell muted>{meeting.durationMinutes} minutes</DataTableCell>
              <DataTableCell>
                <a
                  href={meeting.schedulingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  {meeting.schedulingUrl.replace(/^https?:\/\//, "")}
                  <ExternalLink className="size-3.5" />
                </a>
              </DataTableCell>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
      <DataTableFooter className="justify-end">
        <Button type="button" onClick={save} disabled={!chosen || saving}>
          {saving ? "Saving…" : "Use this meeting"}
        </Button>
      </DataTableFooter>
    </>
  )
}

function BookingAlertRow({ webhookState }: { webhookState: string | null }) {
  if (webhookState === "active") {
    return (
      <>
        <DataTableBadge tone="success">On</DataTableBadge>
        <p className="mt-1 text-muted-foreground">Calendly tells us as soon as someone books.</p>
      </>
    )
  }
  if (webhookState) {
    return (
      <>
        <DataTableBadge tone="danger">Off</DataTableBadge>
        <p className="mt-1 text-muted-foreground">
          Calendly has stopped telling us about new bookings. Click &quot;Disconnect&quot; below, then connect again to
          switch it back on.
        </p>
      </>
    )
  }
  return (
    <>
      <DataTableBadge tone="neutral">Not known yet</DataTableBadge>
      <p className="mt-1 text-muted-foreground">Calendly has not told us anything about this meeting yet.</p>
    </>
  )
}

/**
 * The coach's own confirmation that "Check for conflicts" is on. Ticking it
 * saves; unticking it clears it, because a coach who unticks is telling us the
 * confirmation no longer holds.
 */
function ConflictCheck({ confirmed, checkedOn }: { confirmed: boolean; checkedOn: string | null }) {
  const router = useRouter()
  const [ticked, setTicked] = useState(confirmed)
  const [saving, setSaving] = useState(false)

  // The server is the source of truth; re-sync when it answers.
  useEffect(() => setTicked(confirmed), [confirmed])

  const toggle = useCallback(
    async (next: boolean) => {
      setTicked(next)
      setSaving(true)
      try {
        const response = await fetch(CONFLICT_CHECK_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: next }),
        })
        if (!response.ok) {
          setTicked(!next)
          const body = await readJson(response)
          toast.error(errorFrom(body, "We could not save that just now. Try again in a moment."))
          return
        }
        router.refresh()
      } catch {
        setTicked(!next)
        toast.error("We could not save that just now. Try again in a moment.")
      } finally {
        setSaving(false)
      }
    },
    [router],
  )

  return (
    <div className="space-y-3 border-t border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-primary">Check for conflicts</h3>
        {ticked ? (
          <DataTableBadge tone="success">
            {checkedOn && confirmed ? `You checked this on ${checkedOn}` : "You checked this just now"}
          </DataTableBadge>
        ) : (
          <DataTableBadge tone="warning">You have not checked this yet</DataTableBadge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Calendly only avoids double-booking you if &quot;Check for conflicts&quot; is turned on for the calendar you
        use. We can&apos;t see that setting, so please check it yourself.
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <a
          href={CALENDLY_CALENDAR_SETTINGS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
        >
          Open Calendly&apos;s calendar settings
          <ExternalLink className="size-3.5" />
        </a>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary">
          <input
            type="checkbox"
            checked={ticked}
            disabled={saving}
            onChange={(event) => void toggle(event.target.checked)}
            className="size-4 accent-primary"
          />
          I&apos;ve checked that it&apos;s on
        </label>
      </div>
    </div>
  )
}

export function CalendarConnectionCard({ hasHost, connection, flash }: CalendarConnectionCardProps) {
  /** Survives the refresh after a disconnect, which is the only time it is set. */
  const [leftoverNotice, setLeftoverNotice] = useState<string | null>(null)

  const banner = leftoverNotice ? { tone: "warning" as const, message: leftoverNotice } : flash ? flash : null

  return (
    <div className="space-y-4">
      {banner ? (
        <div
          role="status"
          className={cn(
            "rounded-xl border p-4 text-sm text-primary",
            banner.tone === "success" ? "border-success/40 bg-success/5" : "border-accent/50 bg-accent/10",
          )}
        >
          {banner.message}
        </div>
      ) : null}

      {!hasHost ? (
        <Shell title="Your calendar" badge={{ tone: "neutral", label: "Nothing to connect yet" }}>
          <Prose>
            <p>This business has no calendar set up yet, so there is nothing to connect your Calendly to.</p>
            <p>Ask the person who set up your account to add one. Then come back to this page.</p>
          </Prose>
        </Shell>
      ) : connection === null ? (
        <Shell
          title="Your calendar"
          badge={{ tone: "neutral", label: "Not connected" }}
          actions={<ConnectButton label="Connect Calendly" />}
        >
          <Prose>
            <p>Connect your Calendly so bookings land here automatically.</p>
            <p>
              You keep your own Calendly account. We only read the times you are free, and Calendly tells us when
              someone books.
            </p>
            <p>
              Click &quot;Connect Calendly&quot;. Calendly asks you to say yes. Then we ask which of your Calendly
              meetings is the consult.
            </p>
          </Prose>
        </Shell>
      ) : connection.status === "needs_reconnect" ? (
        <Shell
          title="Your calendar"
          badge={{ tone: "danger", label: "Not working" }}
          actions={
            <>
              <ConnectButton label="Connect Calendly" />
              <DisconnectButton onDone={setLeftoverNotice} />
            </>
          }
        >
          <Prose>
            <p>Calendly no longer accepts our connection, so we cannot see your times or receive your bookings.</p>
            <p>
              This happens if you removed our access inside Calendly. Click &quot;Connect Calendly&quot; and say yes
              again. Your meetings and your past bookings are not changed.
            </p>
            <p>If you would rather stop using Calendly here, click &quot;Disconnect&quot;.</p>
          </Prose>
        </Shell>
      ) : connection.status === "plan_lapsed" ? (
        <Shell
          title="Your calendar"
          badge={{ tone: "warning", label: "Needs a paid Calendly plan" }}
          actions={<DisconnectButton onDone={setLeftoverNotice} />}
        >
          <Prose>
            <p>
              Calendly only sends us bookings on a paid plan (Standard, Teams or Enterprise). Upgrade in Calendly, then
              pick your meeting again.
            </p>
          </Prose>
          <MeetingPicker currentUri={connection.eventTypeUri} />
        </Shell>
      ) : connection.eventTypeUri === null ? (
        <Shell
          title="Which meeting is the consult?"
          badge={{ tone: "info", label: "Almost done" }}
          actions={<DisconnectButton onDone={setLeftoverNotice} />}
        >
          <Prose>
            <p>Your Calendly is connected. Now pick the meeting people book when they want a consult.</p>
            <p>We watch that one meeting. Every booking for it shows up on your Bookings page.</p>
            {connection.status === "error" ? (
              <p>
                Something went wrong the last time we spoke to Calendly. Picking your meeting again usually fixes it.
              </p>
            ) : null}
          </Prose>
          <MeetingPicker currentUri={connection.eventTypeUri} />
        </Shell>
      ) : (
        <Shell
          title="Your calendar"
          badge={
            connection.status === "error"
              ? { tone: "warning", label: "Needs a look" }
              : { tone: "success", label: "Connected" }
          }
          actions={<DisconnectButton onDone={setLeftoverNotice} />}
        >
          {connection.status === "error" ? (
            <Prose>
              <p>
                Something went wrong the last time we spoke to Calendly. If bookings stop arriving, click
                &quot;Disconnect&quot; and connect again.
              </p>
            </Prose>
          ) : null}
          <DataTable>
            <tbody>
              <DataTableRow>
                <DataTableCell muted className="w-48 align-top">
                  Calendly account
                </DataTableCell>
                <DataTableCell>
                  {connection.account ? (
                    <>
                      <span className="font-medium text-primary">{connection.account.name}</span>
                      <p className="mt-1 text-muted-foreground">{connection.account.email}</p>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {connection.accountReadFailed
                        ? "We could not check with Calendly just now. Load this page again in a moment."
                        : "Not known yet."}
                    </span>
                  )}
                </DataTableCell>
              </DataTableRow>
              <DataTableRow>
                <DataTableCell muted className="w-48 align-top">
                  Consult meeting
                </DataTableCell>
                <DataTableCell>
                  {connection.meeting ? (
                    <>
                      <span className="font-medium text-primary">{connection.meeting.name}</span>
                      <p className="mt-1 text-muted-foreground">{connection.meeting.durationMinutes} minutes</p>
                    </>
                  ) : connection.accountReadFailed ? (
                    <p className="text-muted-foreground">
                      We could not check with Calendly just now. Load this page again in a moment.
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      This meeting is no longer switched on in your Calendly. Switch it back on there, or pick another
                      meeting.
                    </p>
                  )}
                  {connection.schedulingUrl ? (
                    <a
                      href={connection.schedulingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                    >
                      {connection.schedulingUrl.replace(/^https?:\/\//, "")}
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </DataTableCell>
              </DataTableRow>
              <DataTableRow>
                <DataTableCell muted className="w-48 align-top">
                  New bookings
                </DataTableCell>
                <DataTableCell>
                  <BookingAlertRow webhookState={connection.webhookState} />
                </DataTableCell>
              </DataTableRow>
            </tbody>
          </DataTable>
          <ConflictCheck confirmed={connection.conflictConfirmed} checkedOn={connection.conflictCheckedOn} />
        </Shell>
      )}
    </div>
  )
}
