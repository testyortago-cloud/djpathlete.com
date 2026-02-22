import { NextResponse } from "next/server"
import { z } from "zod"
import { createServiceRoleClient } from "@/lib/supabase"

/**
 * Webhook endpoint for GoHighLevel "Google Review Received" workflow.
 *
 * GHL Setup:
 *   1. Workflows → New Workflow → Trigger: "Google Review Received"
 *   2. Add Action: "Custom Webhook" (POST)
 *   3. URL: https://yourdomain.com/api/webhooks/ghl-review
 *   4. Headers: { "x-webhook-secret": "<your GHL_WEBHOOK_SECRET>" }
 *   5. Body (JSON):
 *      {
 *        "reviewer_name": "{{contact.full_name}}",
 *        "rating": {{trigger.reviewRating}},
 *        "comment": "{{trigger.reviewBody}}",
 *        "review_date": "{{trigger.reviewDate}}"
 *      }
 *
 * If the exact GHL custom value names differ, adjust the body mapping
 * in GHL to match the schema below. The endpoint also tries to
 * auto-detect alternative field names from GHL's standard payload.
 */

const webhookReviewSchema = z.object({
  reviewer_name: z.string().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().nullable().optional(),
  review_date: z.string().optional(),
})

export async function POST(request: Request) {
  try {
    // Verify webhook secret
    const secret = process.env.GHL_WEBHOOK_SECRET
    if (secret) {
      const provided = request.headers.get("x-webhook-secret")
      if (provided !== secret) {
        return NextResponse.json(
          { error: "Invalid webhook secret" },
          { status: 401 }
        )
      }
    }

    const raw = await request.json()

    // Normalize: try mapped fields first, then fall back to common GHL field names
    const normalized = {
      reviewer_name:
        raw.reviewer_name ||
        raw.reviewerName ||
        raw.full_name ||
        raw.fullName ||
        [raw.first_name || raw.firstName, raw.last_name || raw.lastName]
          .filter(Boolean)
          .join(" ") ||
        "Anonymous",
      rating:
        raw.rating ??
        raw.starRating ??
        raw.star_rating ??
        raw.reviewRating ??
        raw.review_rating ??
        5,
      comment:
        raw.comment ??
        raw.reviewBody ??
        raw.review_body ??
        raw.body ??
        raw.text ??
        null,
      review_date:
        raw.review_date ||
        raw.reviewDate ||
        raw.date_created ||
        raw.dateCreated ||
        raw.createTime ||
        new Date().toISOString(),
    }

    const result = webhookReviewSchema.safeParse(normalized)
    if (!result.success) {
      console.error("[ghl-review-webhook] Validation failed:", result.error.flatten())
      return NextResponse.json(
        { error: "Invalid review data", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const supabase = createServiceRoleClient()

    const { error } = await supabase.from("google_reviews").insert({
      reviewer_name: result.data.reviewer_name,
      rating: result.data.rating,
      comment: result.data.comment ?? null,
      review_date: result.data.review_date || new Date().toISOString(),
    })

    if (error) throw error

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    console.error("[ghl-review-webhook] Error:", err)
    return NextResponse.json(
      { error: "Failed to process review webhook" },
      { status: 500 }
    )
  }
}
