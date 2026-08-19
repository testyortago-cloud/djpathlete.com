import { NextResponse } from "next/server"
import { z } from "zod"
import { createServiceRoleClient } from "@/lib/supabase"
import { findAttributionByEmail } from "@/lib/db/marketing-attribution"
import { enqueueBookingConversion } from "@/lib/ads/conversions"
import { recordAudit } from "@/lib/audit/record"
import { findContactByIdentifiers } from "@/lib/db/contacts"
import { exitRunsForContact } from "@/lib/db/sequences"
import { applyPipelineEvent } from "@/lib/db/pipeline"

/**
 * Webhook endpoint for GoHighLevel appointment bookings.
 *
 * GHL Setup:
 *   1. Workflows → New Workflow → Trigger: "Appointment Status"
 *   2. Add Action: "Custom Webhook" (POST)
 *   3. URL: https://yourdomain.com/api/webhooks/ghl-booking
 *   4. Headers: { "x-webhook-secret": "<your GHL_WEBHOOK_SECRET>" }
 *   5. Body (JSON):
 *      {
 *        "contact_name": "{{contact.full_name}}",
 *        "contact_email": "{{contact.email}}",
 *        "contact_phone": "{{contact.phone}}",
 *        "booking_date": "{{appointment.start_time}}",
 *        "duration_minutes": {{appointment.appointment_duration}},
 *        "status": "{{appointment.status}}",
 *        "ghl_contact_id": "{{contact.id}}",
 *        "ghl_appointment_id": "{{appointment.id}}",
 *        "notes": "{{appointment.notes}}"
 *      }
 */

const bookingSchema = z.object({
  contact_name: z.string().min(1),
  contact_email: z.string().email(),
  contact_phone: z.string().nullable().optional(),
  booking_date: z.string().min(1),
  duration_minutes: z.coerce.number().int().positive().optional().default(30),
  status: z.enum(["scheduled", "completed", "cancelled", "no_show"]).optional().default("scheduled"),
  ghl_contact_id: z.string().nullable().optional(),
  ghl_appointment_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  gclid: z.string().max(200).nullable().optional(),
  gbraid: z.string().max(200).nullable().optional(),
  wbraid: z.string().max(200).nullable().optional(),
  fbclid: z.string().max(200).nullable().optional(),
})

export async function POST(request: Request) {
  try {
    // Verify webhook secret
    const secret = process.env.GHL_WEBHOOK_SECRET
    if (secret) {
      const provided = request.headers.get("x-webhook-secret")
      if (provided !== secret) {
        return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 })
      }
    }

    const raw = await request.json()

    // Normalize: try mapped fields first, then fall back to common GHL field names
    const normalized = {
      contact_name:
        raw.contact_name ||
        raw.contactName ||
        raw.full_name ||
        raw.fullName ||
        [raw.first_name || raw.firstName, raw.last_name || raw.lastName].filter(Boolean).join(" ") ||
        "Unknown",
      contact_email: raw.contact_email || raw.contactEmail || raw.email || "",
      contact_phone: raw.contact_phone ?? raw.contactPhone ?? raw.phone ?? null,
      booking_date:
        raw.booking_date ||
        raw.bookingDate ||
        raw.start_time ||
        raw.startTime ||
        raw.selectedTimezone ||
        raw.appoinmentStartTime ||
        raw.appointmentStartTime ||
        new Date().toISOString(),
      duration_minutes:
        raw.duration_minutes ?? raw.durationMinutes ?? raw.appointment_duration ?? raw.appointmentDuration ?? 30,
      status: raw.status || raw.appointmentStatus || raw.appointment_status || "scheduled",
      ghl_contact_id: raw.ghl_contact_id ?? raw.ghlContactId ?? raw.contactId ?? raw.contact_id ?? null,
      ghl_appointment_id:
        raw.ghl_appointment_id ?? raw.ghlAppointmentId ?? raw.appointmentId ?? raw.appointment_id ?? raw.id ?? null,
      notes: raw.notes ?? raw.appointmentNotes ?? raw.appointment_notes ?? null,
      gclid:  raw.gclid  ?? raw.gcl_id ?? null,
      gbraid: raw.gbraid ?? null,
      wbraid: raw.wbraid ?? null,
      fbclid: raw.fbclid ?? null,
    }

    // Map GHL statuses to our schema
    const statusMap: Record<string, string> = {
      confirmed: "scheduled",
      booked: "scheduled",
      new: "scheduled",
      showed: "completed",
      completed: "completed",
      cancelled: "cancelled",
      canceled: "cancelled",
      no_show: "no_show",
      noshow: "no_show",
    }
    const mappedStatus = statusMap[normalized.status.toLowerCase()] ?? normalized.status
    normalized.status = mappedStatus

    const result = bookingSchema.safeParse(normalized)
    if (!result.success) {
      console.error("[ghl-booking-webhook] Validation failed:", result.error.flatten())
      return NextResponse.json(
        { error: "Invalid booking data", details: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const supabase = createServiceRoleClient()
    const data = result.data

    // Lead Engine: neither the sequence exit nor the pipeline card move may
    // ever fail a booking webhook — catch, log, keep going to the normal
    // response. One contact resolution, two consumers, same catch.
    //
    // exitRunsForContact stays gated to scheduled/completed only: a
    // cancelled or no-show booking means the lead did NOT convert, and this
    // branch has no re-enrolment path anywhere (enrollIfTriggered only fires
    // from ContactEventSource values, none of which is "booking cancelled")
    // — so exiting on a bad-outcome status would silently end the
    // conversation forever, with nothing left to ever restart it.
    //
    // applyPipelineEvent, by contrast, cares about all four statuses:
    // cancelled and no_show close a card as lost (decideMove in
    // lib/lead-engine/pipeline-move.ts). Do not "simplify" these into one
    // shared condition — the two consumers legitimately fire on different
    // status sets from the same resolved contact.
    try {
      const contactId = await findContactByIdentifiers({
        email: data.contact_email,
        phone: data.contact_phone,
      })
      if (contactId) {
        if (data.status === "scheduled" || data.status === "completed") {
          await exitRunsForContact(contactId, "booking")
        }
        await applyPipelineEvent({
          contactId,
          event: { kind: "booking", status: data.status, occurredAt: new Date() },
        })
      }
    } catch (err) {
      console.error("[ghl-booking-webhook] sequence/pipeline hook failed", (err as Error).message)
    }

    let gclid = data.gclid ?? null
    let gbraid = data.gbraid ?? null
    let wbraid = data.wbraid ?? null
    let fbclid = data.fbclid ?? null

    // Email-match fallback if no gclid in payload
    if (!gclid) {
      const attr = await findAttributionByEmail(data.contact_email).catch(() => null)
      if (attr) {
        gclid = attr.gclid
        gbraid ||= attr.gbraid
        wbraid ||= attr.wbraid
        fbclid ||= attr.fbclid
      }
    }

    // Upsert by ghl_appointment_id if present (so status updates don't create duplicates)
    if (data.ghl_appointment_id) {
      const { data: existing } = await supabase
        .from("bookings")
        .select("id, status, booking_date")
        .eq("ghl_appointment_id", data.ghl_appointment_id)
        .maybeSingle()

      if (existing) {
        const { error } = await supabase
          .from("bookings")
          .update({
            status: data.status,
            booking_date: data.booking_date,
            notes: data.notes,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)

        if (error) throw error

        // Dispatch audit slug on transition (reschedule or status change).
        const prevStatus = (existing as { status?: string | null }).status ?? null
        const prevDate = (existing as { booking_date?: string | null }).booking_date ?? null

        let slug: string | null = null
        if (prevStatus !== data.status) {
          if (data.status === "completed") slug = "booking.completed"
          else if (data.status === "cancelled") slug = "booking.cancelled"
          else if (data.status === "no_show") slug = "booking.no_show"
        } else if (prevDate && prevDate !== data.booking_date) {
          slug = "booking.rescheduled"
        }

        if (slug) {
          await recordAudit({
            action: slug,
            category: "commerce",
            outcome: "success",
            actor: { id: null, email: "ghl", role: "system" },
            target: { type: "booking", id: existing.id, label: data.booking_date ?? undefined },
            metadata: {
              ghl_appointment_id: data.ghl_appointment_id,
              source: "ghl_webhook",
              from_status: prevStatus,
              to_status: data.status,
              from_booking_date: prevDate,
              to_booking_date: data.booking_date,
            },
            request,
          })
        }

        return NextResponse.json({ success: true, action: "updated" }, { status: 200 })
      }
    }

    // Insert new booking
    const { data: insertedBooking, error } = await supabase
      .from("bookings")
      .insert({
        contact_name: data.contact_name,
        contact_email: data.contact_email,
        contact_phone: data.contact_phone ?? null,
        booking_date: data.booking_date,
        duration_minutes: data.duration_minutes,
        status: data.status,
        source: "ghl",
        notes: data.notes ?? null,
        ghl_contact_id: data.ghl_contact_id ?? null,
        ghl_appointment_id: data.ghl_appointment_id ?? null,
        gclid,
        gbraid,
        wbraid,
        fbclid,
      })
      .select("id")
      .single()

    if (error) throw error

    // Audit booking creation (system actor = GHL webhook).
    if (insertedBooking?.id) {
      await recordAudit({
        action: "booking.created",
        category: "commerce",
        outcome: "success",
        actor: { id: null, email: "ghl", role: "system" },
        target: { type: "booking", id: insertedBooking.id, label: data.booking_date ?? undefined },
        metadata: {
          ghl_appointment_id: data.ghl_appointment_id ?? null,
          ghl_contact_id: data.ghl_contact_id ?? null,
          status: data.status,
          source: "ghl_webhook",
        },
        request,
      })
    }

    // Phase 1.5c — enqueue an offline conversion upload to Google Ads.
    // No-ops silently when there's no gclid/gbraid/wbraid OR no active
    // 'booking_created' conversion action configured. Wrapped in try/catch
    // so a Google Ads enqueue failure can't break the booking webhook.
    if (insertedBooking?.id) {
      try {
        await enqueueBookingConversion({
          booking_id: insertedBooking.id,
          booking_date: data.booking_date,
          gclid,
          gbraid,
          wbraid,
        })
      } catch (enqueueErr) {
        console.error("[ghl-booking-webhook] enqueueBookingConversion failed:", enqueueErr)
      }
    }

    // Notify admins
    const { data: admins } = await supabase.from("users").select("id").eq("role", "admin")

    if (admins && admins.length > 0) {
      const bookingDate = new Date(data.booking_date).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })

      const notifications = admins.map((admin) => ({
        user_id: admin.id,
        type: "success" as const,
        title: "New Call Booked",
        message: `${data.contact_name} (${data.contact_email}) booked a call for ${bookingDate}`,
        is_read: false,
        link: "/admin/bookings",
      }))

      await supabase.from("notifications").insert(notifications)
    }

    return NextResponse.json({ success: true, action: "created" }, { status: 201 })
  } catch (err) {
    console.error("[ghl-booking-webhook] Error:", err)
    return NextResponse.json({ error: "Failed to process booking webhook" }, { status: 500 })
  }
}
