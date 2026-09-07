// app/(admin)/admin/sequences/page.tsx — what the follow-up sequences are
// actually doing.
//
// `exit_reason` has been recorded faithfully since the engine shipped and read
// in exactly one place: the contact detail page, one person at a time. This is
// the view that answers "is this working" across everybody.
//
// The read is NOT wrapped in try/catch, deliberately, the same way
// app/(admin)/admin/contacts/page.tsx does it. A failed read must reach
// app/(admin)/admin/error.tsx, which is visibly not a table of zeros. On this
// screen those two would otherwise be pixel-identical, and a report that cannot
// be told apart from a broken query is worth nothing.

import { Workflow } from "lucide-react"
import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { sequenceReport } from "@/lib/db/sequence-reporting"
import { SequenceReportTable } from "@/components/admin/sequences/SequenceReportTable"

export const metadata = { title: "Sequences" }
export const dynamic = "force-dynamic"

export default async function SequencesPage() {
  await requirePermission("contacts")
  const { businessId } = await resolveAdminTenant()
  // The tenant-wide figure comes back on its own rather than being summed from
  // the rows: somebody who is in two sequences appears in two rows, and adding
  // those up reported one person as two under a sentence that says "people".
  const { rows, contactsWithoutEmailConsent: withoutConsent } = await sequenceReport(businessId)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-primary">
          <Workflow className="size-6" />
          Sequences
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your automatic follow-up. Each one is a series of emails and texts that goes out on its own after somebody
          fills in a form, finishes the quiz, or signs up. This page shows how many people entered each one and what
          happened to them.
        </p>
      </div>

      <SequenceReportTable rows={rows} />

      {withoutConsent > 0 ? (
        <p className="text-sm text-muted-foreground">
          {withoutConsent === 1
            ? "1 person in these sequences has no recorded permission to email."
            : `${withoutConsent} people in these sequences have no recorded permission to email.`}{" "}
          Emails still go out to them — this is here so you can see the number.
        </p>
      ) : null}
    </div>
  )
}
