import { NextResponse } from "next/server"
import { inquiryFormSchema, SERVICE_LABELS } from "@/lib/validators/inquiry"
import { createServiceRoleClient } from "@/lib/supabase"
import { ghlCreateContact, ghlTriggerWorkflow } from "@/lib/ghl"
import { sendInquiryEmail, sendInquiryAutoReply } from "@/lib/email"
import { withAudit } from "@/lib/audit/with-audit"
import { recordAudit } from "@/lib/audit/record"
import { createLeadInquiry, updateLeadInquiryAiFields } from "@/lib/db/lead-inquiries"
import { generateLeadAnalysis, type LeadAnalysisResult } from "@/lib/ai/lead-analysis"
import { createGenerationLog, updateGenerationLog } from "@/lib/db/ai-generation-log"
import { MODEL_SONNET } from "@/lib/ai/anthropic"

export const POST = withAudit(
  { action: "contact.submitted", category: "marketing" },
  async (request) => {
  try {
    const body = await request.json()
    const result = inquiryFormSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { name, email, phone, service, sport, experience, goals, injuries, how_heard, gclid } = result.data
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
          input_params: { feature: "lead_inquiry_analysis", name, service, sport, experience, goals, injuries, how_heard },
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

        const { content, tokens_used, cache_creation_tokens, cache_read_tokens } = await generateLeadAnalysis({
          name,
          serviceLabel,
          sport,
          experience,
          goals,
          injuries,
          howHeard: how_heard,
        })
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
  },
)
