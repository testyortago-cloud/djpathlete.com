"use client"

// components/admin/contacts/ContactsTable.tsx — the contact list, and the one
// thing you do with it: put people into a sequence.
//
// ---------------------------------------------------------------------------
// THE CHECKBOXES ARE THE POINT.
// ---------------------------------------------------------------------------
// A contact's name and email already appear elsewhere (as a lead under
// /admin/funnels/leads, as a user under /admin/clients). What has never
// existed anywhere in this app is a way to CHOOSE some of them and act on the
// choice: `cold_lead_re_engagement` has sat in the database since migration
// 00218 with `trigger_source = NULL` — manual enrolment only — and no manual
// enrolment surface. So this is the first multi-select table in the admin, and
// it is deliberately plain: real `<input type="checkbox">` elements with real
// labels, not a bespoke widget, because the whole safety story here is that
// the operator can see exactly who they picked before they send email to them.
//
// Built on `components/ui/data-table.tsx`, which is the house standard and not
// optional: CLAUDE.md records that /admin/team invented its own table and now
// reads as a different app.
//
// ONLY THE VISIBLE ROWS CAN BE ENROLLED. The request is built by filtering the
// contacts currently on screen through the selection, not by sending the
// selection itself. A tick left behind by an earlier filter is therefore
// invisible AND harmless — the alternative is a request that enrols people the
// operator cannot see on the page they are looking at.
//
// AND THE SELECTION DOES NOT SPAN PAGES. Harmless is not the same as honest: a
// tick that survives off-page stops agreeing with the "N contacts ticked"
// counter and comes back to life when the operator pages back. Changing page
// clears the ticks, and the footer says so beside the buttons that do it.
//
// Light-only, like the rest of the admin: `.dark` is a class variant these
// components were never built against.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight, Mail, Phone, Search, Send, X } from "lucide-react"
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
} from "@/components/ui/data-table"
import type { ContactListRow } from "@/lib/db/contacts-list"
import type { SequenceSummary } from "@/lib/db/sequences"
import {
  MAX_ENROL_BATCH,
  describeEnrolResult,
  emptyTally,
  type EnrolResultMessage,
  type EnrolTally,
} from "@/lib/lead-engine/manual-enrol"

export interface ContactsTableProps {
  contacts: ContactListRow[]
  /** Tags per contact id. A plain object, not a Map — this crosses the server boundary. */
  tagsByContact?: Record<string, string[]>
  /** Every contact matching the filters, not just the ones on this page. */
  total: number
  /** 1-based, already validated by `parseContactFilters`. */
  page: number
  /** Rows per page, so this component can work out the first and last row numbers. */
  pageSize: number
  sequences: SequenceSummary[]
  /**
   * May the viewer actually enrol? Defaults to true so every existing caller
   * is unchanged. False hides the bulk enrol toolbar entirely -- see its own
   * comment in the markup below.
   */
  canEnrol?: boolean
  /**
   * The FILTERS only — `page` is deliberately not one of them. Every filter
   * change rebuilds the query string from this object, so a page number living
   * in here would survive a narrowing search and leave the operator on page 2
   * of a one-page result.
   */
  filters: { search: string; has: string; days: string }
}

/** Status pill tones. `active` is the only one that will actually send. */
const STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = {
  active: "success",
  draft: "warning",
  paused: "warning",
  archived: "neutral",
}

const MESSAGE_CLASS: Record<EnrolResultMessage["tone"], string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-accent/30 bg-accent/10 text-accent",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
}

export function ContactsTable(props: ContactsTableProps) {
  const router = useRouter()
  const [navigating, startTransition] = useTransition()
  const [search, setSearch] = useState(props.filters.search)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sequenceKey, setSequenceKey] = useState("")
  const [onePerContact, setOnePerContact] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<EnrolResultMessage | null>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)

  // Only what is on screen can be acted on — see this file's header.
  const selectedIds = useMemo(
    () => props.contacts.filter((contact) => selected.has(contact.id)).map((contact) => contact.id),
    [props.contacts, selected],
  )

  const allOnPageSelected = props.contacts.length > 0 && selectedIds.length === props.contacts.length
  const someOnPageSelected = selectedIds.length > 0 && !allOnPageSelected

  // `indeterminate` has no HTML attribute — it is a DOM property only, so it
  // has to be written after render. Without it "some selected" looks exactly
  // like "none selected", and the operator cannot tell the two apart.
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someOnPageSelected
  }, [someOnPageSelected])

  // PAGING CLEARS THE TICKS, and the footer says so out loud.
  //
  // An off-page tick was never dangerous — only the rows on screen are ever
  // posted, see this file's header — but it was not honest either. It survived
  // invisibly, the "N contacts ticked" counter stopped agreeing with it, and
  // paging back resurrected a selection made minutes and two pages ago. A
  // selection that spans pages the operator cannot see is exactly the thing
  // this table's checkboxes exist to prevent, so it does not span them.
  //
  // Only the PAGE does this, not a filter change: narrowing the list in place
  // is a person refining what is in front of them, and the visible ticks they
  // already made should survive it.
  const pageRef = useRef(props.page)
  useEffect(() => {
    if (pageRef.current === props.page) return
    pageRef.current = props.page
    setSelected(new Set())
    setResult(null)
  }, [props.page])

  const chosen = props.sequences.find((sequence) => sequence.key === sequenceKey) ?? null

  const setParam = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams()
      // `props.filters` carries no page, so any filter change lands on page 1
      // and only an explicit `{ page }` update moves off it.
      const next: Record<string, string> = { ...props.filters, ...updates }
      for (const [key, value] of Object.entries(next)) {
        if (value && value !== "all") params.set(key, value)
      }
      startTransition(() => router.push(`/admin/contacts?${params.toString()}`))
    },
    [props.filters, router],
  )

  const lastPage = Math.max(1, Math.ceil(props.total / props.pageSize))
  const firstRow = (props.page - 1) * props.pageSize + 1
  const lastRow = firstRow + props.contacts.length - 1
  const goToPage = useCallback(
    (page: number) => {
      // Page 1 is the default, so it stays out of the URL — a shared link reads
      // as the filter it is, not as the filter plus its first page.
      setParam({ page: page <= 1 ? "" : String(page) })
    },
    [setParam],
  )

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((current) => {
      const next = new Set(current)
      const everyoneHere = props.contacts.every((contact) => next.has(contact.id))
      for (const contact of props.contacts) {
        if (everyoneHere) next.delete(contact.id)
        else next.add(contact.id)
      }
      return next
    })
  }, [props.contacts])

  // Why the button cannot be pressed, in the words of the thing that is
  // missing. A disabled button with no explanation is the single most common
  // way an admin screen wastes somebody's afternoon.
  const blockedBecause = !chosen
    ? "Pick a sequence first."
    : selectedIds.length === 0
      ? "Tick at least one contact."
      : selectedIds.length > MAX_ENROL_BATCH
        ? `Too many at once — pick at most ${MAX_ENROL_BATCH}.`
        : null

  const enrol = useCallback(async () => {
    if (!chosen || selectedIds.length === 0 || sending) return
    setSending(true)
    setResult(null)
    try {
      const response = await fetch("/api/admin/sequences/enrol", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: selectedIds, sequenceKey: chosen.key, onePerContact }),
      })
      const body = (await response.json().catch(() => null)) as {
        tally?: EnrolTally
        failedContactIds?: string[]
        sequenceStatus?: string | null
        error?: string
      } | null

      // THE TALLY IS READ BEFORE THE STATUS CODE, on purpose.
      //
      // The route answers 500 when a batch enrolled nobody and something threw,
      // so `withAudit` records a failure and the 24h-failure strip on
      // /admin/audit-logs can see it — but it sends the tally back with it,
      // because the server WAS reached and the tally is the true story. Checking
      // `response.ok` first would throw that away and print "could not reach the
      // server", which is the one thing that definitely did not happen.
      //
      // A 400 or a 403 carries an `error` and no tally, so those still land in
      // the branch below and show the server's own words.
      if (!body?.tally) {
        const message = body?.error ?? "Could not reach the server. Nobody was enrolled."
        setResult({ tone: "error", headline: message })
        toast.error(message)
        return
      }

      // The tally is reported as it came back — including the case where every
      // single attempt was refused because the sequence is a draft. That is
      // the FIRST thing a real user hits here, and calling it a generic
      // failure would send them hunting a bug that does not exist.
      const message = describeEnrolResult({
        tally: { ...emptyTally(), ...body.tally },
        sequenceName: chosen.name,
        sequenceStatus: body.sequenceStatus ?? null,
      })
      setResult(message)
      if (message.tone === "success") toast.success(message.headline)
      else if (message.tone === "warning") toast.warning(message.headline)
      else toast.error(message.headline)

      // WHAT STAYS TICKED IS WHATEVER STILL NEEDS DOING.
      //
      //   * Contacts that threw come back by id, and are re-ticked on their
      //     own. "3 contacts could not be enrolled — try those again" used to
      //     be an instruction nobody could follow: the response carried counts,
      //     the audit row carries no ids by design, no row on the page was
      //     marked as failed, and this line then cleared every tick. Retrying
      //     three of ten meant re-ticking all ten and enrolling the seven that
      //     had already worked. Now the three are ticked and the button is one
      //     click away. `describeEnrolResult` says so in as many words, so the
      //     wording and this line have to stay wired together.
      //   * A whole-batch refusal — a draft sequence — keeps the selection,
      //     because the next step is to switch the sequence on and press Enrol
      //     again with the same people.
      //   * Anything else clears, so a finished job does not look unfinished.
      const failedIds = body.failedContactIds ?? []
      if (failedIds.length > 0) setSelected(new Set(failedIds))
      else if (message.tone !== "error") setSelected(new Set())
      startTransition(() => router.refresh())
    } catch {
      const message = "Could not reach the server. Nobody was enrolled."
      setResult({ tone: "error", headline: message })
      toast.error(message)
    } finally {
      setSending(false)
    }
  }, [chosen, onePerContact, router, selectedIds, sending])

  const hasFilter = props.filters.search !== "" || props.filters.has !== "" || props.filters.days !== ""

  return (
    <DataTableCard>
      <DataTableToolbar className="flex-wrap gap-2">
        <form
          className="relative min-w-[14rem] flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            setParam({ search })
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email or phone"
            aria-label="Search contacts"
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm outline-none focus-visible:border-accent"
          />
        </form>

        <select
          aria-label="Filter by what you can reach them on"
          value={props.filters.has || "all"}
          onChange={(event) => setParam({ has: event.target.value })}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="all">Everyone</option>
          <option value="email">Has an email address</option>
          <option value="phone">Has a phone number</option>
        </select>

        <select
          aria-label="Filter by when they were added"
          value={props.filters.days || "all"}
          onChange={(event) => setParam({ days: event.target.value })}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="all">Any time</option>
          <option value="7">Added in the last 7 days</option>
          <option value="30">Added in the last 30 days</option>
          <option value="90">Added in the last 90 days</option>
        </select>

        {hasFilter ? (
          <Button variant="ghost" size="sm" onClick={() => setParam({ search: "", has: "", days: "" })}>
            <X className="size-4" aria-hidden />
            Clear
          </Button>
        ) : null}
      </DataTableToolbar>

      {/* HIDDEN when the viewer cannot use it. This posts to
          /api/admin/sequences/enrol, which is NOT in PATH_PERMISSIONS and
          whose handler still requires role === "admin" -- so for a coach it
          403s twice over. Correct as a gate, but a fully populated sequence
          picker that always refuses reads as a broken app rather than as a
          boundary, which is the same reason filterNavForActor drops links a
          teammate cannot open. Shown for anyone who can actually enrol. */}
      {props.canEnrol === false ? null : (
      <DataTableToolbar className="flex-wrap items-center gap-2 bg-surface/30">
        <label className="sr-only" htmlFor="sequence-picker">
          Sequence to enrol into
        </label>
        <select
          id="sequence-picker"
          value={sequenceKey}
          onChange={(event) => {
            setSequenceKey(event.target.value)
            setResult(null)
          }}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="">Choose a sequence…</option>
          {props.sequences.map((sequence) => (
            <option key={sequence.id} value={sequence.key}>
              {sequence.name}
              {sequence.status === "active" ? "" : ` (${sequence.status})`}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={onePerContact}
            onChange={(event) => setOnePerContact(event.target.checked)}
            className="size-4 rounded border-border accent-primary"
          />
          Skip anyone who has been in it before
        </label>

        <div className="flex flex-1 items-center justify-end gap-3">
          <span className="text-sm text-muted-foreground">
            {selectedIds.length === 0
              ? "No contacts ticked"
              : `${selectedIds.length} ${selectedIds.length === 1 ? "contact" : "contacts"} ticked`}
          </span>
          <Button
            size="sm"
            onClick={() => void enrol()}
            disabled={blockedBecause !== null || sending}
            title={blockedBecause ?? undefined}
          >
            <Send className="size-4" aria-hidden />
            {sending ? "Enrolling…" : "Enrol selected"}
          </Button>
        </div>

        {blockedBecause ? <p className="w-full text-xs text-muted-foreground">{blockedBecause}</p> : null}

        {/* Said BEFORE the click, not only after it. Every sequence in this
            database is seeded as a draft on purpose, so without this warning
            the first thing a coach learns about that is a red box telling them
            nothing happened. */}
        {chosen && chosen.status !== "active" ? (
          <p className="w-full text-xs text-accent">
            &ldquo;{chosen.name}&rdquo; is {chosen.status === "draft" ? "still a draft" : chosen.status}. Nothing will
            be sent until someone switches it on, and enrolling now will add nobody.
          </p>
        ) : null}

        {chosen && chosen.status === "active" ? (
          <p className="w-full text-xs text-muted-foreground">
            Enrolling starts sending &ldquo;{chosen.name}&rdquo; to the contacts you ticked. This is real email to real
            people.
          </p>
        ) : null}

        {result ? (
          <div role="status" className={`w-full rounded-lg border px-3 py-2 text-sm ${MESSAGE_CLASS[result.tone]}`}>
            <p className="font-medium">{result.headline}</p>
            {result.detail ? <p className="mt-0.5 opacity-90">{result.detail}</p> : null}
          </div>
        ) : null}
      </DataTableToolbar>
      )}

      <DataTable>
        {/* No <tr> here — DataTableHeader renders the row itself. */}
        <DataTableHeader>
          <DataTableHead className="w-10">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allOnPageSelected}
              onChange={toggleAll}
              disabled={props.contacts.length === 0}
              aria-label="Select every contact on this page"
              className="size-4 rounded border-border accent-primary"
            />
          </DataTableHead>
          <DataTableHead>Name</DataTableHead>
          <DataTableHead>Email</DataTableHead>
          <DataTableHead>Phone</DataTableHead>
          <DataTableHead>Added</DataTableHead>
        </DataTableHeader>
        <tbody>
          {props.contacts.length === 0 ? (
            <DataTableEmpty colSpan={5}>
              {/* A page past the end is its own answer, and it has a next step.
                  Without this it read as "no contacts match these filters",
                  which is the opposite of true when the footer above it is
                  counting 166 of them. */}
              {props.page > 1 ? (
                <>
                  There is nothing on page {props.page}.{" "}
                  <button type="button" className="underline underline-offset-2" onClick={() => goToPage(1)}>
                    Go back to the first page
                  </button>
                  .
                </>
              ) : hasFilter ? (
                "No contacts match these filters."
              ) : (
                "No contacts yet. They appear here the moment someone fills in a form on a published page."
              )}
            </DataTableEmpty>
          ) : (
            props.contacts.map((contact) => {
              const label = contact.name ?? contact.email ?? contact.phone_e164 ?? "this contact"
              const isSelected = selected.has(contact.id)
              return (
                <DataTableRow key={contact.id} className={isSelected ? "bg-primary/5" : undefined}>
                  <DataTableCell>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(contact.id)}
                      aria-label={`Select ${label}`}
                      className="size-4 rounded border-border accent-primary"
                    />
                  </DataTableCell>
                  <DataTableCell className="font-medium text-foreground">
                    {/* TWO TARGETS IN ONE ROW, AND THEIR NAMES MUST NOT OVERLAP.
                        The checkbox beside this is labelled `Select ${label}`.
                        Playwright's `name` matcher is a SUBSTRING match, so a
                        link named plainly "Sam Athlete" would also be matched
                        by a query for the checkbox's name and vice versa. The
                        visually-hidden suffix gives the link an accessible name
                        ("Sam Athlete — open contact record") that neither
                        contains nor is contained by the checkbox's, while still
                        beginning with the visible text so it satisfies WCAG
                        2.5.3 Label in Name.

                        prefetch={false} IS NOT AN OPTIMISATION. Opening this
                        page writes a `contact.viewed` audit row, and the page is
                        `force-dynamic`. Left to prefetch, Next would render it
                        on hover or as rows enter the viewport, filling the
                        sensitive-read trail with views nobody performed — which
                        is worse than having no trail at all. */}
                    <Link
                      href={`/admin/contacts/${contact.id}`}
                      prefetch={false}
                      className="rounded-sm underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {contact.name ?? "View record"}
                      <span className="sr-only"> — open contact record</span>
                    </Link>
                    {/* Tags live under the name rather than in their own column:
                        a sixth column would push the phone and date off a laptop
                        screen, and the empty-state colSpan={5} would have to
                        change with it. */}
                    {(props.tagsByContact?.[contact.id] ?? []).length > 0 ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {(props.tagsByContact?.[contact.id] ?? []).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell>
                    {contact.email ? (
                      <a
                        className="inline-flex items-center gap-1.5 hover:text-primary"
                        href={`mailto:${contact.email}`}
                      >
                        <Mail className="size-3.5 text-muted-foreground" aria-hidden />
                        {contact.email}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </DataTableCell>
                  <DataTableCell>
                    {contact.phone_e164 ? (
                      <a
                        className="inline-flex items-center gap-1.5 hover:text-primary"
                        href={`tel:${contact.phone_e164}`}
                      >
                        <Phone className="size-3.5 text-muted-foreground" aria-hidden />
                        {contact.phone_e164}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </DataTableCell>
                  <DataTableCell muted>
                    <time dateTime={contact.created_at}>{formatAdded(contact.created_at)}</time>
                  </DataTableCell>
                </DataTableRow>
              )
            })
          )}
        </tbody>
      </DataTable>

      <DataTableFooter className="flex-wrap gap-3">
        <span className="text-sm text-muted-foreground">
          {props.total === 1 ? "1 contact" : `${props.total.toLocaleString()} contacts`}
          {/* WHICH rows these are, not just how many of them. "showing 100"
              on page 2 of 166 is true and useless — the operator needs to know
              they are looking at 101 onwards. */}
          {props.contacts.length < props.total && props.contacts.length > 0
            ? ` · showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${props.total.toLocaleString()}`
            : ""}
          {navigating ? " · updating…" : ""}
        </span>

        {lastPage > 1 ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            {/* Said where the buttons are, because it is the button that does
                it. A rule the operator only discovers by losing a selection is
                not a rule, it is a trap. */}
            <span className="text-xs">Ticks clear when you change page.</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Previous page"
              disabled={props.page <= 1 || navigating}
              onClick={() => goToPage(props.page - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden />
              Back
            </Button>
            <span className="tabular-nums">
              Page {props.page} of {lastPage}
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Next page"
              disabled={props.page >= lastPage || navigating}
              onClick={() => goToPage(props.page + 1)}
            >
              Next
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </span>
        ) : null}

        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          Sequences
          {props.sequences.length === 0 ? (
            <DataTableBadge tone="neutral">none set up</DataTableBadge>
          ) : (
            <DataTableBadge tone={STATUS_TONE[chosen?.status ?? ""] ?? "neutral"}>
              {chosen ? chosen.status : `${props.sequences.length} to choose from`}
            </DataTableBadge>
          )}
        </span>
      </DataTableFooter>
    </DataTableCard>
  )
}

/** Absolute, not relative: most of these were imported and are years old. */
function formatAdded(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return "—"
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}
