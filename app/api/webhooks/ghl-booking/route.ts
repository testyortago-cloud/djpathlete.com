import { NextResponse } from "next/server"
import { z } from "zod"
import { ingestBooking } from "@/lib/bookings/ingest"
import { platformBusinessId, platformHostId } from "@/lib/tenancy/platform"

/**
 * Webhook endpoint for GoHighLevel appointment bookings.
 *
 * AN ADAPTER, since Full Engine phase 2. This route owns exactly two things:
 * GHL's shared-secret check and the translation of GHL's payload shapes into
 * `BookingIngestInput`. What a booking MEANS — the row, the sequence exit, the
 * ads conversion, the pipeline card — lives in lib/bookings/ingest.ts and is
 * shared with app/api/webhooks/calendly/route.ts. Do not add a consequence
 * here; add it there, and both sources get it.
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

    const data = result.data

    const outcome = await ingestBooking({
      source: "ghl",
      businessId: platformBusinessId(),
      hostId: await platformHostId(),
      connectionId: null,
      chatConversationId: null,
      inviteeTimezone: null,
      key: data.ghl_appointment_id ? { column: "ghl_appointment_id", value: data.ghl_appointment_id } : null,
      contact: { name: data.contact_name, email: data.contact_email, phone: data.contact_phone ?? null },
      bookingDate: data.booking_date,
      durationMinutes: data.duration_minutes,
      status: data.status,
      notes: data.notes ?? null,
      clickIds: {
        gclid: data.gclid ?? null,
        gbraid: data.gbraid ?? null,
        wbraid: data.wbraid ?? null,
        fbclid: data.fbclid ?? null,
      },
      columns: { ghl_contact_id: data.ghl_contact_id ?? null },
      actor: "ghl",
      auditSource: "ghl_webhook",
      auditMetadata: {
        ghl_appointment_id: data.ghl_appointment_id ?? null,
        ghl_contact_id: data.ghl_contact_id ?? null,
      },
      request,
    })

    return NextResponse.json(
      { success: true, action: outcome.action },
      { status: outcome.action === "created" ? 201 : 200 },
    )
  } catch (err) {
    console.error("[ghl-booking-webhook] Error:", err)
    return NextResponse.json({ error: "Failed to process booking webhook" }, { status: 500 })
  }
}
