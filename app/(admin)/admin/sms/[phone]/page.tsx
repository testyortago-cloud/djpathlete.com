// app/(admin)/admin/sms/[phone]/page.tsx — one text conversation.
//
// THE PHONE IS IN THE URL, AND `+` MUST BE `%2B`. A bare `+` in a path
// segment decodes to a SPACE, so `/admin/sms/+12025550123` and
// `/admin/sms/%2B12025550123` are not the same request — the first arrives as
// " 12025550123" and matches no thread. This page decodes and then re-
// normalises through `normalisePhone`, the SAME function every writer uses
// (the inbound webhook, `sendManualSms`, and `lib/db/contacts.ts`), so a
// hand-typed variant and a linked one land on the same conversation instead
// of silently splitting it in two.
//
// An unparseable number is a 404, not an empty thread: `/admin/sms/banana` is
// a wrong URL, and rendering it as "no texts yet" invites someone to type a
// message into a box that will be refused at the route.
//
// GATED ON `contacts`, NOT `messages`. `/admin/messages` is the coach-to-
// client in-app chat and owns the `messages` key; this is texts, and it is
// owned by the same grant as the people the texts are with.
//
// The reads are NOT wrapped in try/catch, for the reason
// app/(admin)/admin/contacts/page.tsx states in its own header: a failed read
// must not render as "this person has nothing". Letting it propagate reaches
// app/(admin)/admin/error.tsx, which is visibly not an empty conversation.
//
// Admin UI is light-only.

import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { getSmsThread } from "@/lib/db/sms-messages"
import { getBusinessSettings } from "@/lib/db/businesses"
import { getContactById } from "@/lib/db/contact-detail"
import { isSuppressed } from "@/lib/db/contact-consents"
import { normalisePhone } from "@/lib/lead-engine/identity"
import { resolveTimezone } from "@/lib/lead-engine/guardrails"
import { SmsThread } from "@/components/admin/sms/SmsThread"
import { SmsComposer } from "@/components/admin/sms/SmsComposer"

export const metadata = { title: "Text conversation" }
export const dynamic = "force-dynamic"

/** The wall-clock hour (0-23) right now in `timezone`. */
function hourIn(timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    hour: "2-digit",
  }).formatToParts(new Date())
  const hour = parts.find((part) => part.type === "hour")?.value
  return hour ? Number(hour) : 12
}

export default async function AdminSmsThreadPage({ params }: { params: Promise<{ phone: string }> }) {
  await requirePermission("contacts")
  const { businessId } = await resolveAdminTenant()

  const { phone: rawPhone } = await params
  const phone = normalisePhone(decodeURIComponent(rawPhone))
  if (!phone) notFound()

  const [messages, settings, suppressed] = await Promise.all([
    getSmsThread(phone, businessId),
    getBusinessSettings(businessId),
    isSuppressed(phone, businessId),
  ])

  // The contact link comes off the messages rather than off a lookup by
  // phone: `sms_messages.contact_id` is what the writers already resolved,
  // and the thread exists whether or not anybody is on file. The newest row
  // carrying a link wins — an older row may pre-date the contact's creation.
  const contactId = [...messages].reverse().find((row) => row.contact_id)?.contact_id ?? null
  const contact = contactId ? await getContactById(contactId, businessId) : null

  // The same precedence the sequence engine uses: the contact's own zone if
  // they have one, else the business's.
  const contactTimezone = resolveTimezone(contact?.timezone, settings.timezone)

  // Either column is enough to send with, which is what `assertSmsSendable`
  // checks. Saying so up front beats a 503 after the admin has typed.
  const notConfigured = !settings.sms_messaging_service_sid && !settings.sms_sender_phone

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/admin/sms"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft aria-hidden className="size-4" />
          All texts
        </Link>
        <h1 className="font-heading mt-2 text-2xl font-semibold">{contact?.name ?? phone}</h1>
        <p className="text-sm text-muted-foreground">
          {contact?.name ? `${phone} · ` : ""}
          {messages.length} {messages.length === 1 ? "text" : "texts"} · times shown in {settings.timezone}
        </p>
      </div>

      <SmsThread messages={messages} timezone={settings.timezone} />

      <SmsComposer
        phone={phone}
        contactId={contactId}
        contactName={contact?.name ?? null}
        suppressed={suppressed}
        notConfigured={notConfigured}
        contactLocalHour={hourIn(contactTimezone)}
        contactTimezone={contactTimezone}
        quietHoursStart={settings.quiet_hours_start}
        quietHoursEnd={settings.quiet_hours_end}
      />
    </div>
  )
}
