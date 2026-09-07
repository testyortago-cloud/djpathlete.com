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

  const pageNumber = Math.max(1, Number.parseInt(page ?? "1", 10) || 1)
  const offset = (pageNumber - 1) * DETAIL_PAGE_SIZE

  const detail = await sequenceDetail(businessId, key, { limit: DETAIL_PAGE_SIZE, offset })
  if (!detail) notFound()

  const totalPages = Math.max(1, Math.ceil(detail.totalRuns / DETAIL_PAGE_SIZE))

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
        <h1 className="mt-2 text-2xl font-semibold text-primary">{detail.name}</h1>
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

      {detail.buckets.other > 0 ? (
        <p className="text-sm text-muted-foreground">
          {detail.buckets.other} left for a reason this page does not have a name for yet. They are listed
          below with the raw reason.
        </p>
      ) : null}

      <SequenceRunsTable runs={detail.runs} />

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
