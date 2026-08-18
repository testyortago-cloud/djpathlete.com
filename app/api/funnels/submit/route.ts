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
import { createSubmission, getFunnelById, getPublishedFormConfig, getStep, listSteps } from "@/lib/db/funnels"
import { getEventById } from "@/lib/db/events"
import { getSetting } from "@/lib/db/system-settings"
import { getAttributionBySession } from "@/lib/db/marketing-attribution"
import { createEventSignupCheckout } from "@/lib/events/checkout"
import { FUNNEL_CHECKOUT_DEFAULT, FUNNEL_CHECKOUT_FLAG } from "@/lib/funnels/checkout/flag"
import { labelForRole, signupInputFromRoles } from "@/lib/funnels/checkout/roles"
import { createEventSignupSchema } from "@/lib/validators/event-signups"
import { getBaseUrl } from "@/lib/url"
import { sendNewFunnelLeadEmail } from "@/lib/email"
import { funnelFormFieldSchema, type FunnelFormField } from "@/lib/funnels/islands"
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { recordAudit } from "@/lib/audit/record"
import { captureContactFromSubmission } from "@/lib/funnels/capture-contact"

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

  // Feeds the contact spine (lead-engine Stage 1a). Never throws and never
  // blocks the visitor's success on it — see lib/funnels/capture-contact.ts.
  await captureContactFromSubmission({
    name,
    email,
    phone,
    attributionSessionId: sessionId,
    payload,
  })

  recordAudit({
    action: "funnel.submission_received",
    category: "marketing",
    actor: { id: null, email: email ?? null, role: "anonymous" },
    metadata: { funnel_id: parsedBody.funnelId, form_key: parsedBody.formKey },
  })

  // ---------------------------------------------------------------------------
  // Tell the coach. FIRE AND FORGET, AND THAT IS THE WHOLE DESIGN.
  //
  // The submission is already written and the visitor's success does not depend
  // on our mail provider being up. `void` plus a swallowed rejection is what
  // keeps a Resend outage from turning "we have your details" into "something
  // went wrong, please try again" for someone who has already handed over their
  // email — and who, on a second attempt, becomes a duplicate lead.
  //
  // The awaited alternative was considered and rejected: an alert is worth less
  // than the lead it is about.
  // ---------------------------------------------------------------------------
  void notifyCoachOfLead({
    funnelId: parsedBody.funnelId,
    stepId: parsedBody.stepId,
    name,
    email,
    phone,
    answers: payload,
  }).catch((error) => {
    console.error("[funnels/submit] lead alert failed (the lead was saved):", error)
  })

  // Read here, not inside the closure: TypeScript does not carry the `!config`
  // narrowing above into a closure body, and widening it back to
  // `config!.eventId` inside would be an assertion standing in for a check that
  // has already happened right here.
  const configEventId = typeof config.eventId === "string" ? config.eventId : ""

  if (config.successMode === "checkout") return await checkoutAfterSubmission()

  return NextResponse.json({ ok: true })

  // -------------------------------------------------------------------------
  // (c) THE PAYING BRANCH.
  //
  // Declared as a closure and called above so it reads in the order it happens
  // and can see everything already resolved — `fields`, `payload`, `ip`,
  // `sessionId` — without threading eight arguments through a top-level helper.
  //
  // IT RUNS AFTER THE SUBMISSION IS WRITTEN, and that ordering is the whole
  // point: the visitor most worth calling is the one who filled the form and
  // could not pay, so a Stripe outage must cost them their checkout and never
  // their place in the owner's leads.
  // -------------------------------------------------------------------------
  async function checkoutAfterSubmission(): Promise<Response> {
    // MONEY AND MASS EMAIL — the repo's stated bar for a flag. 404 rather than
    // 403 for the same reason /api/funnels/checkout gives: a 403 confirms the
    // endpoint exists and is merely switched off, which is a map of what to come
    // back for.
    if (!(await getSetting<boolean>(FUNNEL_CHECKOUT_FLAG, FUNNEL_CHECKOUT_DEFAULT))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const event = configEventId === "" ? null : await getEventById(configEventId).catch(() => null)
    if (!event || event.status !== "published") {
      // The publish gate refuses this configuration, so reaching it means the
      // camp changed AFTER the page went live. The visitor gets the plain fact.
      return NextResponse.json({ error: "This camp is not open for booking yet." }, { status: 400 })
    }

    // The form's own declaration, mapped and then handed to the REAL validator.
    const parsedSignup = createEventSignupSchema.safeParse(signupInputFromRoles(fields, parsedBody.values))
    if (!parsedSignup.success) {
      // Named with the OWNER'S OWN LABEL. "athlete_age must be less than or
      // equal to 21" describes a field the parent never saw; "Player's age must
      // be between 6 and 21" describes the one in front of them.
      const issue = parsedSignup.error.issues[0]
      const role = typeof issue?.path?.[0] === "string" ? issue.path[0] : ""
      const label = role === "" ? "That form" : labelForRole(fields, role)
      const detail =
        role === "athlete_age"
          ? "must be between 6 and 21"
          : role === "waiver_accepted"
            ? "must be accepted before you can pay"
            : (issue?.message ?? "is not valid")
      return NextResponse.json({ error: `${label} ${detail}.` }, { status: 400 })
    }

    // Attribution, resolved the same way /api/events/[id]/checkout resolves it,
    // so a funnel-born signup carries its gclid onto `event_signups` rather than
    // appearing from nowhere.
    const attrRow = sessionId ? await getAttributionBySession(sessionId).catch(() => null) : null
    const tracking = attrRow
      ? { gclid: attrRow.gclid, gbraid: attrRow.gbraid, wbraid: attrRow.wbraid, fbclid: attrRow.fbclid }
      : undefined

    const outcome = await createEventSignupCheckout({
      event,
      input: parsedSignup.data,
      ipAddress: ip === "unknown" ? null : ip,
      userAgent: request.headers.get("user-agent"),
      tracking,
      baseUrl: getBaseUrl(),
      returnUrls: await funnelReturnUrls(),
    })
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status })
    return NextResponse.json({ sessionUrl: outcome.sessionUrl })
  }

  /**
   * Where Stripe sends the visitor, BUILT FROM THE FUNNEL'S OWN SLUGS.
   *
   * Never from request input — the same rule that put a host allowlist on
   * `redirectUrl`, and it matters more here because these two URLs are handed to
   * a third party who will send a paying visitor to them.
   *
   * Success is the funnel's LAST step by position: a completed purchase belongs
   * on the page the owner wrote for it, and the step rail already labels that one
   * "ends here". Cancel returns to the step the form is on, so a parent who backs
   * out of Stripe lands where they were rather than at the top of the funnel.
   *
   * Returns undefined when either lookup fails, which leaves the helper's own
   * default (the event's pages) — a worse landing, but a completed payment.
   */
  async function funnelReturnUrls(): Promise<{ successUrl: string; cancelUrl: string } | undefined> {
    const [funnel, steps] = await Promise.all([
      getFunnelById(parsedBody.funnelId).catch(() => null),
      listSteps(parsedBody.funnelId).catch(() => [] as Awaited<ReturnType<typeof listSteps>>),
    ])
    const thisStep = steps.find((candidate) => candidate.id === parsedBody.stepId)
    const last = [...steps].sort((a, b) => a.position - b.position).at(-1)
    if (!funnel || !last || !thisStep) return undefined
    const base = `${getBaseUrl()}/go/${funnel.slug}`
    return {
      // `{CHECKOUT_SESSION_ID}` is Stripe's own placeholder. It must reach Stripe
      // unescaped, so it is never passed through encodeURIComponent.
      successUrl: `${base}/${last.slug}?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/${thisStep.slug}?checkout=cancelled`,
    }
  }
}

/**
 * Looks up the page's name and emails the coach.
 *
 * The name lookup is inside here rather than on the hot path above so a slow or
 * failing read costs the ALERT, never the submission — the reason this whole
 * function is detached in the first place.
 */
async function notifyCoachOfLead(input: {
  funnelId: string
  stepId: string
  name: string | null
  email: string | null
  phone: string | null
  answers: Record<string, string>
}): Promise<void> {
  const [funnel, step] = await Promise.all([
    getFunnelById(input.funnelId).catch(() => null),
    getStep(input.stepId).catch(() => null),
  ])

  const pageName = [funnel?.name, step?.name].filter(Boolean).join(" · ") || "a landing page"
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.darrenjpaul.com"

  await sendNewFunnelLeadEmail({
    name: input.name,
    email: input.email,
    phone: input.phone,
    pageName,
    answers: input.answers,
    // Deep-linked to this page's leads, filtered, so the click lands on the
    // one lead the email is about rather than on the whole inbox.
    leadsUrl: `${base}/admin/funnels/leads?funnelId=${encodeURIComponent(input.funnelId)}`,
    // Set at creation by templates that capture leads. Read here rather than
    // stored on the step, because the owner thinks of it as "who hears about
    // THIS campaign", not about one page of it.
    extraRecipients: funnel?.notify_emails ?? null,
  })
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
    const { data: existing } = await supabase.from("users").select("id").eq("email", email).maybeSingle()
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
