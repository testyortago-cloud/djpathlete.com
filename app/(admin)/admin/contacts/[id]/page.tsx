// app/(admin)/admin/contacts/[id]/page.tsx — one contact, in full.
//
// The screen `contact_timeline_events` was built for. That table has been
// collecting rows since Stage 1 from eleven capture routes, four SMS keyword
// paths and the chat escalation, and it carries an index on
// `(contact_id, occurred_at DESC)` — an index that exists for exactly one
// query, which until now nothing had ever run.
//
// OPENING THIS PAGE IS AN AUDITED EVENT, and the category is
// `admin_read_sensitive` rather than `admin_read`. The precedent is
// app/(admin)/admin/chat/[id]/page.tsx, and the reasoning transfers directly:
// this is not "looked at a list", it is reading one named person's entire
// history in one place — every form they filled in, the text messages they
// sent, what they paid, and the calls they booked. Who read that is worth
// keeping, in the same way a client's medical note is.
//
// THE AUDIT ROW IS WRITTEN AFTER THE CONTACT IS KNOWN TO EXIST. A 404 is not a
// sensitive read, and auditing one would put rows in `audit_logs` for records
// nobody ever saw. Same rule the chat transcript page states.
//
// THE READS ARE NOT WRAPPED IN try/catch. app/(admin)/admin/contacts/page.tsx
// refuses to wrap its own reads and says why in its header: a failed read must
// not render as an empty history, because "the query broke" and "this person
// has done nothing" look identical once you swallow the error. Letting it
// propagate reaches app/(admin)/admin/error.tsx, which is visibly not a page
// with nothing on it. `null` and `[]` are different answers.
//
// Admin UI is light-only — `.dark` is a class variant these components were
// never built against.

import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/auth-helpers"
import { recordAudit } from "@/lib/audit/record"
import { getContactById, getContactDetail } from "@/lib/db/contact-detail"
import { ContactDetail } from "@/components/admin/contacts/ContactDetail"

export const metadata = { title: "Contact" }
export const dynamic = "force-dynamic"

export default async function AdminContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()

  const { id } = await params

  // `getContactById` returns null ONLY when the row is not there — a failed
  // read throws (lib/db/contact-detail.ts). So this branch really is "no such
  // contact" and nothing else.
  const contact = await getContactById(id)
  if (!contact) notFound()

  const detail = await getContactDetail(contact)

  await recordAudit({
    action: "contact.viewed",
    category: "admin_read_sensitive",
    target: {
      type: "contact",
      id: contact.id,
      // A label that identifies WHICH record was opened without copying the
      // person's email address and phone number into a second, longer-lived
      // table. The audit row is a record of who read what, not a duplicate of
      // the thing they read.
      label: contact.name ?? `Contact added ${contact.created_at}`,
    },
    metadata: {
      timeline_entries: detail.timeline.length,
      payments_shown: detail.timeline.filter((entry) => entry.origin === "payment").length,
      bookings_shown: detail.timeline.filter((entry) => entry.origin === "booking").length,
      consent_rows: detail.consents.length,
      suppressed: detail.suppressions.length > 0,
      sequence_runs: detail.runs.length,
      tag_count: detail.tags.length,
    },
  })

  return <ContactDetail data={detail} />
}
