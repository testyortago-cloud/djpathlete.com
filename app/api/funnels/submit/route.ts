// Public funnel form submissions.
//
// /api/* is NOT covered by middleware.ts, so this route gates itself.
//
// The browser never gets to say what the form contained: the field list is
// re-read from the PUBLISHED version of the step, and anything not in it is
// discarded. A tampered payload therefore cannot inject extra columns, and a
// form key that was never published cannot submit at all.

import { NextResponse } from "next/server"
import { z } from "zod"
import { createServiceRoleClient } from "@/lib/supabase"
import { createSubmission, getPublishedFormConfig } from "@/lib/db/funnels"
import { funnelFormFieldSchema, type FunnelFormField } from "@/lib/funnels/islands"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { recordAudit } from "@/lib/audit/record"

/** Bots submit instantly; a person cannot read and fill a form this fast. */
const MIN_ELAPSED_MS = 1500

/** Per-IP throttle. In-memory: resets on deploy, which is fine for form spam. */
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 5
const recentByIp = new Map<string, number[]>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (recentByIp.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  hits.push(now)
  recentByIp.set(ip, hits)
  if (recentByIp.size > 5000) recentByIp.clear() // crude bound; prevents unbounded growth
  return hits.length > RATE_LIMIT_MAX
}

const bodySchema = z.object({
  funnelId: z.string().uuid(),
  stepId: z.string().uuid(),
  formKey: z.string().min(1).max(40),
  values: z.record(z.string(), z.string().max(2000)),
  website: z.string().optional(),
  elapsedMs: z.number().optional(),
})

export async function POST(request: Request) {
  let parsedBody: z.infer<typeof bodySchema>
  try {
    const raw = await request.json()
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid submission." }, { status: 400 })
    }
    parsedBody = parsed.data
  } catch {
    return NextResponse.json({ error: "Invalid submission." }, { status: 400 })
  }

  // Honeypot. Answer 200 so the bot has no signal that it was caught.
  if (parsedBody.website && parsedBody.website.length > 0) {
    return NextResponse.json({ ok: true })
  }

  if (typeof parsedBody.elapsedMs === "number" && parsedBody.elapsedMs < MIN_ELAPSED_MS) {
    return NextResponse.json({ ok: true })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many submissions. Please try again shortly." }, { status: 429 })
  }

  // The published config is the authority on which fields exist.
  const config = await getPublishedFormConfig(parsedBody.stepId, parsedBody.formKey)
  if (!config) {
    return NextResponse.json({ error: "This form is no longer available." }, { status: 404 })
  }

  const fieldsResult = z.array(funnelFormFieldSchema).safeParse(config.fields)
  if (!fieldsResult.success) {
    return NextResponse.json({ error: "This form is misconfigured." }, { status: 409 })
  }
  const fields: FunnelFormField[] = fieldsResult.data

  const payload: Record<string, string> = {}
  for (const field of fields) {
    const value = (parsedBody.values[field.name] ?? "").trim()
    if (field.required && value.length === 0) {
      return NextResponse.json({ error: `${field.label} is required.` }, { status: 400 })
    }
    if (field.type === "email" && value.length > 0 && !z.string().email().safeParse(value).success) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 })
    }
    if (value.length > 0) payload[field.name] = value
  }

  const email = findByType(fields, payload, "email")
  const phone = findByType(fields, payload, "tel")
  const name = buildName(payload)

  const sessionId = parseAttrCookie(request.headers.get("cookie")) ?? null

  let leadUserId: string | null = null
  if (email) {
    leadUserId = await upsertLead(email, name)
  }

  try {
    await createSubmission({
      funnel_id: parsedBody.funnelId,
      step_id: parsedBody.stepId,
      form_key: parsedBody.formKey,
      email,
      name,
      phone,
      payload,
      attribution_session_id: sessionId,
      ip_address: ip === "unknown" ? null : ip,
      user_agent: request.headers.get("user-agent"),
      lead_user_id: leadUserId,
    })
  } catch (error) {
    console.error("[funnels/submit] failed to record submission:", error)
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 })
  }

  recordAudit({
    action: "funnel.submission_received",
    category: "marketing",
    actor: { id: null, email: email ?? null, role: "anonymous" },
    metadata: { funnel_id: parsedBody.funnelId, form_key: parsedBody.formKey },
  })

  return NextResponse.json({ ok: true })
}

function findByType(
  fields: FunnelFormField[],
  payload: Record<string, string>,
  type: FunnelFormField["type"],
): string | null {
  const field = fields.find((f) => f.type === type)
  if (!field) return null
  return payload[field.name] ?? null
}

function buildName(payload: Record<string, string>): string | null {
  const first = payload.first_name ?? payload.name ?? ""
  const last = payload.last_name ?? ""
  const full = `${first} ${last}`.trim()
  return full.length > 0 ? full : null
}

/**
 * Mirrors /api/contact: a funnel lead becomes a users row with status='lead' so
 * it shows up in the Clients list alongside every other inbound lead.
 *
 * Deliberately does NOT sync to GoHighLevel — replacing GHL is the point.
 */
async function upsertLead(email: string, name: string | null): Promise<string | null> {
  try {
    const supabase = createServiceRoleClient()
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle()
    if (existing) return (existing as { id: string }).id

    const parts = (name ?? "").trim().split(/\s+/).filter(Boolean)
    const { data: created, error } = await supabase
      .from("users")
      .insert({
        email,
        first_name: parts[0] ?? email.split("@")[0],
        last_name: parts.slice(1).join(" "),
        role: "client",
        status: "lead",
        email_verified: false,
      })
      .select("id")
      .single()
    if (error) {
      console.error("[funnels/submit] lead creation failed:", error)
      return null
    }
    return (created as { id: string }).id
  } catch (error) {
    console.error("[funnels/submit] lead upsert threw:", error)
    return null
  }
}
