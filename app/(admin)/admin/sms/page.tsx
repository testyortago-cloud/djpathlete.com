// app/(admin)/admin/sms/page.tsx — every text conversation.
//
// NOT /admin/messages: that is the coach-to-client in-app chat, it is owned
// by the `messages` permission, and notification emails deep-link into it
// with `?conversation=<id>`. Merging the two is the unified inbox, which the
// quotation puts in the NEXT phase. This screen is texts only, and it is
// gated on `contacts` — the same permission as the people the texts are
// with. `/admin/sms` and `/api/admin/sms` are already mapped to that key in
// lib/permissions/registry.ts.
//
// The reads are NOT wrapped in try/catch, and that is deliberate. A failed
// read must not render as "no conversations" — "the query broke" and "nobody
// has texted you" look identical the moment the error is swallowed, and the
// second one is the answer that makes a coach close the tab. Letting it
// propagate reaches app/(admin)/admin/error.tsx, which is visibly not an
// empty table. Same reasoning as app/(admin)/admin/contacts/page.tsx states
// in its own header: null and [] are different answers.
//
// Admin UI is light-only.

import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { listSmsThreads } from "@/lib/db/sms-messages"
import { getBusinessSettings } from "@/lib/db/businesses"
import { SmsThreadList } from "@/components/admin/sms/SmsThreadList"

export const metadata = { title: "Texts" }
export const dynamic = "force-dynamic"

export default async function AdminSmsPage() {
  await requirePermission("contacts")
  const { businessId } = await resolveAdminTenant()

  // Settings comes along only for its timezone: these timestamps are read by
  // a coach deciding whether a reply is still warm, so they have to be in the
  // coach's own clock, not the rendering server's.
  const [threads, settings] = await Promise.all([listSmsThreads(businessId), getBusinessSettings(businessId)])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Texts</h1>
        <p className="text-sm text-muted-foreground">Every text conversation with a lead or client, newest first.</p>
      </div>
      <SmsThreadList threads={threads} timezone={settings.timezone} />
    </div>
  )
}
