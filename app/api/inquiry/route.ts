import { NextResponse } from "next/server"
import { inquiryFormSchema, SERVICE_LABELS } from "@/lib/validators/inquiry"
import { createServiceRoleClient } from "@/lib/supabase"
import { ghlCreateContact, ghlTriggerWorkflow } from "@/lib/ghl"
import { sendInquiryEmail, sendInquiryAutoReply } from "@/lib/email"
import { withAudit } from "@/lib/audit/with-audit"
import { recordAudit } from "@/lib/audit/record"
import { createLeadInquiry, updateLeadInquiryAiFields } from "@/lib/db/lead-inquiries"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { getAttributionBySession, claimAttribution } from "@/lib/db/marketing-attribution"
import { generateLeadAnalysis, type LeadAnalysisResult } from "@/lib/ai/lead-analysis"
import { createGenerationLog, updateGenerationLog } from "@/lib/db/ai-generation-log"
import { MODEL_SONNET } from "@/lib/ai/anthropic"
import { captureLead } from "@/lib/lead-engine/capture"
import { recordConsent } from "@/lib/db/contact-consents"
import { getBusinessSettings } from "@/lib/db/businesses"
import { hasSmsConsentDisplayName, renderSmsConsentWording } from "@/lib/lead-engine/sms-consent-wording"

export const maxDuration = 45

async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

export const POST = withAudit({ action: "contact.submitted", category: "marketing" }, async (request) => {
  try {
    const body = await request.json()
    const result = inquiryFormSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const {
      name,
      email,
      phone,
      service,
      sport,
      experience,
      goals,
      injuries,
      how_heard,
      gclid: submittedGclid,
      sms_consent,
    } = result.data
    const serviceLabel = SERVICE_LABELS[service]

    // Resolve tracking from the djp_attr session rather than trusting the
    // client. `proxy.ts` already recorded every click id server-side, so the
    // browser cookie the form reads is a lossy copy of data we hold: it carries
    // gclid only (never gbraid/wbraid), and goes empty on ITP eviction, a
    // cleared jar, or a cross-browser return visit. The submitted value stays
    // as a fallback for the case the cookie outlived the attribution row.
    const attrSessionId = parseAttrCookie(request.headers.get("cookie"))
    const attribution = attrSessionId
      ? await getAttributionBySession(attrSessionId).catch((err) => {
          console.error("Failed to read attribution for inquiry:", err)
          return null
        })
      : null

    const gclid = attribution?.gclid ?? submittedGclid
    const gbraid = attribution?.gbraid ?? null
    const wbraid = attribution?.wbraid ?? null
    const fbclid = attribution?.fbclid ?? null

    const supabase = createServiceRoleClient()

    // Auto-create the inquiry submitter as a lead in the Clients list
    // (same pattern as /api/contact). If they already exist, backfill phone if missing.
    const nameParts = name.trim().split(/\s+/)
    const firstName = nameParts[0] || name.trim()
    const lastName = nameParts.slice(1).join(" ")

    let leadUserId: string | null = null
    const { data: existingUser } = await supabase.from("users").select("id, phone").eq("email", email).maybeSingle()

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

    // Link the ad click to the lead we just created. Without this the
    // attribution row keeps user_id NULL forever, which is why 337 Google-Ads
    // sessions had produced 0 attributable signups: only /api/auth/register
    // and the newsletter path ever claimed, and neither is the path an ad
    // landing page's "apply" form takes. Non-fatal — the inquiry matters more.
    if (attribution && leadUserId && !attribution.claimed_at) {
      await claimAttribution(attribution.id, leadUserId).catch((err) =>
        console.error("Failed to claim attribution for inquiry:", err),
      )
    }

    // Join the contact spine (Lead Engine Stage 4). captureLead never throws
    // (lib/lead-engine/capture.ts swallows its own errors), so a contact-write
    // failure here can never change this route's response or the writes/emails
    // below. Attribution is passed through exactly as already resolved above
    // — gclid/gbraid/wbraid/fbclid, all four this route computes today — never
    // re-derived here.
    const contactId = await captureLead({
      source: "inquiry",
      email,
      phone,
      name,
      attribution: { gclid, gbraid, wbraid, fbclid },
    })

    // SMS consent (Lead Engine Stage 4). FIRE AND FORGET, same reasoning as
    // recordFunnelSmsConsent (app/api/funnels/submit/route.ts): the lead is
    // already captured, and a consent-row failure must never turn "we
    // received your application" into an error for someone who already
    // handed over their phone number. Only fires when there is a contact to
    // attach the row to, a phone that was actually submitted, and the box
    // was actually ticked — an unchecked or absent box writes no row at all.
    if (contactId && phone && sms_consent === true) {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
      const userAgent = request.headers.get("user-agent")
      void recordInquirySmsConsent({ contactId, ip, userAgent }).catch((err) => {
        console.error("Inquiry sms consent write failed (the lead was saved):", err)
      })
    }

    // Notify all admins
    const { data: admins } = await supabase.from("users").select("id").eq("role", "admin")

    // Persist the raw submission — previously these fields only ever existed
    // transiently in the notification email body.
    let leadInquiryId: string | null = null
    try {
      const inquiryRow = await createLeadInquiry({
        lead_user_id: leadUserId,
        name,
        email,
        phone,
        service,
        sport,
        experience,
        goals,
        injuries,
        how_heard,
        gclid,
        gbraid,
        wbraid,
        fbclid,
      })
      leadInquiryId = inquiryRow.id
    } catch (err) {
      console.error("Failed to persist lead inquiry:", err)
    }

    // Generate AI priority/summary/draft-reply (non-blocking — falls back to
    // the plain notification below if this fails, same pattern as the email
    // sends further down).
    let aiAnalysis: LeadAnalysisResult | null = null
    const firstAdminId = admins?.[0]?.id ?? null
    if (leadInquiryId && firstAdminId) {
      const startTime = Date.now()
      let logId: string | null = null
      try {
        const log = await createGenerationLog({
          program_id: null,
          client_id: leadUserId,
          requested_by: firstAdminId,
          status: "pending",
          input_params: {
            feature: "lead_inquiry_analysis",
            name,
            service,
            sport,
            experience,
            goals,
            injuries,
            how_heard,
          },
          output_summary: null,
          error_message: null,
          model_used: MODEL_SONNET,
          tokens_used: null,
          cache_creation_tokens: null,
          cache_read_tokens: null,
          duration_ms: null,
          completed_at: null,
          current_step: 0,
          total_steps: 1,
          generation_trigger: "lead_inquiry",
        })
        logId = log.id

        const { content, tokens_used, cache_creation_tokens, cache_read_tokens } = await withTimeout(
          generateLeadAnalysis({
            name,
            serviceLabel,
            sport,
            experience,
            goals,
            injuries,
            howHeard: how_heard,
          }),
          20_000,
          "Lead analysis generation timed out",
        )
        aiAnalysis = content

        await updateGenerationLog(logId, {
          status: "completed",
          output_summary: { priority: content.priority, summary: content.summary },
          tokens_used,
          cache_creation_tokens: cache_creation_tokens ?? null,
          cache_read_tokens: cache_read_tokens ?? null,
          duration_ms: Date.now() - startTime,
          completed_at: new Date().toISOString(),
        })

        await updateLeadInquiryAiFields(leadInquiryId, {
          ai_priority: content.priority,
          ai_priority_reason: content.priority_reason,
          ai_summary: content.summary,
          ai_draft_reply: content.draft_reply,
          ai_generation_log_id: logId,
          ai_generated_at: new Date().toISOString(),
        })

        await recordAudit({
          action: "lead.ai_analysis_generated",
          category: "automation",
          actor: { id: firstAdminId, role: "system" },
          target: { type: "lead_inquiry", id: leadInquiryId, label: name },
          metadata: { priority: content.priority },
        })
      } catch (err) {
        console.error("Failed to generate lead AI analysis — continuing without it:", err)
        if (logId) {
          await updateGenerationLog(logId, {
            status: "failed",
            error_message: err instanceof Error ? err.message : "Unknown error",
            duration_ms: Date.now() - startTime,
            completed_at: new Date().toISOString(),
          }).catch(() => {})
        }
        await recordAudit({
          action: "lead.ai_analysis_generated",
          category: "automation",
          outcome: "failure",
          actor: { id: firstAdminId, role: "system" },
          target: { type: "lead_inquiry", id: leadInquiryId, label: name },
          error: { message: err instanceof Error ? err.message : "Unknown error" },
        }).catch(() => {})
      }
    }

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
        gclid ? `Google Ads click id: ${gclid}` : null,
        // gbraid/wbraid arrive instead of gclid on iOS/privacy traffic, so a
        // gclid-only line would report those leads as non-ad.
        gbraid ? `Google Ads click id (gbraid): ${gbraid}` : null,
        wbraid ? `Google Ads click id (wbraid): ${wbraid}` : null,
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
        aiAnalysis,
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
        tags: [
          "inquiry",
          `service-${service}`,
          sport ? `sport-${sport.toLowerCase()}` : "",
          // Stored as a tag so the GHL export can join lead → Google Ads click id
          // for the qualified-conversion upload back to Google Ads.
          gclid ? `gclid:${gclid}` : "",
          gbraid ? `gbraid:${gbraid}` : "",
          wbraid ? `wbraid:${wbraid}` : "",
        ].filter(Boolean),
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
})

/**
 * Writes the SMS consent row for an inquiry submission whose visitor ticked
 * the opt-in box next to the phone field.
 *
 * The wording is re-rendered HERE, from `business_settings.display_name`
 * through the exact same `renderSmsConsentWording` the form used to show it
 * — never passed through from the client, which cannot be trusted to relay
 * what it actually rendered, and never a second copy of the sentence, which
 * could drift from the first. Evidence of consent is what was shown;
 * re-deriving it from the same inputs is how both sides of that claim stay
 * provably identical.
 *
 * MIRRORS THE FORM'S OWN GATE (`hasSmsConsentDisplayName`, checked before
 * the checkbox is even shown): if `display_name` reads back blank here, no
 * row is filed, even though `sms_consent` came in `true`. Without this check
 * the two reads could disagree — the page rendered when a name was
 * configured, business_settings went blank before this request landed (or
 * vice versa) — and the row filed would misrepresent what the checkbox next
 * to it actually said. Skipping is logged, never thrown: the lead was
 * already captured by the caller before this ever runs, and a missing
 * business name is not a reason to lose it.
 *
 * Mirrors app/api/funnels/submit/route.ts's recordFunnelSmsConsent exactly.
 */
async function recordInquirySmsConsent(input: {
  contactId: string
  ip: string | null
  userAgent: string | null
}): Promise<void> {
  const settings = await getBusinessSettings()
  if (!hasSmsConsentDisplayName(settings.display_name)) {
    console.warn("[inquiry] sms consent skipped: business_settings.display_name is blank")
    return
  }
  await recordConsent({
    contactId: input.contactId,
    channel: "sms",
    granted: true,
    source: "inquiry",
    wordingShown: renderSmsConsentWording(settings.display_name),
    ip: input.ip,
    userAgent: input.userAgent,
  })
}
