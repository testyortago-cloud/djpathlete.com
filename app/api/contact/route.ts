import { NextResponse } from "next/server"
import { contactFormSchema } from "@/lib/validators/contact"
import { createServiceRoleClient } from "@/lib/supabase"
import { ghlCreateContact, ghlTriggerWorkflow } from "@/lib/ghl"
import { sendContactFormEmail, sendContactAutoReply } from "@/lib/email"
import { withAudit } from "@/lib/audit/with-audit"
import { captureLead } from "@/lib/lead-engine/capture"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { resolvePublicTenant } from "@/lib/tenancy/public"
import { LEAD_ALERT_ROLES, listBusinessMemberUserIds } from "@/lib/db/business-members"

export const POST = withAudit({ action: "contact.submitted", category: "marketing" }, async (request) => {
  try {
    const body = await request.json()
    const result = contactFormSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { name, email, subject, message } = result.data

    // PUBLIC ROUTE, NO SESSION. The tenant is resolved from the request's Host
    // by lib/tenancy/public.ts (business_domains), and is the platform's own
    // only when no domain row claims the host. Resolved once here and
    // threaded; the DAL does not default it.
    const businessId = await resolvePublicTenant()

    const supabase = createServiceRoleClient()

    // Auto-create the submitter as a lead in the Clients list (if they don't already exist).
    // password_hash is null until they actually register; status='lead' distinguishes them
    // from real clients in the admin UI.
    const nameParts = name.trim().split(/\s+/)
    const firstName = nameParts[0] || name.trim()
    const lastName = nameParts.slice(1).join(" ")

    let leadUserId: string | null = null
    const { data: existingUser } = await supabase.from("users").select("id").eq("email", email).maybeSingle()

    if (existingUser) {
      leadUserId = existingUser.id
    } else {
      const { data: newLead, error: leadError } = await supabase
        .from("users")
        .insert({
          email,
          first_name: firstName,
          last_name: lastName,
          role: "client",
          status: "lead",
          email_verified: false,
        })
        .select("id")
        .single()

      if (leadError) {
        console.error("Failed to create lead user from contact form:", leadError)
      } else {
        leadUserId = newLead?.id ?? null
      }
    }

    // Join the contact spine. captureLead never throws (lib/lead-engine/capture.ts
    // swallows its own errors), so a contact-write failure here can never
    // change this route's response or the writes/emails below.
    // `attributionSessionId` is the visitor's djp_attr cookie (audit §3.5):
    // proxy.ts stamps it on every tagged landing and every /go funnel landing,
    // and passing it here is what lets the contact row carry a
    // first_touch_session_id, so the campaign behind this lead stays knowable.
    await captureLead({
      source: "contact_form",
      email,
      name,
      businessId,
      attributionSessionId: parseAttrCookie(request.headers.get("cookie")),
      timezone: result.data.timezone ?? null, // G06
    })

    // WHO GETS THE BELL: this business's owners and coaches (LEAD_ALERT_ROLES,
    // the owner's ruling in G35), not `users where role = 'admin'`. That read
    // belled every platform operator about every business's contact form — a
    // cross-tenant broadcast the moment a second business's site takes a
    // message. `businessId` is the Host tenant resolved above.
    //
    // A FAILED READ IS LOGGED AND THE ROUTE CARRIES ON. It used to `return`
    // here, so a failed recipients read also skipped the email below, the
    // visitor's auto-reply and the CRM sync — none of which depends on who
    // gets a bell. The DAL throws rather than answering [] precisely so that
    // this line exists: an empty list would read as "this business has nobody
    // to tell" and leave no trace of the lost alert.
    let alertRecipients: string[] = []
    try {
      alertRecipients = await listBusinessMemberUserIds(businessId, LEAD_ALERT_ROLES)
    } catch (err) {
      console.error("[contact] could not read this business's owners and coaches; no bell alert was filed:", err)
    }

    if (alertRecipients.length > 0) {
      const notifications = alertRecipients.map((userId) => ({
        user_id: userId,
        type: "info" as const,
        title: "New Contact Form Submission",
        message: `From: ${name} (${email})\nSubject: ${subject}\n\n${message}`,
        is_read: false,
        link: leadUserId ? `/admin/clients/${leadUserId}` : null,
      }))

      const { error: insertError } = await supabase.from("notifications").insert(notifications)

      if (insertError) {
        console.error("Failed to create contact notifications:", insertError)
      }
    }

    // Send email notification to admin (non-blocking)
    try {
      await sendContactFormEmail({ name, email, subject, message })
    } catch {
      console.error("Failed to send contact form email — continuing")
    }

    // Auto-reply to the person with booking link (non-blocking)
    try {
      await sendContactAutoReply({ to: email, firstName: name.split(" ")[0] })
    } catch {
      console.error("Failed to send contact auto-reply — continuing")
    }

    // Sync to GoHighLevel (non-blocking)
    try {
      const contact = await ghlCreateContact({
        email,
        firstName: name.split(" ")[0],
        lastName: name.split(" ").slice(1).join(" ") || undefined,
        tags: ["contact-form", "inquiry"],
        source: "website-contact-form",
      })
      if (contact?.id && process.env.GHL_WORKFLOW_NEW_INQUIRY) {
        await ghlTriggerWorkflow(contact.id, process.env.GHL_WORKFLOW_NEW_INQUIRY)
      }
    } catch {
      // GHL sync failure should not affect contact form submission
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 })
  }
})
