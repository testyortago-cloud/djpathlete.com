import { NextResponse } from "next/server"
import { inquiryFormSchema, SERVICE_LABELS } from "@/lib/validators/inquiry"
import { createServiceRoleClient } from "@/lib/supabase"
import { ghlCreateContact, ghlTriggerWorkflow } from "@/lib/ghl"
import { sendInquiryEmail, sendInquiryAutoReply } from "@/lib/email"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = inquiryFormSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { name, email, phone, service, sport, experience, goals, injuries, how_heard } = result.data
    const serviceLabel = SERVICE_LABELS[service]

    const supabase = createServiceRoleClient()

    // Auto-create the inquiry submitter as a lead in the Clients list
    // (same pattern as /api/contact). If they already exist, backfill phone if missing.
    const nameParts = name.trim().split(/\s+/)
    const firstName = nameParts[0] || name.trim()
    const lastName = nameParts.slice(1).join(" ")

    let leadUserId: string | null = null
    const { data: existingUser } = await supabase
      .from("users")
      .select("id, phone")
      .eq("email", email)
      .maybeSingle()

    if (existingUser) {
      leadUserId = existingUser.id
      if (phone && !existingUser.phone) {
        await supabase.from("users").update({ phone }).eq("id", existingUser.id)
      }
    } else {
      const { data: newLead, error: leadError } = await supabase
        .from("users")
        .insert({
          email,
          first_name: firstName,
          last_name: lastName,
          phone,
          role: "client",
          status: "lead",
          email_verified: false,
        })
        .select("id")
        .single()

      if (leadError) {
        console.error("Failed to create lead user from inquiry:", leadError)
      } else {
        leadUserId = newLead?.id ?? null
      }
    }

    // Notify all admins
    const { data: admins } = await supabase.from("users").select("id").eq("role", "admin")

    if (admins && admins.length > 0) {
      const details = [
        `Service: ${serviceLabel}`,
        `From: ${name} (${email})`,
        phone ? `Phone: ${phone}` : null,
        sport ? `Sport: ${sport}` : null,
        experience ? `Experience: ${experience}` : null,
        `\nGoals:\n${goals}`,
        injuries ? `\nInjuries/Limitations:\n${injuries}` : null,
        how_heard ? `How they heard about us: ${how_heard}` : null,
      ]
        .filter(Boolean)
        .join("\n")

      const notifications = admins.map((admin) => ({
        user_id: admin.id,
        type: "info" as const,
        title: `New ${serviceLabel} Application`,
        message: details,
        is_read: false,
        link: leadUserId ? `/admin/clients/${leadUserId}` : null,
      }))

      const { error: insertError } = await supabase.from("notifications").insert(notifications)

      if (insertError) {
        console.error("Failed to create inquiry notifications:", insertError)
      }
    }

    // Send email notification to sales (non-blocking)
    try {
      await sendInquiryEmail({
        name,
        email,
        phone,
        serviceLabel,
        sport,
        experience,
        goals,
        injuries,
        how_heard,
      })
    } catch {
      console.error("Failed to send inquiry email — continuing")
    }

    // Auto-reply to the person with booking link (non-blocking)
    try {
      await sendInquiryAutoReply({ to: email, firstName: name.split(" ")[0], serviceLabel })
    } catch {
      console.error("Failed to send inquiry auto-reply — continuing")
    }

    // Sync to GoHighLevel (non-blocking)
    try {
      const contact = await ghlCreateContact({
        email,
        firstName: name.split(" ")[0],
        lastName: name.split(" ").slice(1).join(" ") || undefined,
        phone: phone ?? undefined,
        tags: ["inquiry", `service-${service}`, sport ? `sport-${sport.toLowerCase()}` : ""].filter(Boolean),
        source: `website-inquiry-${service}`,
      })
      if (contact?.id && process.env.GHL_WORKFLOW_NEW_INQUIRY) {
        await ghlTriggerWorkflow(contact.id, process.env.GHL_WORKFLOW_NEW_INQUIRY)
      }
    } catch {
      // GHL sync failure should not affect form submission
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 })
  }
}
