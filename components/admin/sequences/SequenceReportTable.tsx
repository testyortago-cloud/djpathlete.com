import Link from "next/link"
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
import { SequenceSwitch } from "@/components/admin/sequences/SequenceSwitch"
import type { SequenceReportRow } from "@/lib/db/sequence-reporting"

// Exported so the detail screen (app/(admin)/admin/sequences/[key]/page.tsx)
// can show the exact same words next to its own copy of the switch — two
// screens describing one sequence's status must not drift apart.
export const STATUS_TONE: Record<string, DataTableBadgeTone> = {
  active: "success",
  paused: "warning",
  draft: "neutral",
  archived: "neutral",
}

// Bound to §4.1 of the design doc: "paused" reads as "Turned off" and
// "draft" reads as "Never turned on" everywhere in this feature, not just on
// the switch. Whole-branch review reversed an earlier Task 7+8 ruling that
// kept the pre-existing "Paused"/"Not started" wording — that ruling
// contradicted the spec (a ruling is not a spec amendment) and left three
// vocabularies on screen for one state: this badge, the "Switched off, so
// nobody is being added..." sentence below, and a switch labelled "Turn on".
export const STATUS_LABEL: Record<string, string> = {
  active: "On",
  paused: "Turned off",
  draft: "Never turned on",
  archived: "Archived",
}

/**
 * Why nobody has entered this sequence — in words a non-programmer can act on.
 *
 * A page of zeros reads as broken. On production today eight of the nine
 * sequences have never run, and for two of them the reason is simply that they
 * are switched off — which is a thirty-second fix if you can see it, and
 * invisible if you cannot.
 *
 * The "paused" sentence used to say "so nobody new is being added" — true
 * before migration 00256, false after it. The tick now refuses to claim a run
 * at all while its sequence is off, so switching off stops EVERYONE, not just
 * new arrivals. Saying only half of that would leave a coach believing the
 * people already inside were still being messaged.
 */
function whyEmpty(row: SequenceReportRow): string {
  if (row.status === "paused") return "Switched off, so nobody is being added and nobody is moving through it."
  if (row.status === "draft") return "Not switched on yet."
  if (row.status === "archived") return "Archived."
  if (!row.trigger_source) return "Nobody yet — people are only added to this one by hand."
  if (row.trigger_source === "funnel_form") return "Nobody yet — waiting on a funnel form."
  if (row.trigger_source === "quiz") return "Nobody yet — waiting on a quiz result."
  if (row.trigger_source === "newsletter") return "Nobody yet — waiting on a newsletter sign-up."
  if (row.trigger_source === "lead_magnet") return "Nobody yet — waiting on a download."
  return "Nobody has entered this one yet."
}

/**
 * The sentence that stops a red number reading as a broken screen.
 *
 * The only sequence on production with any people in it has 73, and nothing was
 * sent to any of them. A bare "73" in a column headed "Something went wrong"
 * looks like the page is at fault. This says what actually happened and where
 * the reason is written down.
 *
 * Deliberately NOT inside the "nobody has entered this yet" branch: a sequence
 * can have plenty of people in it and still have failed some of them, and that
 * is the case worth reading.
 */
function failedNote(count: number): string {
  return count === 1
    ? "Nothing was sent to 1 of these people. Open the sequence to see why."
    : `Nothing was sent to ${count} of these people. Open the sequence to see why.`
}

export function SequenceReportTable({
  rows,
  isAdmin = true,
}: {
  rows: SequenceReportRow[]
  /**
   * Whether the viewer may actually flip the switch — turning a sequence on
   * or off is admin-only (§4.8 of the design doc; the routes behind this
   * control never loosen for staff). Defaults to `true` so every existing
   * caller keeps today's behaviour; the page passes the real answer.
   * A staff viewer sees the plain On/Off reading instead of a control that
   * can only ever answer 403.
   */
  isAdmin?: boolean
}) {
  return (
    <DataTableCard>
      <DataTable>
        <DataTableHeader>
          <DataTableHead>On</DataTableHead>
          <DataTableHead>Sequence</DataTableHead>
          <DataTableHead align="right">Entered</DataTableHead>
          <DataTableHead align="right">Still going</DataTableHead>
          <DataTableHead align="right">Bought</DataTableHead>
          <DataTableHead align="right">Booked a call</DataTableHead>
          <DataTableHead align="right">Opted out</DataTableHead>
          <DataTableHead align="right">Reached the end</DataTableHead>
          <DataTableHead align="right">Something went wrong</DataTableHead>
          {/* Three of the seven things that can happen have no column of their
              own — somebody's details were merged into another person's
              record, they were already in this sequence under a second
              record, or the sequence was edited while they were partway
              through it. Without this column the row's numbers visibly stop
              adding up to Entered. */}
          <DataTableHead align="right">Something else</DataTableHead>
        </DataTableHeader>
        <tbody>
          {rows.length === 0 ? (
            <DataTableEmpty colSpan={10}>No sequences have been set up yet.</DataTableEmpty>
          ) : (
            rows.map((row) => (
              <DataTableRow key={row.id}>
                <DataTableCell>
                  {isAdmin ? (
                    <SequenceSwitch sequenceKey={row.key} sequenceName={row.name} status={row.status} />
                  ) : (
                    // A control that can only ever answer 403 is worse than
                    // no control — this is hiding a button that cannot work,
                    // not granting access the routes themselves still refuse.
                    <span className="text-sm text-muted-foreground">{row.status === "active" ? "On" : "Off"}</span>
                  )}
                </DataTableCell>
                <DataTableCell>
                  <Link href={`/admin/sequences/${row.key}`} className="font-medium text-primary hover:underline">
                    {row.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <DataTableBadge tone={STATUS_TONE[row.status] ?? "neutral"}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </DataTableBadge>
                    {row.entered === 0 ? <span className="text-xs text-muted-foreground">{whyEmpty(row)}</span> : null}
                    {row.buckets.failed > 0 ? (
                      <span className="text-xs text-muted-foreground">{failedNote(row.buckets.failed)}</span>
                    ) : null}
                  </div>
                </DataTableCell>
                <DataTableCell align="right" className="font-medium">
                  {row.entered}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.in_progress === 0}>
                  {row.buckets.in_progress}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.bought === 0}>
                  {row.buckets.bought}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.booked === 0}>
                  {row.buckets.booked}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.opted_out === 0}>
                  {row.buckets.opted_out}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.finished === 0}>
                  {row.buckets.finished}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.failed === 0}>
                  {row.buckets.failed}
                </DataTableCell>
                <DataTableCell align="right" muted={row.buckets.other === 0}>
                  {row.buckets.other}
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </tbody>
      </DataTable>
    </DataTableCard>
  )
}
