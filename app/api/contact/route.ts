import { NextResponse } from "next/server"
import { contactFormSchema } from "@/lib/validators/contact"
import { createServiceRoleClient } from "@/lib/supabase"
import { ghlCreateContact, ghlTriggerWorkflow } from "@/lib/ghl"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = contactFormSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { name, email, subject, message } = result.data

    const supabase = createServiceRoleClient()

    // Find all admin users to notify
    const { data: admins, error: adminsError } = await supabase
      .from("users")
      .select("id")
      .eq("role", "admin")

    if (adminsError) {
      console.error("Failed to fetch admin users:", adminsError)
      // Still return success to the client — we don't want to expose internal errors
      return NextResponse.json({ success: true })
    }

    if (admins && admins.length > 0) {
      const notifications = admins.map((admin) => ({
        user_id: admin.id,
        type: "info" as const,
        title: "New Contact Form Submission",
        message: `From: ${name} (${email})\nSubject: ${subject}\n\n${message}`,
        is_read: false,
        link: null,
      }))

      const { error: insertError } = await supabase
        .from("notifications")
        .insert(notifications)

      if (insertError) {
        console.error("Failed to create contact notifications:", insertError)
      }
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
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}
