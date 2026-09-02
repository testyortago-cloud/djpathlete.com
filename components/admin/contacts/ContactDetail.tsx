// components/admin/contacts/ContactDetail.tsx — one person's record, drawn.
//
// A SERVER COMPONENT. Only the tag pills write, and they are their own client
// island (ContactTags.tsx). Everything here is presentation over data the page
// already read, which keeps the whole screen out of the browser bundle.
//
// CONSENT AND SUPPRESSION ARE TWO SECTIONS, NOT ONE "subscribed: yes/no".
// That is the entire reason `contact_consents` and `contact_suppressions` are
// separate tables (migration 00215) — they answer different questions:
//
//   * A CONSENT row says "on this date, this person agreed to this wording."
//     It is dated evidence, it is per channel, and it keeps the words that were
//     actually on screen at the time. It is what you show a regulator.
//   * A SUPPRESSION row says "do not contact this identifier." It is keyed by
//     the email address or phone number rather than by contact, deliberately,
//     so it survives a merge, a deletion, and the same person arriving again
//     months later under a new record.
//
// Collapsing them would lose the distinction that makes either useful. A person
// can have granted email consent AND be suppressed; that is not a contradiction,
// it is the normal state of someone who signed up and later unsubscribed.
//
// UNSUPPRESSION IS A DELETE, NOT A ROW. `unsuppress` (lib/db/contact-consents.ts)
// removes the suppression rather than appending a "re-subscribed" row. So an
// absent suppression means "not suppressed right now" and NEVER "was never
// suppressed" — the copy below says exactly that and does not overclaim.
//
// House table chrome throughout, per CLAUDE.md. Light-only.

import Link from "next/link"
import { ArrowLeft, CalendarCheck, CreditCard, History, Mail, Phone, ShieldCheck, Workflow } from "lucide-react"
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
import { ContactTags } from "@/components/admin/contacts/ContactTags"
import { ContactEnrol } from "@/components/admin/contacts/ContactEnrol"
import type { SequenceSummary } from "@/lib/db/sequences"
import {
  BOOKINGS_WINDOW,
  TIMELINE_WINDOW,
  type ContactDetail as ContactDetailData,
  type TimelineOrigin,
  type TimelineTone,
} from "@/lib/db/contact-detail"

/** The semantic tone the pure merge produced, mapped onto the house badge tones. */
const TONE: Record<TimelineTone, DataTableBadgeTone> = {
  neutral: "neutral",
  success: "success",
  warning: "warning",
  info: "info",
  danger: "danger",
}

const ORIGIN_LABEL: Record<TimelineOrigin, string> = {
  event: "Activity",
  payment: "Payment",
  booking: "Booking",
}

function formatDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

function formatDayTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  })
}

function SectionHeading({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {icon}
      <h2 className="text-lg font-semibold text-primary">{title}</h2>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

export function ContactDetail({ data, sequences = [] }: { data: ContactDetailData; sequences?: SequenceSummary[] }) {
  const { contact, timeline, consents, suppressions, runs, tags } = data

  const displayName = contact.name ?? contact.email ?? contact.phone_e164 ?? "Contact"

  // The LATEST consent row per channel is the one that counts — the table is an
  // append-only history, so an old "granted" sitting under a newer "withdrawn"
  // must not be what the screen reports. The rows arrive newest-first.
  const latestEmailConsent = consents.find((row) => row.channel === "email") ?? null
  const latestSmsConsent = consents.find((row) => row.channel === "sms") ?? null

  return (
    <div>
      <Link
        href="/admin/contacts"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to Contacts
      </Link>

      {/* Header */}
      <div className="mb-6 rounded-xl border border-border bg-white p-6 shadow-sm">
        {/* Name on the left, the one ACTION on the right — the layout the design
            sketch specifies:
              ┌─ Jane Smith ──────────────── [ Add to a sequence ] ─┐ */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold text-primary">{displayName}</h1>
          <ContactEnrol contactId={contact.id} contactLabel={displayName} sequences={sequences} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {contact.email ? (
            <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1.5 hover:text-primary">
              <Mail className="size-3.5" aria-hidden />
              {contact.email}
            </a>
          ) : null}
          {contact.phone_e164 ? (
            <a href={`tel:${contact.phone_e164}`} className="inline-flex items-center gap-1.5 hover:text-primary">
              <Phone className="size-3.5" aria-hidden />
              {contact.phone_e164}
            </a>
          ) : null}
          <span>Added {formatDay(contact.created_at)}</span>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <ContactTags contactId={contact.id} tags={tags} />
        </div>
      </div>

      {/* Consent */}
      <section className="mb-6">
        <SectionHeading
          icon={<ShieldCheck className="size-5 text-primary" aria-hidden />}
          title="Permission to contact them"
        />
        <DataTableCard>
          <DataTable>
            <DataTableHeader>
              <DataTableHead>Channel</DataTableHead>
              <DataTableHead>Where it stands</DataTableHead>
              <DataTableHead>What they were shown</DataTableHead>
              <DataTableHead>Date</DataTableHead>
            </DataTableHeader>
            <tbody>
              <ConsentRow label="Email" row={latestEmailConsent} />
              <ConsentRow label="Text message" row={latestSmsConsent} />
            </tbody>
          </DataTable>
        </DataTableCard>

        <div className="mt-3 rounded-xl border border-border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground">Do-not-contact list</h3>
          {suppressions.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Neither their email address nor their phone number is on the do-not-contact list right now. Coming off
              that list removes the record of it, so this does not prove they were never on it.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {suppressions.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <DataTableBadge tone="danger">Do not contact</DataTableBadge>
                  <span className="font-medium text-foreground">{row.identifier}</span>
                  <span className="text-muted-foreground">
                    — {row.reason} · added {formatDay(row.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Sequences */}
      <section className="mb-6">
        <SectionHeading
          icon={<Workflow className="size-5 text-primary" aria-hidden />}
          title="Sequences they are in"
          hint="A sequence is a state, not an event — it is kept out of the history below on purpose."
        />
        <DataTableCard>
          <DataTable>
            <DataTableHeader>
              <DataTableHead>Sequence</DataTableHead>
              <DataTableHead>Where it is up to</DataTableHead>
              <DataTableHead>Step</DataTableHead>
              <DataTableHead>Added</DataTableHead>
            </DataTableHeader>
            <tbody>
              {runs.length === 0 ? (
                // DataTableEmpty renders its OWN <tr>. Wrapping it in a
                // DataTableRow nests <tr> inside <tr>, which the parser hoists
                // out — and the colSpan then spans nothing, squeezing the
                // message into the first column.
                <DataTableEmpty colSpan={4}>This person is not in any sequence.</DataTableEmpty>
              ) : (
                runs.map((run) => (
                  <DataTableRow key={run.id}>
                    <DataTableCell className="font-medium text-foreground">{run.sequence_name}</DataTableCell>
                    <DataTableCell>
                      <DataTableBadge tone={runTone(run.status)}>{run.status}</DataTableBadge>
                      {run.exit_reason ? (
                        <span className="ml-2 text-xs text-muted-foreground">{run.exit_reason}</span>
                      ) : null}
                      {run.last_error ? <span className="ml-2 text-xs text-destructive">{run.last_error}</span> : null}
                    </DataTableCell>
                    <DataTableCell muted>{run.current_position}</DataTableCell>
                    <DataTableCell muted>
                      <time dateTime={run.enrolled_at}>{formatDay(run.enrolled_at)}</time>
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </tbody>
          </DataTable>
        </DataTableCard>
      </section>

      {/* History */}
      <section>
        <SectionHeading
          icon={<History className="size-5 text-primary" aria-hidden />}
          title="History"
          hint="Everything they did, what they paid, and the calls they booked — newest first."
        />
        {/* The numbers come from the constants the QUERIES use, never retyped:
            a hardcoded 1000 would keep saying 1000 long after someone changed
            the limit, and this note exists precisely to be trusted about what
            was left out. */}
        {data.bookingsWindowFull ? (
          <p className="mb-2 text-xs text-muted-foreground">
            Note: only the {BOOKINGS_WINDOW} most recent bookings across the whole business were checked for a match, so
            a very old booked call may not appear here.
          </p>
        ) : null}
        {data.timelineWindowFull ? (
          <p className="mb-2 text-xs text-muted-foreground">
            Note: this person has more than {TIMELINE_WINDOW} entries. The {TIMELINE_WINDOW} most recent are shown, so
            what you see below is not the whole history and does not start where they did.
          </p>
        ) : null}
        <DataTableCard>
          <DataTable>
            <DataTableHeader>
              <DataTableHead className="w-32">Date</DataTableHead>
              <DataTableHead className="w-28">Type</DataTableHead>
              <DataTableHead>What happened</DataTableHead>
            </DataTableHeader>
            <tbody>
              {timeline.length === 0 ? (
                <DataTableEmpty colSpan={3}>Nothing has been recorded for this person yet.</DataTableEmpty>
              ) : (
                timeline.map((entry) => (
                  <DataTableRow key={entry.key}>
                    <DataTableCell muted>
                      <time dateTime={entry.occurredAt}>{formatDayTime(entry.occurredAt)}</time>
                    </DataTableCell>
                    <DataTableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        {entry.origin === "payment" ? <CreditCard className="size-3.5" aria-hidden /> : null}
                        {entry.origin === "booking" ? <CalendarCheck className="size-3.5" aria-hidden /> : null}
                        {ORIGIN_LABEL[entry.origin]}
                      </span>
                    </DataTableCell>
                    <DataTableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <DataTableBadge tone={TONE[entry.tone]}>{entry.title}</DataTableBadge>
                      </div>
                      {entry.detail ? (
                        <p
                          className={`mt-1 text-xs ${entry.scrubbed ? "italic text-muted-foreground" : "text-muted-foreground"}`}
                        >
                          {entry.detail}
                        </p>
                      ) : null}
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </tbody>
          </DataTable>
        </DataTableCard>
      </section>
    </div>
  )
}

function runTone(status: string): DataTableBadgeTone {
  switch (status) {
    case "active":
      return "success"
    case "completed":
      return "info"
    case "failed":
      return "danger"
    case "exited":
      return "neutral"
    default:
      return "neutral"
  }
}

/**
 * One channel's consent row.
 *
 * `null` here means NO consent row has ever been written for this channel,
 * which is different from a row saying `granted: false`. The copy distinguishes
 * them: "never asked" versus "said no on this date".
 */
function ConsentRow({ label, row }: { label: string; row: ContactDetailData["consents"][number] | null }) {
  if (row === null) {
    return (
      <DataTableRow>
        <DataTableCell className="font-medium text-foreground">{label}</DataTableCell>
        <DataTableCell>
          <DataTableBadge tone="neutral">Never asked</DataTableBadge>
        </DataTableCell>
        <DataTableCell muted>—</DataTableCell>
        <DataTableCell muted>—</DataTableCell>
      </DataTableRow>
    )
  }

  return (
    <DataTableRow>
      <DataTableCell className="font-medium text-foreground">{label}</DataTableCell>
      <DataTableCell>
        <DataTableBadge tone={row.granted ? "success" : "danger"}>{row.granted ? "Agreed" : "Said no"}</DataTableBadge>
        <span className="ml-2 text-xs text-muted-foreground">via {row.source}</span>
      </DataTableCell>
      {/* The exact words that were on screen at the time. This is the column
          with legal weight — it is why contact_consents stores wording_shown
          rather than just a boolean. */}
      <DataTableCell muted>
        <span className="line-clamp-2 max-w-md">{row.wording_shown}</span>
      </DataTableCell>
      <DataTableCell muted>
        <time dateTime={row.occurred_at}>{formatDay(row.occurred_at)}</time>
      </DataTableCell>
    </DataTableRow>
  )
}
