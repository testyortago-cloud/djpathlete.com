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
import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { recordAudit } from "@/lib/audit/record"
import { getContactById, getContactDetail } from "@/lib/db/contact-detail"
import { listSequences } from "@/lib/db/sequences"
import { ContactDetail } from "@/components/admin/contacts/ContactDetail"

export const metadata = { title: "Contact" }
export const dynamic = "force-dynamic"

export default async function AdminContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("contacts")
  // Task 13: `getContactById` used to be called with no businessId, so it
  // defaulted to SINGLETON_BUSINESS_ID regardless of which business the
  // signed-in admin/staff member actually has selected — the same class of
  // bug __tests__/lib/db/contacts-list.test.ts's own header warns about.
  // Every other admin screen resolves its tenant through resolveAdminTenant
  // (see app/(admin)/admin/contacts/page.tsx); this page had simply never
  // been converted.
  const { businessId } = await resolveAdminTenant()

  const { id } = await params

  // `getContactById` returns null ONLY when the row is not there — a failed
  // read throws (lib/db/contact-detail.ts). So this branch really is "no such
  // contact" and nothing else. It ALSO means "this contact belongs to a
  // different business", since the read is scoped to businessId — a 404 is
  // the right answer for both, and the right one to fail closed to.
  const contact = await getContactById(id, businessId)
  if (!contact) notFound()

  // The sequence list powers the header's "Add to a sequence" action. Read here
  // rather than inside the island so the picker is populated on first paint and
  // the browser makes no extra round trip for it.
  //
  // SCOPED BY THE SAME businessId AS getContactById JUST ABOVE. Task 13's
  // sweep caught this call defaulting to SINGLETON_BUSINESS_ID right next to
  // a now-tenant-scoped read on the same page — a coach on another business
  // would have seen (and could have enrolled this contact into) the
  // platform's own sequences instead of their own.
  const [detail, sequences] = await Promise.all([getContactDetail(contact), listSequences(businessId)])

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

  return <ContactDetail data={detail} sequences={sequences} />
}
