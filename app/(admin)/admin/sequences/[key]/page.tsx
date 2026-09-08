// One sequence: its tally, and every person who entered it.
//
// Keyed by `key` rather than id so the URL reads
// /admin/sequences/new_lead_nurture — the same identifier every script uses.
//
// notFound() rather than an empty report when the key belongs to another
// business: an empty report would tell an operator that a sequence they can
// name has nobody in it, when the truth is that it is not theirs.

import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { DETAIL_PAGE_SIZE, sequenceDetail, type OutcomeBucket } from "@/lib/db/sequence-reporting"
import { SequenceRunsTable } from "@/components/admin/sequences/SequenceRunsTable"
import { SequenceSwitch } from "@/components/admin/sequences/SequenceSwitch"
import { DataTableBadge } from "@/components/ui/data-table"
import { STATUS_LABEL, STATUS_TONE } from "@/components/admin/sequences/SequenceReportTable"

export const metadata = { title: "Sequence" }
export const dynamic = "force-dynamic"

// "Entered" isn't a bucket — it's the total, not one of the outcomes runs land
// in — so it can't share this array's `detail.buckets[item.key]` indexing.
// It gets its own tile below instead of a union key that doesn't typecheck.
const SUMMARY: { key: OutcomeBucket; label: string }[] = [
  { key: "in_progress", label: "Still going" },
  { key: "bought", label: "Bought" },
  { key: "booked", label: "Booked a call" },
  { key: "opted_out", label: "Opted out" },
  { key: "finished", label: "Reached the end" },
  { key: "failed", label: "Something went wrong" },
]

export default async function SequenceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>
  searchParams: Promise<{ page?: string }>
}) {
  await requirePermission("contacts")
  const { businessId } = await resolveAdminTenant()
  const { key } = await params
  const { page } = await searchParams

  const requestedPage = Math.max(1, Number.parseInt(page ?? "1", 10) || 1)

  // The page number cannot be clamped BEFORE the read: the last page number is
  // derived from the total, and only the read knows the total. So it is clamped
  // after, and the read repeated at the clamped position. Without this, typing
  // ?page=9 at a sequence with 73 people rendered "Entered 73" in the tiles
  // directly above a table saying nobody has entered this sequence yet.
  //
  // The repeat only ever happens for a page that does not exist, which no link
  // on this screen produces — the alternative (a cheap count read first, then
  // the paged read) would cost an extra round trip on EVERY view to save one on
  // a hand-typed URL.
  let detail = await sequenceDetail(businessId, key, {
    limit: DETAIL_PAGE_SIZE,
    offset: (requestedPage - 1) * DETAIL_PAGE_SIZE,
  })
  if (!detail) notFound()

  const totalPages = Math.max(1, Math.ceil(detail.totalRuns / DETAIL_PAGE_SIZE))
  const pageNumber = Math.min(requestedPage, totalPages)
  if (pageNumber !== requestedPage) {
    detail =
      (await sequenceDetail(businessId, key, {
        limit: DETAIL_PAGE_SIZE,
        offset: (pageNumber - 1) * DETAIL_PAGE_SIZE,
      })) ?? detail
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/sequences"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-4" />
          All sequences
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-primary">{detail.name}</h1>
          <DataTableBadge tone={STATUS_TONE[detail.status] ?? "neutral"}>
            {STATUS_LABEL[detail.status] ?? detail.status}
          </DataTableBadge>
          <SequenceSwitch sequenceKey={detail.key} sequenceName={detail.name} status={detail.status} />
        </div>
        {/* The `description` column is NOT rendered, deliberately. Every one of the nine
            seeded descriptions is a note written for the next developer — they name
            helper functions, script paths and column semantics ("trigger_source is
            NULL"). Until a coach can write their own, showing this column puts
            engineering prose on a coach's screen. The field stays on SequenceDetail for
            a future editor to use. */}
        <p className="mt-1 text-sm text-muted-foreground">
          {detail.stepCount === 1 ? "1 step" : `${detail.stepCount} steps`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="text-2xl font-semibold text-primary">{detail.entered}</div>
          <div className="mt-1 text-xs text-muted-foreground">Entered</div>
        </div>
        {SUMMARY.map((item) => (
          <div key={item.key} className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="text-2xl font-semibold text-primary">{detail.buckets[item.key]}</div>
            <div className="mt-1 text-xs text-muted-foreground">{item.label}</div>
          </div>
        ))}
      </div>

      {/* "Something else" is not a mystery any more: three of the seven things
          that can happen — somebody's details merged into another person's
          record, somebody already in this sequence under a second record, or
          the sequence being edited while they were partway through it — land
          here on purpose, and the list below names all three in plain words.
          Anything genuinely new still shows up here, as itself. */}
      {detail.buckets.other > 0 ? (
        <p className="text-sm text-muted-foreground">
          {detail.buckets.other === 1
            ? "1 person left this sequence for a reason with no column of its own."
            : `${detail.buckets.other} people left this sequence for a reason with no column of its own.`}{" "}
          Each one is named in the list below.
        </p>
      ) : null}

      <SequenceRunsTable runs={detail.runs} />

      {detail.contactsWithoutEmailConsent > 0 ? (
        <p className="text-sm text-muted-foreground">
          {detail.contactsWithoutEmailConsent === 1
            ? "1 person in this sequence has no recorded permission to email."
            : `${detail.contactsWithoutEmailConsent} people in this sequence have no recorded permission to email.`}{" "}
          Emails still go out to them — this is here so you can see the number.
        </p>
      ) : null}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {pageNumber} of {totalPages}
          </span>
          <div className="flex gap-3">
            {pageNumber > 1 ? (
              <Link href={`/admin/sequences/${key}?page=${pageNumber - 1}`} className="text-primary hover:underline">
                Previous
              </Link>
            ) : null}
            {pageNumber < totalPages ? (
              <Link href={`/admin/sequences/${key}?page=${pageNumber + 1}`} className="text-primary hover:underline">
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
