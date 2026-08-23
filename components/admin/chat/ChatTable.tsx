"use client"

// components/admin/chat/ChatTable.tsx — what the public assistant has been
// saying, and to whom.
//
// Built on `components/ui/data-table.tsx`, which is the house standard and not
// optional: CLAUDE.md records that /admin/team invented its own table — grey
// header bar, tighter rows, square corners — and now reads as a different app.
//
// THE BADGES ARE THE COLUMN THAT MATTERS. An operator opening this page is not
// reading transcripts, they are scanning for the three things worth their
// attention, and the tones are fixed by spec §6.3 so they mean the same thing
// here as everywhere else in the admin:
//
//   Escalated  warning  — a person was asked to pick this up
//   Captured   success  — it produced a contact
//   N blocked  danger   — the output validator stopped a reply from reaching
//                         the visitor. This is the honesty control's own
//                         record, and it is the number this feature is judged
//                         on
//   Answered   neutral  — an ordinary conversation
//
// A conversation can be more than one of those at once and all of them are
// shown. Picking the "most important" one would hide, for example, that the
// conversation which produced a contact also had a reply blocked in it.
//
// THE FILTER LIVES IN THE URL, not in component state — the /admin/contacts
// precedent. A filtered view is a link, so "the conversations where a reply
// was blocked" is something a person can bookmark, share, and come back to.
//
// Light-only, like the rest of the admin: `.dark` is a class variant these
// components were never built against.

import { useCallback, useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"
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
import type { ChatConversationListRow } from "@/lib/db/chat"

export interface ChatTableProps {
  conversations: ChatConversationListRow[]
  /** Every conversation matching the filter, not just the ones on this page. */
  total: number
  /** 1-based, already validated by `parseChatFilters`. */
  page: number
  /** Rows per page, so this component can work out the first and last row numbers. */
  pageSize: number
  /**
   * The FILTER only — `page` is deliberately not part of it. Changing the
   * filter rebuilds the query string from this object, so a page number living
   * in here would survive a narrowing filter and leave the operator on page 2
   * of a one-page result.
   */
  filters: { show: string }
}

const FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Every conversation" },
  { value: "escalated", label: "Handed to a person" },
  { value: "captured", label: "Gave their details" },
  { value: "blocked", label: "A reply was blocked" },
]

const COLUMN_COUNT = 6

export function ChatTable(props: ChatTableProps) {
  const router = useRouter()
  const [navigating, startTransition] = useTransition()
  const [show, setShow] = useState(props.filters.show || "all")

  // THE BOX RE-SYNCS WHEN THE URL CHANGES UNDERNEATH IT.
  //
  // The select is held locally so it moves the instant it is clicked, rather
  // than waiting for the server round trip. That is fine going forwards and
  // wrong going backwards: pressing the browser's Back button changes the rows
  // without changing local state, and the box would then say "Every
  // conversation" over a table showing only the escalated ones.
  //
  // The dependency array is the whole guard. An earlier version of this also
  // held a ref to skip the mount run, in the shape ContactsTable uses for its
  // page effect — but that ref could not be mutated into a failing test,
  // because removing it changes nothing: the effect only re-runs when the prop
  // moves, and on mount it writes the value state already holds.
  useEffect(() => {
    setShow(props.filters.show || "all")
  }, [props.filters.show])

  const setParam = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams()
      // `props.filters` carries no page, so any filter change lands on page 1
      // and only an explicit `{ page }` update moves off it.
      const next: Record<string, string> = { ...props.filters, ...updates }
      for (const [key, value] of Object.entries(next)) {
        // "all" is the default and stays out of the URL, so a shared link
        // reads as the filter it is rather than as a filter plus its default.
        if (value && value !== "all") params.set(key, value)
      }
      const query = params.toString()
      startTransition(() => router.push(query ? `/admin/chat?${query}` : "/admin/chat"))
    },
    [props.filters, router],
  )

  const lastPage = Math.max(1, Math.ceil(props.total / props.pageSize))
  const firstRow = (props.page - 1) * props.pageSize + 1
  const lastRow = firstRow + props.conversations.length - 1
  const goToPage = useCallback(
    (page: number) => {
      // Page 1 is the default, so it stays out of the URL.
      setParam({ page: page <= 1 ? "" : String(page) })
    },
    [setParam],
  )

  const filtered = (props.filters.show || "all") !== "all"

  return (
    <DataTableCard>
      <DataTableToolbar className="flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="chat-filter">
          Which conversations to show
        </label>
        <select
          id="chat-filter"
          value={show}
          onChange={(event) => {
            setShow(event.target.value)
            setParam({ show: event.target.value })
          }}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
        >
          {FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <p className="text-sm text-muted-foreground">Most recently active first.</p>
      </DataTableToolbar>

      <DataTable>
        {/* No <tr> here — DataTableHeader renders the row itself. */}
        <DataTableHeader>
          <DataTableHead>Started</DataTableHead>
          <DataTableHead>Last message</DataTableHead>
          <DataTableHead>Page they were on</DataTableHead>
          <DataTableHead align="right">Messages</DataTableHead>
          <DataTableHead align="right">Tokens</DataTableHead>
          <DataTableHead>What happened</DataTableHead>
        </DataTableHeader>
        <tbody>
          {props.conversations.length === 0 ? (
            <DataTableEmpty colSpan={COLUMN_COUNT}>
              {/* A filtered empty list and an empty database are different
                  answers, and saying the second when the first is true is a
                  lie about the assistant. (A failed READ is a third answer
                  again — that one never reaches this component, because the
                  page does not catch it.) */}
              {props.page > 1 ? (
                <>
                  There is nothing on page {props.page}.{" "}
                  <button type="button" className="underline underline-offset-2" onClick={() => goToPage(1)}>
                    Go back to the first page
                  </button>
                  .
                </>
              ) : filtered ? (
                "No conversations match this filter."
              ) : (
                "No conversations yet. They appear here as soon as someone asks the assistant a question."
              )}
            </DataTableEmpty>
          ) : (
            props.conversations.map((conversation) => (
              <DataTableRow key={conversation.id}>
                <DataTableCell className="font-medium text-foreground">
                  <Link
                    href={`/admin/chat/${conversation.id}`}
                    aria-label={`View the transcript from ${formatMoment(conversation.created_at)}`}
                    className="underline-offset-2 hover:text-primary hover:underline"
                  >
                    <time dateTime={conversation.created_at}>{formatMoment(conversation.created_at)}</time>
                  </Link>
                </DataTableCell>
                <DataTableCell muted>
                  <time dateTime={conversation.last_activity_at}>{formatMoment(conversation.last_activity_at)}</time>
                </DataTableCell>
                <DataTableCell muted>{conversation.landing_path || "—"}</DataTableCell>
                <DataTableCell align="right" className="tabular-nums">
                  {conversation.message_count}
                </DataTableCell>
                <DataTableCell align="right" className="tabular-nums text-muted-foreground">
                  {conversation.tokens_used.toLocaleString()}
                </DataTableCell>
                <DataTableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {outcomesOf(conversation).map((outcome) => (
                      <DataTableBadge key={outcome.label} tone={outcome.tone}>
                        {outcome.label}
                      </DataTableBadge>
                    ))}
                  </span>
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </tbody>
      </DataTable>

      <DataTableFooter className="flex-wrap gap-3">
        <span className="text-sm text-muted-foreground">
          {props.total === 1 ? "1 conversation" : `${props.total.toLocaleString()} conversations`}
          {/* WHICH rows these are, not just how many. "showing 25" on page 2
              is true and useless. */}
          {props.conversations.length < props.total && props.conversations.length > 0
            ? ` · showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${props.total.toLocaleString()}`
            : ""}
          {navigating ? " · updating…" : ""}
        </span>

        {lastPage > 1 ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
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
      </DataTableFooter>
    </DataTableCard>
  )
}

type Outcome = { label: string; tone: "neutral" | "success" | "warning" | "danger" }

/**
 * Every outcome this conversation had, in the order an operator triages them:
 * a handover needs answering today, a captured lead needs following up, and a
 * blocked reply needs reading. Tones are fixed by spec §6.3.
 */
function outcomesOf(conversation: ChatConversationListRow): Outcome[] {
  const outcomes: Outcome[] = []
  if (conversation.escalated_at) outcomes.push({ label: "Escalated", tone: "warning" })
  if (conversation.captured_at) outcomes.push({ label: "Captured", tone: "success" })
  if (conversation.blocked_count > 0) {
    outcomes.push({ label: `${conversation.blocked_count} blocked`, tone: "danger" })
  }
  if (outcomes.length === 0) {
    // "Answered" would be a claim, not a fact, on a conversation that has no
    // messages in it — a session that was opened and abandoned.
    outcomes.push({ label: conversation.message_count === 0 ? "No messages" : "Answered", tone: "neutral" })
  }
  return outcomes
}

/** Date and time — these are minutes apart, so a date alone tells nobody anything. */
function formatMoment(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return "—"
  return then.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}
