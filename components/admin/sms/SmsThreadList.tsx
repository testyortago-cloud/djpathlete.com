// components/admin/sms/SmsThreadList.tsx — one row per phone number.
//
// Built on `components/ui/data-table.tsx`, which is the house standard and
// not optional: CLAUDE.md records that /admin/team invented its own table —
// grey header bar, square corners — and now reads as a different app.
//
// TWO THINGS THE TABLE PRIMITIVES DO NOT DO FOR YOU:
//   * `DataTable` emits no `<tbody>`. This file supplies one.
//   * `DataTableEmpty` renders its OWN `<tr>`. Wrapping it in a
//     `DataTableRow` nests `<tr>` inside `<tr>`, and the empty row's
//     `colSpan` then spans nothing — the "nothing here" message goes narrow
//     and left-aligned under the first column instead of centred across the
//     table.
//
//     AND THE OBVIOUS TEST FOR THAT DOES NOT CATCH IT. This was measured, not
//     reasoned about: `querySelectorAll("tbody > tr").length === 1` STILL
//     PASSES with the wrapper in place. React builds the DOM with
//     `createElement`, so — unlike the HTML parser, which really does un-nest
//     a stray `<tr>` — nothing moves the inner row out; React logs a
//     `validateDOMNesting` warning and carries on, and the wrapper is then
//     the one and only `tbody > tr`. Do not copy that assertion into a new
//     page believing it guards anything.
//
//     `__tests__/app/admin-sms-list.test.tsx` therefore asserts what actually
//     breaks: the `td[colspan]`'s row must be a DIRECT child of the `<tbody>`
//     (`cell.parentElement.parentElement.tagName === "TBODY"`), and no `<tr>`
//     may sit inside another (`querySelectorAll("tr tr")` is empty). Those
//     two kill the wrapper mutation; the count alone does not.
//
// THE THREAD IS KEYED ON PHONE, NOT CONTACT (lib/db/sms-messages.ts says the
// same thing): a text from a number nobody has on file is still a
// conversation, and it must be reachable. That is what the name-or-number
// fallback in the first column is for — never an empty cell.
//
// Not a client component: there is nothing to interact with here, every row
// is a plain link. Light-only, like the rest of the admin — `.dark` is a
// class variant these components were never built against.

import Link from "next/link"
import { ArrowDownLeft, ArrowUpRight } from "lucide-react"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  type DataTableBadgeTone,
} from "@/components/ui/data-table"
import type { SmsDirection, SmsThreadSummary } from "@/lib/db/sms-messages"

export interface SmsThreadListProps {
  threads: SmsThreadSummary[]
  /**
   * The tenant's timezone, so "yesterday at 6pm" means yesterday where the
   * coach is. Defaults to UTC rather than to the RENDERING machine's zone:
   * this component renders on the server, and a formatter that reads the
   * server's local zone would print a different time on Vercel than in
   * development for the same row.
   */
  timezone?: string
}

/**
 * Carrier words, not our own vocabulary. `sms_messages.status` holds whatever
 * Twilio last called it (see `updateSmsStatusBySid` — the conversation shows
 * the carrier's own word deliberately), so this maps rather than assumes, and
 * anything unmapped falls through to a neutral pill with the raw word in it.
 */
const STATUS_TONE: Record<string, DataTableBadgeTone> = {
  received: "info",
  delivered: "success",
  sent: "neutral",
  queued: "neutral",
  accepted: "neutral",
  sending: "neutral",
  failed: "danger",
  undelivered: "danger",
}

function statusTone(status: string): DataTableBadgeTone {
  return STATUS_TONE[status] ?? "neutral"
}

function formatWhen(iso: string, timezone: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at)
}

function DirectionIcon({ direction }: { direction: SmsDirection }) {
  return direction === "inbound" ? (
    <ArrowDownLeft aria-hidden className="size-4 shrink-0 text-primary" />
  ) : (
    <ArrowUpRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
  )
}

export function SmsThreadList({ threads, timezone = "UTC" }: SmsThreadListProps) {
  return (
    <DataTableCard>
      <DataTable>
        <DataTableHeader>
          <DataTableHead>Who</DataTableHead>
          <DataTableHead>Last message</DataTableHead>
          <DataTableHead>Status</DataTableHead>
          <DataTableHead align="right">Texts</DataTableHead>
          <DataTableHead align="right">When</DataTableHead>
        </DataTableHeader>
        <tbody>
          {threads.map((thread) => {
            // The `+` has to be `%2B` in a path segment or the route receives
            // a space instead. The page decodes and re-normalises, so a raw
            // and an encoded number reach the same conversation.
            const href = `/admin/sms/${encodeURIComponent(thread.phone)}`
            return (
              <DataTableRow key={thread.phone}>
                <DataTableCell>
                  <Link href={href} className="font-medium text-primary hover:underline">
                    {thread.contactName ?? thread.phone}
                  </Link>
                  {thread.contactName ? (
                    <div className="text-xs text-muted-foreground">{thread.phone}</div>
                  ) : (
                    <div className="text-xs text-muted-foreground">Not in your contacts</div>
                  )}
                </DataTableCell>
                <DataTableCell>
                  <div className="flex max-w-md items-start gap-2">
                    <DirectionIcon direction={thread.lastDirection} />
                    <span className="line-clamp-2 text-foreground">{thread.lastBody}</span>
                  </div>
                </DataTableCell>
                <DataTableCell>
                  <DataTableBadge tone={statusTone(thread.lastStatus)}>{thread.lastStatus}</DataTableBadge>
                </DataTableCell>
                <DataTableCell align="right" muted>
                  {thread.messageCount}
                  {thread.inboundCount > 0 ? <span className="ml-1 text-xs">({thread.inboundCount} in)</span> : null}
                </DataTableCell>
                <DataTableCell align="right" muted>
                  <time dateTime={thread.lastOccurredAt}>{formatWhen(thread.lastOccurredAt, timezone)}</time>
                </DataTableCell>
              </DataTableRow>
            )
          })}
          {threads.length === 0 ? (
            // NOT wrapped in a DataTableRow — it brings its own <tr>.
            <DataTableEmpty colSpan={5}>
              No text conversations yet. One will appear here the moment someone texts you, or the moment a sequence
              texts them.
            </DataTableEmpty>
          ) : null}
        </tbody>
      </DataTable>
    </DataTableCard>
  )
}
